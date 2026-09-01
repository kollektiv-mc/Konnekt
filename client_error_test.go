package main

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"
	"unicode/utf8"
)

// LogClientError is the frontend's one path into konnekt.log (#245). These
// pin the two things a caller relies on: the line lands on the default logger
// with every field, and no field can grow without bound.

func captureDefaultLogger(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return &buf
}

func TestLogClientErrorReachesTheDefaultLogger(t *testing.T) {
	buf := captureDefaultLogger(t)

	err := (&App{}).LogClientError("render", "widget exploded",
		"TypeError: widget exploded\n    at Tile (index.tsx:12)\n    in PerformanceTile")
	if err != nil {
		t.Fatalf("LogClientError returned %v", err)
	}

	out := buf.String()
	for _, want := range []string{
		"level=ERROR",
		"frontend: uncaught error",
		"origin=render",
		"widget exploded",
		"PerformanceTile",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("log line lacks %q:\n%s", want, out)
		}
	}
}

func TestLogClientErrorClampsEveryField(t *testing.T) {
	buf := captureDefaultLogger(t)

	long := strings.Repeat("x", 20_000)
	if err := (&App{}).LogClientError(long, long, long); err != nil {
		t.Fatalf("LogClientError returned %v", err)
	}

	out := buf.String()
	if !strings.Contains(out, "...[truncated]") {
		t.Fatalf("oversized fields were not marked as cut:\n%.200s", out)
	}
	// 64 + 1024 + 8192 runes of payload plus keys and markers: well under one
	// of the three inputs alone, which is the point.
	if len(out) > 10_000 {
		t.Errorf("clamped line is %d bytes, expected under 10000", len(out))
	}
}

func TestClampForLogCutsOnRuneBoundaries(t *testing.T) {
	got := clampForLog(strings.Repeat("é", 100), 10)
	if !utf8.ValidString(got) {
		t.Fatalf("clamp produced invalid UTF-8: %q", got)
	}
	if !strings.HasPrefix(got, strings.Repeat("é", 10)) || !strings.HasSuffix(got, "...[truncated]") {
		t.Errorf("unexpected clamp result %q", got)
	}
	if short := clampForLog("short", 10); short != "short" {
		t.Errorf("a string under the limit must pass through unchanged, got %q", short)
	}
}
