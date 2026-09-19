package services

import (
	"encoding/binary"
	"fmt"
	"math/rand"
	"net"
	"regexp"
	"strings"
	"time"
)

const (
	rconPacketAuth    = 3
	rconPacketCommand = 2
	rconDialTimeout   = 2 * time.Second
	// maxRconBody bounds an outgoing body so writePacket's int32 length cannot
	// wrap. It is deliberately far larger than any command a server would
	// accept, because its job is to make the arithmetic total rather than to
	// enforce the protocol: readPacket already refuses an inbound packet over
	// 4096 bytes, and picking that number here too would newly reject outbound
	// commands that work today. Raise it only with the wrap in mind.
	maxRconBody = 1 << 20
)

var reMinecraftColor = regexp.MustCompile(`§[0-9a-fk-or]`)

type RconService struct {
	// dial is net.DialTimeout in production. Tests hand in a net.Pipe so a
	// write can be made to fail on demand, which a real socket cannot do
	// deterministically: the first write after the peer hangs up still lands
	// in the kernel buffer and succeeds. Nil means the default.
	dial func(network, addr string, timeout time.Duration) (net.Conn, error)
}

func NewRconService() *RconService {
	return &RconService{dial: net.DialTimeout}
}

// Execute connects, authenticates, runs a single command, and closes.
// Returns the response body with Minecraft colour codes stripped.
func (s *RconService) Execute(addr, password, command string) (string, error) {
	dial := s.dial
	if dial == nil {
		dial = net.DialTimeout
	}
	conn, err := dial("tcp", addr, rconDialTimeout)
	if err != nil {
		return "", fmt.Errorf("rcon dial: %w", err)
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(5 * time.Second))

	authID := rand.Int31()
	if err := writePacket(conn, authID, rconPacketAuth, password); err != nil {
		return "", fmt.Errorf("rcon auth send: %w", err)
	}
	id, _, _, err := readPacket(conn)
	if err != nil {
		return "", fmt.Errorf("rcon auth recv: %w", err)
	}
	if id == -1 {
		return "", fmt.Errorf("rcon auth: wrong password")
	}

	cmdID := rand.Int31()
	if err := writePacket(conn, cmdID, rconPacketCommand, command); err != nil {
		return "", fmt.Errorf("rcon cmd send: %w", err)
	}
	_, _, body, err := readPacket(conn)
	if err != nil {
		return "", fmt.Errorf("rcon cmd recv: %w", err)
	}

	return stripColors(body), nil
}

// writePacket writes a Source RCON packet: length(4) + id(4) + type(4) + body + 2 null bytes.
func writePacket(conn net.Conn, id, ptype int32, body string) error {
	payload := []byte(body)
	if len(payload) > maxRconBody {
		return fmt.Errorf("rcon: body of %d bytes exceeds the %d byte limit", len(payload), maxRconBody)
	}
	// Total because of the check above: the widest payload leaves length far
	// inside int32, so it can neither wrap negative nor panic the make below.
	length := int32(4 + 4 + len(payload) + 2) // #nosec G115 -- bounded by the maxRconBody check above
	buf := make([]byte, 4+length)
	// The three conversions below are the protocol's own encoding, not a range
	// narrowing: Source RCON carries id and type as four little-endian bytes
	// each, and a negative id is a value it uses rather than an overflow.
	binary.LittleEndian.PutUint32(buf[0:], uint32(length)) // #nosec G115 -- length is bounded positive by maxRconBody
	binary.LittleEndian.PutUint32(buf[4:], uint32(id))     // #nosec G115 -- two's complement is the wire format
	binary.LittleEndian.PutUint32(buf[8:], uint32(ptype))  // #nosec G115 -- two's complement is the wire format
	copy(buf[12:], payload)
	// two null terminators already zero-valued in the slice
	_, err := conn.Write(buf)
	return err
}

// readPacket reads one Source RCON response packet.
func readPacket(conn net.Conn) (id, ptype int32, body string, err error) {
	var length int32
	if err = binary.Read(conn, binary.LittleEndian, &length); err != nil {
		return
	}
	if length < 10 || length > 4096 {
		err = fmt.Errorf("rcon: suspicious packet length %d", length)
		return
	}
	data := make([]byte, length)
	if _, err = readFull(conn, data); err != nil {
		return
	}
	// Reading the same wire format back. The wrap is load-bearing: a failed
	// auth is signalled by id -1, which arrives as 0xFFFFFFFF.
	id = int32(binary.LittleEndian.Uint32(data[0:4]))    // #nosec G115 -- two's complement is the wire format
	ptype = int32(binary.LittleEndian.Uint32(data[4:8])) // #nosec G115 -- two's complement is the wire format
	// body: data[8:] minus the two trailing null bytes. The length check above
	// guarantees at least the ten framing bytes, so the slice is never negative.
	body = string(data[8 : len(data)-2])
	return
}

func readFull(conn net.Conn, buf []byte) (int, error) {
	total := 0
	for total < len(buf) {
		n, err := conn.Read(buf[total:])
		total += n
		if err != nil {
			return total, err
		}
	}
	return total, nil
}

func stripColors(s string) string {
	return strings.TrimSpace(reMinecraftColor.ReplaceAllString(s, ""))
}
