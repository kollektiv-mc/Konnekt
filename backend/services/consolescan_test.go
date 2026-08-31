package services

import (
	"bufio"
	"io"
	"strings"
	"testing"
	"testing/iotest"
)

// scanConsole runs input through a scanner configured exactly the way
// streamOutput configures its own, and returns the delivered lines.
func scanConsole(t *testing.T, r io.Reader, maxLine int) []string {
	t.Helper()
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, maxLine), maxLine)
	sc.Split(newConsoleSplitFunc(maxLine))
	var lines []string
	for sc.Scan() {
		lines = append(lines, sc.Text())
	}
	if err := sc.Err(); err != nil {
		t.Fatalf("scan error: %v", err)
	}
	return lines
}

func TestConsoleSplitFunc(t *testing.T) {
	cases := []struct {
		name    string
		input   string
		maxLine int
		want    []string
	}{
		{
			name:    "plain newlines pass through, blank line included",
			input:   "a\nb\n\nc\n",
			maxLine: 16,
			want:    []string{"a", "b", "", "c"},
		},
		{
			name:    "crlf is one break, no phantom empty line",
			input:   "a\r\nb\r\n",
			maxLine: 16,
			want:    []string{"a", "b"},
		},
		{
			name:    "bare carriage returns become line breaks",
			input:   "Loading\rProgress 10%\rProgress 20%\nDone\n",
			maxLine: 64,
			want:    []string{"Loading", "Progress 10%", "Progress 20%", "Done"},
		},
		{
			name:    "overlong line is truncated and the stream continues",
			input:   strings.Repeat("x", 20) + "\nnext\n",
			maxLine: 8,
			want:    []string{"xxxxxxxx", "next"},
		},
		{
			name:    "dropped excess ending in crlf resumes at the next line",
			input:   "abcdefgh\r\nnext\n",
			maxLine: 4,
			want:    []string{"abcd", "next"},
		},
		{
			name:    "consecutive overlong lines each truncate independently",
			input:   strings.Repeat("a", 10) + "\n" + strings.Repeat("b", 10) + "\nc\n",
			maxLine: 4,
			want:    []string{"aaaa", "bbbb", "c"},
		},
		{
			name:    "unterminated data at EOF is delivered",
			input:   "a\ntail",
			maxLine: 16,
			want:    []string{"a", "tail"},
		},
		{
			name:    "trailing carriage return at EOF",
			input:   "a\r",
			maxLine: 16,
			want:    []string{"a"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := scanConsole(t, strings.NewReader(tc.input), tc.maxLine)
			assertLines(t, got, tc.want)
		})
		// The same input arriving one byte per read must split identically:
		// this forces every terminator onto a read boundary, exercising the
		// split-\r\n state in particular.
		t.Run(tc.name+" (one byte per read)", func(t *testing.T) {
			got := scanConsole(t, iotest.OneByteReader(strings.NewReader(tc.input)), tc.maxLine)
			assertLines(t, got, tc.want)
		})
	}
}

// The acceptance case from issue #112: a multi-megabyte single line must not
// end the stream. Run at the real cap streamOutput uses.
func TestConsoleSplitFuncSurvivesMultiMegabyteLine(t *testing.T) {
	giant := strings.Repeat("j", 3*1024*1024)
	got := scanConsole(t, strings.NewReader(giant+"\nafter\n"), maxConsoleLine)
	if len(got) != 2 {
		t.Fatalf("got %d lines, want 2", len(got))
	}
	if got[0] != giant[:maxConsoleLine] {
		t.Errorf("first line is not the truncated giant (len %d)", len(got[0]))
	}
	if got[1] != "after" {
		t.Errorf("streaming did not continue past the giant line: got %q", got[1])
	}
}

func assertLines(t *testing.T, got, want []string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("got %d lines %q, want %d lines %q", len(got), got, len(want), want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("line %d: got %q, want %q", i, got[i], want[i])
		}
	}
}

func TestStripANSI(t *testing.T) {
	cases := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "line with no escapes is returned untouched",
			input: "[17:22:56 INFO]: UUID of player Snadrochka is 5d818448-9c12-4adb-b41b-bda6a2d5938d",
			want:  "[17:22:56 INFO]: UUID of player Snadrochka is 5d818448-9c12-4adb-b41b-bda6a2d5938d",
		},
		{
			// The reported bug: Essentials colours the join broadcast, the SGR
			// sequence lands between "]: " and the name, and rePlayerJoin stops
			// matching. Verbatim from the issue's log.
			name:  "truecolor SGR around an Essentials join broadcast",
			input: "[17:22:59 INFO]: \x1b[38;2;255;255;85mSnadrochka joined the game\x1b[0m",
			want:  "[17:22:59 INFO]: Snadrochka joined the game",
		},
		{
			name:  "colour inside a chat line, name and message both wrapped",
			input: "[17:23:35 INFO]: <\x1b[38;2;170;0;0mSnadrochka\x1b[0m> test",
			want:  "[17:23:35 INFO]: <Snadrochka> test",
		},
		{
			name:  "plain SGR codes",
			input: "\x1b[0;32mgreen\x1b[m and \x1b[1mbold\x1b[0m",
			want:  "green and bold",
		},
		{
			name:  "CSI that is not SGR",
			input: "progress\x1b[2K\x1b[1Gredrawn",
			want:  "progressredrawn",
		},
		{
			name:  "OSC terminated by BEL",
			input: "a\x1b]0;window title\x07b",
			want:  "ab",
		},
		{
			name:  "OSC terminated by ST",
			input: "a\x1b]0;window title\x1b\\b",
			want:  "ab",
		},
		{
			name:  "two-byte escape",
			input: "a\x1bcb",
			want:  "ab",
		},
		{
			// Nothing after the ESC to consume, and the loop still has to
			// advance or it spins.
			name:  "trailing bare ESC",
			input: "line\x1b",
			want:  "line",
		},
		{
			name:  "unterminated CSI takes the rest of the line",
			input: "line\x1b[38;2;255",
			want:  "line",
		},
		{
			// A malformed CSI resumes on the offending byte rather than
			// swallowing everything after it.
			name:  "CSI broken by an illegal body byte",
			input: "a\x1b[38 joined the game",
			want:  "a joined the game",
		},
		{
			// Section-sign codes are ordinary text a player can type, so they
			// are deliberately left alone.
			input: "[17:23:35 INFO]: <Snadrochka> §atest",
			name:  "section-sign colour codes survive",
			want:  "[17:23:35 INFO]: <Snadrochka> §atest",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := stripANSI(tc.input); got != tc.want {
				t.Errorf("stripANSI(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}
