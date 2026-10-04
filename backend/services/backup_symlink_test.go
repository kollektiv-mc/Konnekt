package services

import (
	"archive/zip"
	"bytes"
	"crypto/rand"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// symlinkWorld builds a world directory holding one ordinary file plus two
// links that lead outside it: one to a file and one to a directory. The files
// they point at carry random bytes, which deflate stores rather than encodes,
// so a leak would show up in the raw archive as well as in an entry's contents.
func symlinkWorld(t *testing.T) (world string, secrets [][]byte) {
	t.Helper()
	outside := t.TempDir()
	world = t.TempDir()

	fileSecret := make([]byte, 4096)
	dirSecret := make([]byte, 4096)
	for _, b := range [][]byte{fileSecret, dirSecret} {
		if _, err := rand.Read(b); err != nil {
			t.Fatal(err)
		}
	}
	outsideFile := filepath.Join(outside, "id_rsa")
	if err := os.WriteFile(outsideFile, fileSecret, 0600); err != nil {
		t.Fatal(err)
	}
	outsideDir := filepath.Join(outside, "dotssh")
	if err := os.MkdirAll(outsideDir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outsideDir, "key"), dirSecret, 0600); err != nil {
		t.Fatal(err)
	}

	if err := os.WriteFile(filepath.Join(world, "level.dat"), []byte("real world data"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outsideFile, filepath.Join(world, "linked-file")); err != nil {
		t.Skipf("symlinks unavailable here: %v", err)
	}
	if err := os.Symlink(outsideDir, filepath.Join(world, "linked-dir")); err != nil {
		t.Skipf("symlinks unavailable here: %v", err)
	}
	return world, [][]byte{fileSecret, dirSecret}
}

// assertNoLeak fails if the archive names a link or holds any secret byte
// sequence, in an entry or in the raw zip, and returns the entry names.
func assertNoLeak(t *testing.T, raw []byte, secrets [][]byte) []string {
	t.Helper()
	for _, s := range secrets {
		if bytes.Contains(raw, s) {
			t.Error("a file outside the world appears in the raw archive")
		}
	}
	zr, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatalf("archive does not open: %v", err)
	}
	var names []string
	for _, f := range zr.File {
		names = append(names, f.Name)
		if strings.Contains(f.Name, "linked-") {
			t.Errorf("archive has an entry for the link %q", f.Name)
		}
		rc, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			t.Fatal(err)
		}
		for _, s := range secrets {
			if bytes.Contains(body, s) {
				t.Errorf("entry %q holds bytes read through a symlink", f.Name)
			}
		}
	}
	return names
}

// A symlink in a world used to be followed by os.Open (#438): a link to a file
// archived its target, and a link to a directory failed the whole backup.
func TestBackupSkipsSymlinksInsteadOfFollowingThem(t *testing.T) {
	world, secrets := symlinkWorld(t)

	cases := []struct {
		name string
		zip  func(dest io.Writer) error
		want string
	}{
		{"zipDirWithProgress", func(dest io.Writer) error { return zipDirWithProgress(world, dest, nil) }, "level.dat"},
		{"zipRootsWithProgress", func(dest io.Writer) error {
			return zipRootsWithProgress([]string{world}, dest, nil)
		}, filepath.Base(world) + "/level.dat"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var buf bytes.Buffer
			if err := tc.zip(&buf); err != nil {
				t.Fatalf("backup failed over a symlink: %v", err)
			}
			names := assertNoLeak(t, buf.Bytes(), secrets)
			found := false
			for _, n := range names {
				if n == tc.want {
					found = true
				}
			}
			if !found {
				t.Errorf("ordinary file %q missing from archive, got %v", tc.want, names)
			}
		})
	}
}

// The progress total counts what the archive writes, not what a link points at.
func TestDirSizeCountsOnlyRegularFiles(t *testing.T) {
	world, _ := symlinkWorld(t)
	if got, want := dirSize(world), int64(len("real world data")); got != want {
		t.Errorf("dirSize = %d, want %d (links must not count)", got, want)
	}
}

// A world folder that is itself a link is refused rather than skipped: the
// entry-level skip would otherwise leave an empty archive reported as a
// successful backup.
func TestBackupRefusesALinkedWorldRoot(t *testing.T) {
	target := t.TempDir()
	if err := os.WriteFile(filepath.Join(target, "level.dat"), []byte("real world data"), 0644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(t.TempDir(), "world")
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symlinks unavailable here: %v", err)
	}

	if err := zipDirWithProgress(link, io.Discard, nil); err == nil {
		t.Error("zipDirWithProgress succeeded on a linked world root, want an error")
	}
	if err := zipRootsWithProgress([]string{link}, io.Discard, nil); err == nil {
		t.Error("zipRootsWithProgress succeeded on a linked world root, want an error")
	}
}
