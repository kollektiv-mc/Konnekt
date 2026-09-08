package services

import (
	"errors"
	"fmt"
	"strings"
)

// What goes into a running server's stdin. Split from server.go so the one
// rule about a console line lives beside the one writer of console lines.

// errMultilineCommand is SendCommand's answer to a command carrying a line
// break. The server reads its console one line at a time, so "spam\nstop"
// handed to `kick` is a kick and then a stop (#308). Refused rather than
// truncated so the caller learns nothing was sent; checked here rather than
// in the app.go wrappers because the console, kick/ban/pardon, quick
// commands, Kommands buttons and the scheduler's command block all reach
// stdin through this one method.
var errMultilineCommand = errors.New("command must be a single line")

func (s *serverInstance) SendCommand(command string) error {
	if strings.ContainsAny(command, "\r\n") {
		return errMultilineCommand
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.running || s.stdin == nil {
		return errServerNotRunning
	}

	_, err := fmt.Fprintln(s.stdin, command)
	return err
}
