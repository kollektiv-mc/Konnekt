package services

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
)

// Konnekt is a packaged GUI app: it has no terminal attached, so anything
// written to stdout or stderr in a release build goes nowhere. Until this file
// existed there was no retrievable log at all, and a bug reporter had nothing
// to attach — the only diagnostics were EventBus emissions, which are UI-facing
// and live only while the window is open.
//
// log/slog is stdlib on Go 1.24, so this adds no dependency
// (agent_docs/DEPENDENCIES.md).

const (
	// LogFileName is the current log inside the app data dir.
	LogFileName = "konnekt.log"
	// maxLogBytes is the size at which the current log is rotated. One previous
	// file is kept, so the on-disk cost is bounded at roughly twice this.
	maxLogBytes = 2 << 20 // 2 MiB
	// LogTailBytes is how much of the log ReadLogTail returns: under the 65,536
	// characters GitHub takes in an issue body, with room left for the form's
	// other fields, so a copied log pastes into a report whole.
	LogTailBytes = 48 << 10 // 48 KiB
)

// logFile is the open handle behind the default logger, kept so CloseLogger can
// release it on shutdown. Guarded because startup and shutdown run on different
// goroutines under Wails.
var (
	logMu   sync.Mutex
	logFile *os.File
)

// LogPath returns the current log file's absolute path inside dataDir.
func LogPath(dataDir string) string {
	return filepath.Join(dataDir, LogFileName)
}

// InitLogger points slog's default logger at a file in dataDir and returns it.
//
// Output goes to the file *and* stderr: the file is what a user can attach to a
// bug report, and stderr is what a developer running `wails dev` actually
// watches. Callers use plain `slog.Info`/`slog.Error` rather than threading a
// logger through every service — this is a single-process desktop app with one
// log, and the alternative is a parameter on every constructor.
//
// A failure to open the file is not fatal and not silent: the returned logger
// falls back to stderr alone and the error is returned for the caller to log
// through it. The app must still start when its data dir is read-only.
func InitLogger(dataDir string) (*slog.Logger, error) {
	logMu.Lock()
	defer logMu.Unlock()

	var openErr error
	var w io.Writer = os.Stderr

	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		openErr = fmt.Errorf("create data dir for log: %w", err)
	} else {
		path := LogPath(dataDir)
		if err := rotateIfLarge(path); err != nil {
			openErr = fmt.Errorf("rotate log: %w", err)
		}
		f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
		if err != nil {
			openErr = fmt.Errorf("open log file: %w", err)
		} else {
			logFile = f
			w = io.MultiWriter(os.Stderr, f)
		}
	}

	logger := slog.New(slog.NewTextHandler(w, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)
	return logger, openErr
}

// ReadLogTail returns the last max bytes of the log in dataDir, starting at a
// line boundary so a report never opens on half a record. A log that does not
// exist yet reads as empty: nothing has gone wrong worth a line.
func ReadLogTail(dataDir string, max int64) (string, error) {
	f, err := os.Open(LogPath(dataDir))
	if errors.Is(err, fs.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("open log: %w", err)
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return "", fmt.Errorf("stat log: %w", err)
	}
	start := info.Size() - max
	if start < 0 {
		start = 0
	}
	data, err := io.ReadAll(io.NewSectionReader(f, start, info.Size()-start))
	if err != nil {
		return "", fmt.Errorf("read log: %w", err)
	}
	if start > 0 {
		// The cut landed mid-line, possibly mid-rune: drop up to the next line.
		if i := bytes.IndexByte(data, '\n'); i >= 0 {
			data = data[i+1:]
		}
	}
	return string(data), nil
}

// CloseLogger releases the log file. Safe to call when InitLogger failed to open
// one, and safe to call twice.
func CloseLogger() error {
	logMu.Lock()
	defer logMu.Unlock()
	if logFile == nil {
		return nil
	}
	err := logFile.Close()
	logFile = nil
	return err
}

// rotateIfLarge renames the current log aside once it passes maxLogBytes,
// keeping exactly one previous file.
//
// Deliberately not a real rotation library: one desktop client writing
// occasional lines does not need size-tiered archives, and a dependency for it
// would have to earn its place under agent_docs/DEPENDENCIES.md. A missing file
// is the normal first-run case, not an error.
func rotateIfLarge(path string) error {
	info, err := os.Stat(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if info.Size() < maxLogBytes {
		return nil
	}
	// Rename over any existing .1 — that is what "keep one previous" means.
	return os.Rename(path, path+".1")
}
