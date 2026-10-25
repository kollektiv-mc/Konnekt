package services

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// A server's own log, logs/latest.log under its working directory, is the
// record of a start, a crash or a mod error, and it outlives Konnekt. The
// console ring (consoleCap) is the live view of the same stream and dies with
// the process. ReadServerLogTail is what the MCP server_log tool reads (#762)
// and what the browser remote reaches at read tier; detectFromLog in
// modjar.go scans the same file for the loader and version only.

const (
	// ServerLogRelPath is where the server writes its current log, relative
	// to the working directory. Vanilla, Paper, Fabric and NeoForge all keep
	// log4j's default.
	ServerLogRelPath = "logs/latest.log"
	// ServerLogMaxLines caps one read. A model needs the end of the log, not
	// the file, and mcp_tools.go repeats the number in the tool's text.
	ServerLogMaxLines = 500
	// serverLogMaxBytes bounds the read ahead of the line count, so that 500
	// lines of a mod dumping JSON cannot grow a result past what a tool call
	// should carry. It is also the most of the file ever read.
	serverLogMaxBytes = 128 << 10
)

// ReadServerLogTail returns the last lines of workDir's logs/latest.log,
// oldest first and newest last. lines caps the count; zero or anything out of
// range means ServerLogMaxLines. The read starts at a line boundary within
// the last serverLogMaxBytes, so the first line is whole, and a Windows CRLF
// is trimmed. A log that does not exist reads as empty: a server that never
// started has none, and that is not an error.
func ReadServerLogTail(workDir string, lines int) ([]string, error) {
	if lines <= 0 || lines > ServerLogMaxLines {
		lines = ServerLogMaxLines
	}
	f, err := os.Open(filepath.Join(workDir, filepath.FromSlash(ServerLogRelPath)))
	if errors.Is(err, fs.ErrNotExist) {
		return []string{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("open server log: %w", err)
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return nil, fmt.Errorf("stat server log: %w", err)
	}
	start := info.Size() - serverLogMaxBytes
	if start < 0 {
		start = 0
	}
	data, err := io.ReadAll(io.NewSectionReader(f, start, info.Size()-start))
	if err != nil {
		return nil, fmt.Errorf("read server log: %w", err)
	}
	if start > 0 {
		// The cut landed mid-line, possibly mid-rune: drop up to the next line.
		if i := bytes.IndexByte(data, '\n'); i >= 0 {
			data = data[i+1:]
		} else {
			data = nil
		}
	}
	return lastLines(data, lines), nil
}

// lastLines splits data on newlines, trims a carriage return from each line
// and keeps the last n. A trailing newline ends the last line rather than
// opening an empty one.
func lastLines(data []byte, n int) []string {
	text := strings.TrimSuffix(string(data), "\n")
	if text == "" {
		return []string{}
	}
	all := strings.Split(text, "\n")
	if len(all) > n {
		all = all[len(all)-n:]
	}
	for i, line := range all {
		all[i] = strings.TrimSuffix(line, "\r")
	}
	return all
}
