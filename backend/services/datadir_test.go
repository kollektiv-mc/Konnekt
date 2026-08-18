package services

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The data directory is created once at startup and, before WriteDataFile, by
// nothing else. A directory that was never created — or was removed or renamed
// while the app runs — turned every save into an ENOENT naming the file rather
// than the missing directory. Against a bare os.WriteFile this test fails with
// exactly that error.
func TestWriteDataFileCreatesAMissingDataDir(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "konnekt")

	if err := WriteDataFile(dir, "servers.json", []byte(`[]`)); err != nil {
		t.Fatalf("WriteDataFile into a missing dir: %v", err)
	}

	got, err := os.ReadFile(filepath.Join(dir, "servers.json"))
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if string(got) != `[]` {
		t.Errorf("contents = %q, want %q", got, `[]`)
	}
}

func TestWriteDataFileCreatesNestedParents(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "a", "b", "konnekt")

	if err := WriteDataFile(dir, "app_settings.json", []byte(`{}`)); err != nil {
		t.Fatalf("WriteDataFile: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "app_settings.json")); err != nil {
		t.Errorf("stat written file: %v", err)
	}
}

// filepath.Join("", name) is a *relative* path, so the previous bare
// os.WriteFile silently dropped the file into the process's working directory
// whenever the data dir was unset — in the shipped app, wherever the user
// launched Konnekt from. Failing loudly is the point of this case.
func TestWriteDataFileRejectsAnUnsetDataDir(t *testing.T) {
	cwd := t.TempDir()
	t.Chdir(cwd)

	err := WriteDataFile("", "scheduler.json", []byte(`[]`))
	if err == nil {
		t.Fatal("WriteDataFile with an empty dir = nil, want an error")
	}
	if !strings.Contains(err.Error(), "data directory is not set") {
		t.Errorf("error = %v, want it to name the unset data directory", err)
	}
	if _, err := os.Stat(filepath.Join(cwd, "scheduler.json")); !os.IsNotExist(err) {
		t.Errorf("scheduler.json was written into the working directory (stat err = %v)", err)
	}
}

func TestWriteDataFileOverwritesAnExistingFile(t *testing.T) {
	dir := t.TempDir()

	if err := WriteDataFile(dir, "active_layout.json", []byte("first")); err != nil {
		t.Fatalf("first write: %v", err)
	}
	if err := WriteDataFile(dir, "active_layout.json", []byte("second")); err != nil {
		t.Fatalf("second write: %v", err)
	}

	got, err := os.ReadFile(filepath.Join(dir, "active_layout.json"))
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if string(got) != "second" {
		t.Errorf("contents = %q, want %q", got, "second")
	}
}

// The error has to name the directory, not just the file: the whole reason the
// bare ENOENT was worth replacing is that it pointed at the wrong thing.
func TestWriteDataFileErrorNamesTheDirectoryItCouldNotCreate(t *testing.T) {
	// A regular file where a directory needs to be — the one MkdirAll failure
	// that reproduces identically on every OS this app ships to.
	blocker := filepath.Join(t.TempDir(), "konnekt")
	if err := os.WriteFile(blocker, []byte("not a directory"), 0644); err != nil {
		t.Fatalf("setup: %v", err)
	}

	err := WriteDataFile(blocker, "servers.json", []byte(`[]`))
	if err == nil {
		t.Fatal("WriteDataFile onto a file-shaped data dir = nil, want an error")
	}
	if !strings.Contains(err.Error(), blocker) {
		t.Errorf("error = %v, want it to name %s", err, blocker)
	}
}
