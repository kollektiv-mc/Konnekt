package services

import (
	"encoding/binary"
	"errors"
	"io"
	"net"
	"strings"
	"testing"
	"time"
)

func TestWriteReadPacketRoundTrip(t *testing.T) {
	server, client := net.Pipe()
	defer server.Close()
	defer client.Close()

	done := make(chan error, 1)
	go func() {
		done <- writePacket(client, 7, rconPacketCommand, "list")
	}()

	id, ptype, body, err := readPacket(server)
	if err != nil {
		t.Fatalf("readPacket error: %v", err)
	}
	if werr := <-done; werr != nil {
		t.Fatalf("writePacket error: %v", werr)
	}
	if id != 7 {
		t.Errorf("id = %d, want 7", id)
	}
	if ptype != rconPacketCommand {
		t.Errorf("ptype = %d, want %d", ptype, rconPacketCommand)
	}
	if body != "list" {
		t.Errorf("body = %q, want %q", body, "list")
	}
}

func TestWriteReadPacketEmptyBody(t *testing.T) {
	server, client := net.Pipe()
	defer server.Close()
	defer client.Close()

	go func() { _ = writePacket(client, 1, rconPacketAuth, "") }()

	_, _, body, err := readPacket(server)
	if err != nil {
		t.Fatalf("readPacket error: %v", err)
	}
	if body != "" {
		t.Errorf("body = %q, want empty", body)
	}
}

func TestReadPacketRejectsTooShort(t *testing.T) {
	server, client := net.Pipe()
	defer server.Close()
	defer client.Close()

	go func() {
		buf := make([]byte, 4)
		binary.LittleEndian.PutUint32(buf, 9) // below the 10-byte minimum
		_, _ = client.Write(buf)
	}()

	if _, _, _, err := readPacket(server); err == nil {
		t.Fatal("expected error for a too-short packet length, got nil")
	}
}

func TestReadPacketRejectsTooLong(t *testing.T) {
	server, client := net.Pipe()
	defer server.Close()
	defer client.Close()

	go func() {
		buf := make([]byte, 4)
		binary.LittleEndian.PutUint32(buf, 4097) // above the 4096-byte maximum
		_, _ = client.Write(buf)
	}()

	if _, _, _, err := readPacket(server); err == nil {
		t.Fatal("expected error for an oversized packet length, got nil")
	}
}

func TestStripColors(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"§aHello§r", "Hello"},
		{"§k§lweird§r text", "weird text"},
		{"  plain text  ", "plain text"},
		{"no colors here", "no colors here"},
	}
	for _, c := range cases {
		if got := stripColors(c.in); got != c.want {
			t.Errorf("stripColors(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// ─── Execute against a fake RCON server ────────────────────────────────────
//
// Execute is the whole client and was the only uncovered function of substance
// in this file. The fake speaks the real protocol using the same
// writePacket/readPacket helpers, so the framing is not reimplemented here.

// fakeRconServer listens on an ephemeral loopback port, serves exactly one
// connection with handler, and returns the address to dial. The listener is
// closed via t.Cleanup so a failing assertion cannot leave the goroutine parked
// on Accept.
func fakeRconServer(t *testing.T, handler func(net.Conn)) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { _ = ln.Close() })

	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return // listener closed by cleanup
		}
		defer conn.Close()
		handler(conn)
	}()

	return ln.Addr().String()
}

