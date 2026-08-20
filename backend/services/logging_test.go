package services

import (
	"bytes"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The whole point of this file is that a packaged build has no terminal, so
// these assert the *file* actually receives the lines — not that slog works.

func TestInitLoggerWritesToTheDataDir(t *testing.T) {
	dir := t.TempDir()
	t.Cleanup(func() { _ = CloseLogger() })

	log, err := InitLogger(dir)
	if err != nil {
		t.Fatalf("InitLogger: %v", err)
	}
	log.Info("hello", "answer", 42)

	data, readErr := os.ReadFile(LogPath(dir))
	if readErr != nil {
		t.Fatalf("read log: %v", readErr)
	}
	if !strings.Contains(string(data), "hello") || !strings.Contains(string(data), "answer=42") {
		t.Errorf("log file missing the record, got %q", data)
	}
}

func TestInitLoggerCreatesAMissingDataDir(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "not", "there", "yet")
	t.Cleanup(func() { _ = CloseLogger() })

	if _, err := InitLogger(dir); err != nil {
		t.Fatalf("InitLogger on a missing dir: %v", err)
	}
	if _, err := os.Stat(LogPath(dir)); err != nil {
		t.Errorf("expected the log file to exist: %v", err)
	}
}

// Appending matters: a crash-restart loop must not erase the evidence of the
// previous run.
func TestInitLoggerAppendsAcrossRuns(t *testing.T) {
	dir := t.TempDir()
	t.Cleanup(func() { _ = CloseLogger() })

	log, err := InitLogger(dir)
	if err != nil {
		t.Fatalf("InitLogger: %v", err)
	}
	log.Info("first run")
	if err := CloseLogger(); err != nil {
		t.Fatalf("CloseLogger: %v", err)
	}

	log, err = InitLogger(dir)
	if err != nil {
		t.Fatalf("InitLogger again: %v", err)
	}
	log.Info("second run")

	data, readErr := os.ReadFile(LogPath(dir))
	if readErr != nil {
		t.Fatalf("read log: %v", readErr)
	}
	for _, want := range []string{"first run", "second run"} {
		if !strings.Contains(string(data), want) {
			t.Errorf("log lost %q, got %q", want, data)
		}
	}
}

// A read-only data dir must degrade to stderr rather than stop the app: this is
// a local-first desktop tool and refusing to start over a log is worse than the
// missing log.
func TestInitLoggerStillReturnsAUsableLoggerWhenTheFileCannotBeOpened(t *testing.T) {
	dir := t.TempDir()
	t.Cleanup(func() { _ = CloseLogger() })

	// A *file* where the log directory should be: MkdirAll fails, on every OS.
	blocked := filepath.Join(dir, "blocked")
	if err := os.WriteFile(blocked, []byte("not a directory"), 0o644); err != nil {
		t.Fatalf("seed blocker: %v", err)
	}

	log, err := InitLogger(blocked)
	if err == nil {
		t.Error("expected the open failure to be reported, got nil")
	}
	if log == nil {
		t.Fatal("expected a usable fallback logger, got nil")
	}
	log.Warn("still logging") // must not panic
}

func TestCloseLoggerIsSafeTwice(t *testing.T) {
	dir := t.TempDir()
	if _, err := InitLogger(dir); err != nil {
		t.Fatalf("InitLogger: %v", err)
	}
	if err := CloseLogger(); err != nil {
		t.Fatalf("first CloseLogger: %v", err)
	}
	if err := CloseLogger(); err != nil {
		t.Errorf("second CloseLogger should be a no-op, got %v", err)
	}
}

func TestRotateIfLarge(t *testing.T) {
	t.Run("leaves a small log alone", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), LogFileName)
		if err := os.WriteFile(path, []byte("small"), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := rotateIfLarge(path); err != nil {
			t.Fatalf("rotateIfLarge: %v", err)
		}
		if _, err := os.Stat(path + ".1"); !os.IsNotExist(err) {
			t.Error("rotated a log that was under the cap")
		}
	})

	t.Run("is a no-op on first run", func(t *testing.T) {
		if err := rotateIfLarge(filepath.Join(t.TempDir(), LogFileName)); err != nil {
			t.Errorf("a missing log is the normal first-run case, got %v", err)
		}
	})

	t.Run("moves an oversized log aside and keeps exactly one", func(t *testing.T) {
		dir := t.TempDir()
		path := filepath.Join(dir, LogFileName)
		if err := os.WriteFile(path, bytes.Repeat([]byte("x"), maxLogBytes+1), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path+".1", []byte("older"), 0o644); err != nil {
			t.Fatal(err)
		}

		if err := rotateIfLarge(path); err != nil {
			t.Fatalf("rotateIfLarge: %v", err)
		}

		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Error("expected the oversized log to be moved aside")
		}
		rotated, err := os.ReadFile(path + ".1")
		if err != nil {
			t.Fatalf("read rotated log: %v", err)
		}
		if string(rotated) == "older" {
			t.Error("expected the previous .1 to be replaced, not kept")
		}
		entries, err := os.ReadDir(dir)
		if err != nil {
			t.Fatal(err)
		}
		if len(entries) != 1 {
			t.Errorf("expected exactly one file after rotation, got %d", len(entries))
		}
	})
}

// InitLogger sets slog's default, which is what every call site uses rather
// than threading a logger through the services.
func TestInitLoggerSetsTheDefaultLogger(t *testing.T) {
	dir := t.TempDir()
	t.Cleanup(func() { _ = CloseLogger() })

	if _, err := InitLogger(dir); err != nil {
		t.Fatalf("InitLogger: %v", err)
	}
	slog.Error("via the package default", "code", 7)

	data, err := os.ReadFile(LogPath(dir))
	if err != nil {
		t.Fatalf("read log: %v", err)
	}
	if !strings.Contains(string(data), "via the package default") {
		t.Errorf("slog default did not reach the file, got %q", data)
	}
}
