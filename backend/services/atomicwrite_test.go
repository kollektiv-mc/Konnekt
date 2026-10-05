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

// modeOf returns path's permission bits, failing the test if it cannot be
// stat'd.
func modeOf(t *testing.T, path string) os.FileMode {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat %s: %v", path, err)
	}
	return info.Mode().Perm()
}

// writeFileAtomic must never widen a file past what the user set (#430): a
// 0600 server.properties holds the RCON password and used to come back 0644.
func TestWriteFileAtomicKeepsANarrowerExistingMode(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX mode bits are not meaningful on Windows")
	}
	path := filepath.Join(t.TempDir(), "server.properties")
	if err := os.WriteFile(path, []byte("rcon.password=hunter2\n"), 0600); err != nil {
		t.Fatal(err)
	}

	if err := writeFileAtomic(path, []byte("rcon.password=changed\n"), 0644); err != nil {
		t.Fatalf("writeFileAtomic: %v", err)
	}
	if got := modeOf(t, path); got != 0600 {
		t.Errorf("mode = %o, want 0600 kept", got)
	}
}

// The other direction: WritePrivateDataFile asks for 0600 and must narrow a
// file an older build left at 0644, so "keep the existing mode" is not enough.
func TestWriteFileAtomicNarrowsAWiderExistingFileToPerm(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX mode bits are not meaningful on Windows")
	}
	path := filepath.Join(t.TempDir(), "remote.json")
	if err := os.WriteFile(path, []byte("old"), 0644); err != nil {
		t.Fatal(err)
	}
	// WriteFile is subject to the umask, so pin the starting mode.
	if err := os.Chmod(path, 0644); err != nil {
		t.Fatal(err)
	}

	if err := writeFileAtomic(path, []byte("new"), 0600); err != nil {
		t.Fatalf("writeFileAtomic: %v", err)
	}
	if got := modeOf(t, path); got != 0600 {
		t.Errorf("mode = %o, want 0600", got)
	}
}

// A file that does not exist yet gets exactly perm. CreateTemp opens at 0600
// and the helper chmods afterwards, which the umask does not touch, so 0644
// survives even under a restrictive umask.
func TestWriteFileAtomicGivesANewFileExactlyPerm(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX mode bits are not meaningful on Windows")
	}
	for _, perm := range []os.FileMode{0644, 0600, 0755} {
		path := filepath.Join(t.TempDir(), "fresh")
		if err := writeFileAtomic(path, []byte("x"), perm); err != nil {
			t.Fatalf("writeFileAtomic(%o): %v", perm, err)
		}
		if got := modeOf(t, path); got != perm {
			t.Errorf("new file mode = %o, want %o", got, perm)
		}
	}
}

// The mode is intersected, never unioned: an existing 0600 file asked for 0755
// stays 0600 rather than gaining bits it never had.
func TestWriteFileAtomicNeverWidensBeyondTheExistingMode(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX mode bits are not meaningful on Windows")
	}
	path := filepath.Join(t.TempDir(), "run.sh")
	if err := os.WriteFile(path, []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := writeFileAtomic(path, []byte("new"), 0755); err != nil {
		t.Fatalf("writeFileAtomic: %v", err)
	}
	if got := modeOf(t, path); got != 0600 {
		t.Errorf("mode = %o, want 0600", got)
	}
}
