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
