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
	length := int32(4 + 4 + len(payload) + 2)
	buf := make([]byte, 4+length)
	binary.LittleEndian.PutUint32(buf[0:], uint32(length))
	binary.LittleEndian.PutUint32(buf[4:], uint32(id))
	binary.LittleEndian.PutUint32(buf[8:], uint32(ptype))
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
	id = int32(binary.LittleEndian.Uint32(data[0:4]))
	ptype = int32(binary.LittleEndian.Uint32(data[4:8]))
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
