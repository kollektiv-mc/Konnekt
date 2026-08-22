package services

import (
	"fmt"
	"os"
	"path/filepath"
)

// renameFile is os.Rename, swapped by tests to simulate a crash at the rename
// step. It exists only as that seam.
var renameFile = os.Rename

// writeFileAtomic writes data to path so that a crash or power loss mid-write
// can never leave a truncated file: a reader sees either the old content or
// the new, nothing in between. It writes a sibling temp file in path's own
// directory (same filesystem, so the final rename cannot cross a mount and
// lose atomicity), fsyncs it, then renames it over path.
//
// os.Rename replaces an existing target on every platform this app ships to
// (on Windows it is MoveFileEx with MOVEFILE_REPLACE_EXISTING). Do not "help"
// it with a remove-then-rename fallback: the gap between remove and rename is
// exactly the torn-write window this helper exists to close. A Windows
// sharing violation (the target open in another process) surfaces as an error
// instead.
func writeFileAtomic(path string, data []byte, perm os.FileMode) error {
	dir := filepath.Dir(path)
	f, err := os.CreateTemp(dir, "."+filepath.Base(path)+".tmp-*")
	if err != nil {
		return fmt.Errorf("create temp file in %s: %w", dir, err)
	}
	tmp := f.Name()

	if _, err := f.Write(data); err != nil {
		f.Close()
		removeTemp(tmp)
		return fmt.Errorf("write %s: %w", tmp, err)
	}
	// Sync before rename, or a power loss can make the rename durable while
	// the bytes it points at are not: a correctly named empty file.
	if err := f.Sync(); err != nil {
		f.Close()
		removeTemp(tmp)
		return fmt.Errorf("sync %s: %w", tmp, err)
	}
	if err := f.Close(); err != nil {
		removeTemp(tmp)
		return fmt.Errorf("close %s: %w", tmp, err)
	}
	// CreateTemp opens at 0600; match the mode a direct os.WriteFile gave.
	if err := os.Chmod(tmp, perm); err != nil {
		removeTemp(tmp)
		return fmt.Errorf("chmod %s: %w", tmp, err)
	}
	if err := renameFile(tmp, path); err != nil {
		removeTemp(tmp)
		return fmt.Errorf("rename %s over %s: %w", tmp, path, err)
	}
	return nil
}

// removeTemp discards a temp file on a failure path. The write's own error is
// already on its way to the caller and names the temp path; a secondary
// removal failure has nothing actionable to add, so it is logged nowhere and
// the file is at worst an orphan the next successful write ignores.
func removeTemp(tmp string) {
	_ = os.Remove(tmp) //nolint:errcheck // see comment above
}