func TestExecuteHappyPath(t *testing.T) {
	// The packet types the fake saw, sent once both packets are in. The
	// protocol distinguishes auth (3) from a command (2) by nothing else, so
	// a swapped constant would authenticate with a command packet and be
	// refused by a real server while every framing test still passed.
	types := make(chan [2]int32, 1)
	addr := fakeRconServer(t, func(conn net.Conn) {
		authID, authType, password, err := readPacket(conn)
		if err != nil {
			return
		}
		if password != "secret" {
			// Wrong password would be -1; this fake only serves the happy path.
			return
		}
		// Auth accepted: echo the id back rather than -1.
		if err := writePacket(conn, authID, rconPacketCommand, ""); err != nil {
			return
		}

		cmdID, cmdType, command, err := readPacket(conn)
		if err != nil {
			return
		}
		if command != "list" {
			return
		}
		types <- [2]int32{authType, cmdType}
		_ = writePacket(conn, cmdID, 0, "§aThere are §f2§a players online")
	})

	got, err := (&RconService{}).Execute(addr, "secret", "list")
	if err != nil {
		t.Fatalf("Execute error: %v", err)
	}
	select {
	case seen := <-types:
		if seen != [2]int32{3, 2} {
			t.Errorf("packet types = %v, want auth 3 then command 2", seen)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the fake never reported the packet types it saw")
	}
	// Colour codes stripped and the result trimmed, per stripColors.
	if got != "There are 2 players online" {
		t.Errorf("Execute = %q, want %q", got, "There are 2 players online")
	}
}

func TestExecuteWrongPassword(t *testing.T) {
	addr := fakeRconServer(t, func(conn net.Conn) {
		if _, _, _, err := readPacket(conn); err != nil {
			return
		}
		// The protocol signals a rejected password with id -1.
		_ = writePacket(conn, -1, rconPacketCommand, "")
	})

	_, err := (&RconService{}).Execute(addr, "wrong", "list")
	if err == nil {
		t.Fatal("Execute with a bad password = nil error, want an error")
	}
	if !strings.Contains(err.Error(), "wrong password") {
		t.Errorf("error = %q, want it to mention a wrong password", err)
	}
}

func TestExecuteDialFailure(t *testing.T) {
	// Bind then immediately release the port so the address is routable but dead.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	addr := ln.Addr().String()
	if err := ln.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	_, execErr := (&RconService{}).Execute(addr, "secret", "list")
	if execErr == nil {
		t.Fatal("Execute against a closed port = nil error, want an error")
	}
	if !strings.Contains(execErr.Error(), "rcon dial") {
		t.Errorf("error = %q, want it to mention the dial step", execErr)
	}
	// The wrap is %w, so a caller can still reach the network error.
	var opErr *net.OpError
	if !errors.As(execErr, &opErr) {
		t.Errorf("error = %v, want it to wrap the *net.OpError", execErr)
	}
}

// A server that hangs up after receiving auth must surface as an auth-recv
// failure rather than hanging until the 5s deadline or panicking.
func TestExecuteConnectionDroppedDuringAuth(t *testing.T) {
	addr := fakeRconServer(t, func(conn net.Conn) {
		_, _, _, _ = readPacket(conn)
		_ = conn.Close()
	})

	_, err := (&RconService{}).Execute(addr, "secret", "list")
	if err == nil {
		t.Fatal("Execute against a server that hangs up = nil error, want an error")
	}
	if !strings.Contains(err.Error(), "rcon auth recv") {
		t.Errorf("error = %q, want it to mention the auth receive step", err)
	}
	if !errors.Is(err, io.EOF) {
		t.Errorf("error = %v, want it to wrap io.EOF", err)
	}
}

// The same hang-up one step later. Every error return after auth could be
// deleted and the suite still passed (#312): dial and auth failures were
// tested, a failure after auth was not.
func TestExecuteConnectionDroppedAfterAuth(t *testing.T) {
	addr := fakeRconServer(t, func(conn net.Conn) {
		authID, _, _, err := readPacket(conn)
		if err != nil {
			return
		}
		if err := writePacket(conn, authID, rconPacketCommand, ""); err != nil {
			return
		}
		// Take the command, then hang up without answering it.
		_, _, _, _ = readPacket(conn)
		_ = conn.Close()
	})

	_, err := (&RconService{}).Execute(addr, "secret", "list")
	if err == nil {
		t.Fatal("Execute against a server that hangs up after auth = nil error, want an error")
	}
	if !strings.Contains(err.Error(), "rcon cmd recv") {
		t.Errorf("error = %q, want it to mention the command receive step", err)
	}
	if !errors.Is(err, io.EOF) {
		t.Errorf("error = %v, want it to wrap io.EOF", err)
	}
}

// Both edges of the length check, from either side. The bounds tests above
// exercise one bad value each; a mutant that moved either boundary by one
// survived them (#312).
func TestReadPacketLengthEdges(t *testing.T) {
	cases := []struct {
		name   string
		length int32
		accept bool
	}{
		{"9 is below the minimum", 9, false},
		{"10 is the minimum: id, type and the two nulls", 10, true},
		{"4096 is the maximum", 4096, true},
		{"4097 is above the maximum", 4097, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			server, client := net.Pipe()
			defer server.Close()
			defer client.Close()

			done := make(chan error, 1)
			go func() {
				hdr := make([]byte, 4)
				binary.LittleEndian.PutUint32(hdr, uint32(c.length))
				if _, err := client.Write(hdr); err != nil {
					done <- err
					return
				}
				if !c.accept {
					done <- nil
					return
				}
				// id 5, type 0, then a body of 'x' up to the two trailing nulls.
				data := make([]byte, c.length)
				binary.LittleEndian.PutUint32(data[0:], 5)
				for i := 8; i < int(c.length)-2; i++ {
					data[i] = 'x'
				}
				_, err := client.Write(data)
				done <- err
			}()

			id, _, body, err := readPacket(server)
			if !c.accept {
				if err == nil {
					t.Fatalf("length %d accepted, want rejected", c.length)
				}
				return
			}
			if err != nil {
				t.Fatalf("length %d rejected: %v", c.length, err)
			}
			if werr := <-done; werr != nil {
				t.Fatalf("write: %v", werr)
			}
			if id != 5 {
				t.Errorf("id = %d, want 5", id)
			}
			// The two nulls are framing, not body: exactly length-10 bytes come back.
			if want := strings.Repeat("x", int(c.length)-10); body != want {
				t.Errorf("body = %d byte(s), want %d with no trailing nulls", len(body), len(want))
			}
		})
	}
}

