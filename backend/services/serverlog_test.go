package services

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeLatestLog puts content at logs/latest.log under a fresh working
// directory and returns that directory.
func writeLatestLog(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "logs"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, filepath.FromSlash(ServerLogRelPath)), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestReadServerLogTailReadsAMissingLogAsEmpty(t *testing.T) {
	got, err := ReadServerLogTail(t.TempDir(), 0)
	if err != nil || got == nil || len(got) != 0 {
		t.Fatalf("ReadServerLogTail on no log = %#v, %v; want an empty list, nil", got, err)
	}
}

func TestReadServerLogTailReturnsASmallLogWhole(t *testing.T) {
	dir := writeLatestLog(t, "[12:00:00] [main/INFO]: Starting\r\n[12:00:01] [main/INFO]: Done\r\n")
	got, err := ReadServerLogTail(dir, 0)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"[12:00:00] [main/INFO]: Starting", "[12:00:01] [main/INFO]: Done"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("lines = %q, want %q", got, want)
	}
}

func TestReadServerLogTailKeepsTheNewestLinesAsked(t *testing.T) {
	dir := writeLatestLog(t, "one\ntwo\nthree\nfour\n")
	got, err := ReadServerLogTail(dir, 2)
	if err != nil || strings.Join(got, "|") != "three|four" {
		t.Fatalf("lines = %q, %v; want the last two", got, err)
	}
	// Out of range asks for the most, never more.
	for _, n := range []int{-1, ServerLogMaxLines + 1} {
		if got, err = ReadServerLogTail(dir, n); err != nil || len(got) != 4 {
			t.Errorf("lines(%d) = %q, %v; want all four", n, got, err)
		}
	}
}

func TestReadServerLogTailCapsLinesAndStartsWhole(t *testing.T) {
	var b strings.Builder
	for i := 0; i < ServerLogMaxLines+20; i++ {
		b.WriteString(strings.Repeat("x", 500))
		b.WriteString("\n")
	}
	dir := writeLatestLog(t, b.String())
	got, err := ReadServerLogTail(dir, 0)
	if err != nil {
		t.Fatal(err)
	}
	// 520 lines of 501 bytes exceed the byte cap, so the read starts mid-file
	// and the first line kept is whole, at the line boundary after the cut.
	if len(got) == 0 || len(got) > ServerLogMaxLines {
		t.Fatalf("%d lines, want at most %d and some", len(got), ServerLogMaxLines)
	}
	for i, line := range got {
		if len(line) != 500 {
			t.Fatalf("line %d has %d bytes; the cut left a partial line", i, len(line))
		}
	}
	if len(got) < serverLogMaxBytes/501-1 {
		t.Errorf("%d lines from a %d-byte read; the byte cap dropped too much", len(got), serverLogMaxBytes)
	}
}

func TestLastLinesHandlesEmptyAndUnterminated(t *testing.T) {
	if got := lastLines(nil, 5); len(got) != 0 {
		t.Errorf("nil: %q", got)
	}
	if got := lastLines([]byte("\n"), 5); len(got) != 0 {
		t.Errorf("one newline: %q", got)
	}
	if got := lastLines([]byte("a\nb"), 5); strings.Join(got, "|") != "a|b" {
		t.Errorf("unterminated: %q", got)
	}
}
