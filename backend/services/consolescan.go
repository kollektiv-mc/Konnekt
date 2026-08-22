package services

import "bufio"

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