func TestNewRconServiceIsUsable(t *testing.T) {
	if NewRconService() == nil {
		t.Fatal("NewRconService() = nil")
	}
}

// ─── Send-path failures, through the dial seam ─────────────────────────────
//
// A real socket cannot fail a write on demand: the first write after the peer
// hangs up lands in the kernel buffer and succeeds, and the RST only fails the
// next one. A net.Pipe is synchronous, so closing the far end fails the write
// that is blocked on it, every time.

// pipeRcon returns a service whose dial hands Execute one end of a net.Pipe,
// and the other end for the test to play the server on.
func pipeRcon(t *testing.T) (*RconService, net.Conn) {
	t.Helper()
	server, client := net.Pipe()
	t.Cleanup(func() {
		_ = server.Close()
		_ = client.Close()
	})
	svc := &RconService{
		dial: func(string, string, time.Duration) (net.Conn, error) { return client, nil },
	}
	return svc, server
}

func TestExecuteAuthSendFailure(t *testing.T) {
	svc, server := pipeRcon(t)
	// Nothing will ever read, so the auth write fails outright.
	_ = server.Close()

	_, err := svc.Execute("pipe", "secret", "list")
	if err == nil {
		t.Fatal("Execute with a dead pipe = nil error, want an error")
	}
	if !strings.Contains(err.Error(), "rcon auth send") {
		t.Errorf("error = %q, want it to mention the auth send step", err)
	}
	if !errors.Is(err, io.ErrClosedPipe) {
		t.Errorf("error = %v, want it to wrap io.ErrClosedPipe", err)
	}
}

func TestExecuteCommandSendFailure(t *testing.T) {
	svc, server := pipeRcon(t)
	go func() {
		authID, _, _, err := readPacket(server)
		if err != nil {
			return
		}
		if err := writePacket(server, authID, rconPacketCommand, ""); err != nil {
			return
		}
		// Hang up before the command arrives: the client's write is blocked
		// on a reader that will never come.
		_ = server.Close()
	}()

	_, err := svc.Execute("pipe", "secret", "list")
	if err == nil {
		t.Fatal("Execute with the pipe closed before the command = nil error, want an error")
	}
	if !strings.Contains(err.Error(), "rcon cmd send") {
		t.Errorf("error = %q, want it to mention the command send step", err)
	}
	if !errors.Is(err, io.ErrClosedPipe) {
		t.Errorf("error = %v, want it to wrap io.ErrClosedPipe", err)
	}
}

// readFull exists because one Read need not return the whole body. The body
// arriving in two writes is what pins the loop; a truncated one pins its error.
func TestReadPacketBodyInTwoWrites(t *testing.T) {
	server, client := net.Pipe()
	defer server.Close()
	defer client.Close()

	go func() {
		const length = 4 + 4 + 4 + 2 // id, type, "abcd", two nulls
		hdr := make([]byte, 4)
		binary.LittleEndian.PutUint32(hdr, length)
		data := make([]byte, length)
		binary.LittleEndian.PutUint32(data[0:], 9)
		copy(data[8:], "abcd")
		for _, chunk := range [][]byte{hdr, data[:5], data[5:]} {
			if _, err := client.Write(chunk); err != nil {
				return
			}
		}
	}()

	id, _, body, err := readPacket(server)
	if err != nil {
		t.Fatalf("readPacket error: %v", err)
	}
	if id != 9 || body != "abcd" {
		t.Errorf("readPacket = (%d, %q), want (9, %q)", id, body, "abcd")
	}
}

func TestReadPacketReportsATruncatedBody(t *testing.T) {
	server, client := net.Pipe()
	defer server.Close()

	go func() {
		hdr := make([]byte, 4)
		binary.LittleEndian.PutUint32(hdr, 20)
		if _, err := client.Write(hdr); err != nil {
			return
		}
		if _, err := client.Write(make([]byte, 5)); err != nil {
			return
		}
		_ = client.Close()
	}()

	_, _, _, err := readPacket(server)
	if err == nil {
		t.Fatal("readPacket of a body cut short = nil error, want an error")
	}
	if !errors.Is(err, io.EOF) {
		t.Errorf("error = %v, want it to wrap io.EOF", err)
	}
}
