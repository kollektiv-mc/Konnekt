package services

import (
	"encoding/binary"
	"net"
	"strings"
	"testing"
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
	addr := fakeRconServer(t, func(conn net.Conn) {
		authID, _, password, err := readPacket(conn)
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

		cmdID, _, command, err := readPacket(conn)
		if err != nil {
			return
		}
		if command != "list" {
			return
		}
		_ = writePacket(conn, cmdID, 0, "§aThere are §f2§a players online")
	})

	got, err := (&RconService{}).Execute(addr, "secret", "list")
	if err != nil {
		t.Fatalf("Execute error: %v", err)
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
}

func TestNewRconServiceIsUsable(t *testing.T) {
	if NewRconService() == nil {
		t.Fatal("NewRconService() = nil")
	}
}
