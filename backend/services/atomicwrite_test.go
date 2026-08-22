package services

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// readDirNames lists dir so the residue assertions can say exactly what was
// left behind when they fail.
func readDirNames(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read dir %s: %v", dir, err)
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names
}

func TestWriteFileAtomicRoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "server.properties")

	if err := writeFileAtomic(path, []byte("motd=hello\n"), 0644); err != nil {
		t.Fatalf("writeFileAtomic: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if string(got) != "motd=hello\n" {
		t.Errorf("contents = %q, want %q", got, "motd=hello\n")
	}

	// CreateTemp opens at 0600; the helper must restore the mode a direct
	// os.WriteFile gave, or every saved config silently tightens. Windows has
	// no POSIX modes to assert.
	if runtime.GOOS != "windows" {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatalf("stat: %v", err)
		}
		if perm := info.Mode().Perm(); perm != 0644 {
			t.Errorf("mode = %o, want 0644", perm)
		}
	}
}

func TestWriteFileAtomicOverwritesAnExistingFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "app_settings.json")

	if err := writeFileAtomic(path, []byte("first"), 0644); err != nil {
		t.Fatalf("first write: %v", err)
	}
	if err := writeFileAtomic(path, []byte("second"), 0644); err != nil {
		t.Fatalf("second write: %v", err)
	}

	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if string(got) != "second" {
		t.Errorf("contents = %q, want %q", got, "second")
	}
}

func TestWriteFileAtomicLeavesNoTempFileBehind(t *testing.T) {
	dir := t.TempDir()

	if err := writeFileAtomic(filepath.Join(dir, "layout.json"), []byte("{}"), 0644); err != nil {
		t.Fatalf("writeFileAtomic: %v", err)
	}

	if names := readDirNames(t, dir); len(names) != 1 || names[0] != "layout.json" {
		t.Errorf("directory holds %v, want only layout.json", names)
	}
}

// The reason this helper exists: a failure between "old content gone" and
// "new content down" must be impossible. Simulate the crash at the rename
// step and assert the target still holds the old bytes untouched, with the
// temp file cleaned up. Against a bare os.WriteFile the equivalent failure is
// a truncated or half-written file.
func TestWriteFileAtomicFailedRenameLeavesOldContentIntact(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "scheduler.json")
	if err := writeFileAtomic(path, []byte("old content"), 0644); err != nil {
		t.Fatalf("seed write: %v", err)
	}

	orig := renameFile
	renameFile = func(oldpath, newpath string) error {
		return errors.New("simulated crash at rename")
	}
	t.Cleanup(func() { renameFile = orig })

	err := writeFileAtomic(path, []byte("new content that must not land"), 0644)
	if err == nil {
		t.Fatal("writeFileAtomic with a failing rename = nil, want an error")
	}

	got, readErr := os.ReadFile(path)
	if readErr != nil {
		t.Fatalf("read back: %v", readErr)
	}
	if string(got) != "old content" {
		t.Errorf("contents after failed write = %q, want the old content intact", got)
	}
	if names := readDirNames(t, dir); len(names) != 1 || names[0] != "scheduler.json" {
		t.Errorf("directory holds %v, want the temp file removed", names)
	}
}

// Creating the temp file is the first touch of the filesystem, so a missing
// parent directory fails before the target could possibly be harmed. Callers
// that create directories (WriteDataFile) do so before calling this.
func TestWriteFileAtomicMissingParentDirFailsCleanly(t *testing.T) {
	parent := t.TempDir()
	path := filepath.Join(parent, "missing", "servers.json")

	err := writeFileAtomic(path, []byte("[]"), 0644)
	if err == nil {
		t.Fatal("writeFileAtomic into a missing dir = nil, want an error")
	}
	if names := readDirNames(t, parent); len(names) != 0 {
		t.Errorf("directory holds %v, want nothing created", names)
	}
}
