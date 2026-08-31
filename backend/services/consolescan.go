package services

import (
	"bufio"
	"strings"
)

// maxConsoleLine caps a single delivered console line at 64 KiB, the same
// bound bufio.Scanner applied implicitly before it had a split function. The
// difference is what happens past it: the line is truncated and the stream
// keeps going, instead of Scan returning false and the console dying for the
// rest of the session.
const maxConsoleLine = 64 * 1024

// newConsoleSplitFunc returns a bufio.SplitFunc for server console output that
// survives the two ways Minecraft breaks a naive line scanner:
//
//   - Overlong lines (a stack trace, a mod dumping JSON): a line longer than
//     maxLine is delivered truncated at maxLine bytes, the excess is discarded,
//     and scanning continues with the next line.
//   - Stray carriage returns (progress output sized to an assumed terminal
//     width): \n, \r\n and bare \r are all treated as line breaks, so
//     \r-separated output arrives as individual lines.
//
// The func always advances once maxLine bytes are buffered without a
// terminator, so the scanner's buffer never needs to grow past maxLine and
// bufio.ErrTooLong is unreachable. Callers size the buffer accordingly:
// scanner.Buffer(make([]byte, maxLine), maxLine).
func newConsoleSplitFunc(maxLine int) bufio.SplitFunc {
	dropping := false   // discarding the excess of an overlong line
	skipNextLF := false // a \r ended the previous data; swallow its \n half
	return func(data []byte, atEOF bool) (int, []byte, error) {
		if len(data) == 0 {
			return 0, nil, nil
		}
		if skipNextLF {
			skipNextLF = false
			if data[0] == '\n' {
				return 1, nil, nil
			}
		}
		for i, b := range data {
			if b != '\n' && b != '\r' {
				continue
			}
			advance := i + 1
			if b == '\r' {
				if i+1 < len(data) {
					if data[i+1] == '\n' {
						advance = i + 2
					}
				} else {
					// \r is the last buffered byte: consume it now and, if the
					// next read starts with the \n of a split \r\n, swallow it.
					skipNextLF = true
				}
			}
			if dropping {
				dropping = false
				return advance, nil, nil
			}
			return advance, data[:i], nil
		}
		if len(data) >= maxLine {
			if dropping {
				return maxLine, nil, nil
			}
			dropping = true
			return maxLine, data[:maxLine], nil
		}
		if atEOF {
			if dropping {
				return len(data), nil, nil
			}
			return len(data), data, nil
		}
		return 0, nil, nil
	}
}

// ansiEscape is ESC, the byte every sequence stripANSI removes starts with.
const ansiEscape = 0x1b

// stripANSI removes ANSI escape sequences from a line of server output.
//
// A pipe is not a terminal, so this ought to be unnecessary, and on a bare
// vanilla server it is. It is not on a real one: Paper's terminal appender
// translates plugin colour codes to ANSI regardless, so an Essentials join
// broadcast arrives as
//
//	]: \x1b[38;2;255;255;85mAlex joined the game\x1b[0m
//
// which is why this exists. Every line matcher in streamOutput is anchored on
// "]: " followed directly by real text — deliberately, so chat cannot spoof a
// server line — and an SGR sequence sitting in that gap defeats all of them at
// once. The player matchers were the visible casualty: joins went unrecorded,
// so the roster, the player count on the overview and performance tiles, the
// recorded history and the scheduler's player triggers all read empty on any
// server with a chat plugin installed.
//
// Stripping here rather than launching the JVM with -Dterminal.ansi=false:
// that flag is Paper and jline specific, and Forge, NeoForge and Fabric each
// use a different appender.
//
// Handles CSI (the SGR colour sequences above, and anything else shaped like
// them) and OSC; any other escape is dropped as the usual two bytes. A
// sequence left unterminated at the end of the line takes the rest of the line
// with it, which is what an unterminated sequence means. Minecraft strips
// control characters from chat, so no ESC here can have come from a player.
//
// Section-sign colour codes (§a) are left alone on purpose: unlike ESC they
// are ordinary text a player can type, and eating one out of a chat line would
// be a worse bug than the colour code showing.
func stripANSI(s string) string {
	// The overwhelmingly common case, and this runs on every console line.
	if !strings.ContainsRune(s, ansiEscape) {
		return s
	}
	var b strings.Builder
	b.Grow(len(s))
	for i := 0; i < len(s); {
		if s[i] != ansiEscape {
			b.WriteByte(s[i])
			i++
			continue
		}
		i += ansiSeqLen(s[i:])
	}
	return b.String()
}

// ansiSeqLen returns the length in bytes of the escape sequence starting at
// the front of s, which begins with ESC. Never returns 0, so callers advance.
func ansiSeqLen(s string) int {
	if len(s) < 2 {
		return len(s) // a trailing ESC with nothing after it
	}
	switch s[1] {
	case '[': // CSI: parameter bytes 0x30-0x3f, final 0x40-0x7e
		//
		// ECMA-48 also allows intermediate bytes (0x20-0x2f) between the
		// parameters and the final, and they are deliberately not accepted
		// here. Space is one of them, so "\x1b[38 joined the game" — a colour
		// sequence cut short, followed by ordinary log text — would parse as a
		// complete CSI ending at the "j" and eat a word out of the line. Log
		// appenders emit digits and semicolons and nothing else, so the cost
		// of narrowing this is a couple of stray bytes surviving from a kind
		// of sequence a Minecraft server does not produce, against a word
		// silently vanishing from the console.
		for i := 2; i < len(s); i++ {
			switch {
			case s[i] >= 0x40 && s[i] <= 0x7e:
				return i + 1
			case s[i] < 0x30 || s[i] > 0x3f:
				// Malformed or cut short: consume what has been read and
				// resume on this byte rather than swallowing the rest.
				return i
			}
		}
	case ']': // OSC: terminated by BEL, or by ST (ESC \)
		for i := 2; i < len(s); i++ {
			if s[i] == 0x07 {
				return i + 1
			}
			if s[i] == ansiEscape && i+1 < len(s) && s[i+1] == '\\' {
				return i + 2
			}
		}
	default:
		return 2 // two-byte escape: ESC c, ESC =, and friends
	}
	return len(s) // unterminated CSI or OSC
}
