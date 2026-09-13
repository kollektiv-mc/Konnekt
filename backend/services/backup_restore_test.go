package services

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// ─── Restore paths the round trip never reached ────────────────────────────
//
// The 2026-09-12 mutation run (#348) found the world-only restore, the legacy
// layout and both rollbacks untested: every guard in them could be deleted
// with the suite green. Each test below is a way the restore could be wrong
// that a user would notice.

// subscribeStringEvent is subscribeFailed for the events whose payload is a
// map[string]string (backup:started, backup:restore-completed).
func subscribeStringEvent(t *testing.T, svc *BackupService, event string) <-chan map[string]string {
	t.Helper()
	if svc.bus == nil {
		svc.bus = NewEventBus()
	}
	ch := make(chan map[string]string, 4)
	svc.bus.Subscribe(event, func(data any) {
		payload, _ := data.(map[string]string)
		ch <- payload
	})
	return ch
}

func awaitStringEvent(t *testing.T, ch <-chan map[string]string, event string) map[string]string {
	t.Helper()
	select {
	case p := <-ch:
		return p
	case <-time.After(2 * time.Second):
		t.Fatalf("no %s event", event)
		return nil
	}
}

func assertNoStringEvent(t *testing.T, ch <-chan map[string]string, event string) {
	t.Helper()
	select {
	case p := <-ch:
		t.Errorf("unexpected %s event: %v", event, p)
	case <-time.After(200 * time.Millisecond):
	}
}

// leftovers lists the entries under dir that a restore should never leave
// behind: the set-aside copy and the staging directory.
func leftovers(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, e := range entries {
		if strings.Contains(e.Name(), ".bak-") || strings.HasPrefix(e.Name(), "konnekt-restore-") {
			out = append(out, e.Name())
		}
	}
	return out
}

func TestRestoreNamedWorldBackupReplacesOnlyThatWorld(t *testing.T) {
	svc, workDir := newBackupFixture(t)
	writeFile(t, filepath.Join(workDir, "server.properties"), "level-name=world\n")
	writeFile(t, filepath.Join(workDir, "world", "level.dat"), "v1")
	b, err := svc.CreateWorldBackup(testServerID, "world")
	if err != nil {
		t.Fatalf("CreateWorldBackup: %v", err)
	}

	// The world moves on after the backup, and so does a file outside it.
	writeFile(t, filepath.Join(workDir, "world", "level.dat"), "v2")
	writeFile(t, filepath.Join(workDir, "world", "extra.txt"), "later")
	writeFile(t, filepath.Join(workDir, "server.properties"), "level-name=world\nmotd=kept\n")
	completed := subscribeStringEvent(t, svc, EventRestoreCompleted)

	if err := svc.RestoreBackup(testServerID, b.Filename); err != nil {
		t.Fatalf("RestoreBackup: %v", err)
	}
	if got, err := os.ReadFile(filepath.Join(workDir, "world", "level.dat")); err != nil || string(got) != "v1" {
		t.Errorf("level.dat = %q, %v; want the backed-up %q", got, err, "v1")
	}
	if _, err := os.Stat(filepath.Join(workDir, "world", "extra.txt")); err == nil {
		t.Error("a file added after the backup survived the restore")
	}
	if got, err := os.ReadFile(filepath.Join(workDir, "server.properties")); err != nil || !strings.Contains(string(got), "motd=kept") {
		t.Errorf("server.properties = %q, %v; a world restore must not touch server files", got, err)
	}
	if left := leftovers(t, workDir); len(left) != 0 {
		t.Errorf("restore left %v behind", left)
	}
	lines := strings.Join(consoleLines(svc.server), "\n")
	if !strings.Contains(lines, `Restoring world "world" from `+b.Filename) || !strings.Contains(lines, `Restore finished, world "world" replaced`) {
		t.Errorf("narration = %q, want the world named at start and finish", lines)
	}
	if p := awaitStringEvent(t, completed, EventRestoreCompleted); p["serverID"] != testServerID || p["filename"] != b.Filename {
		t.Errorf("restore-completed payload = %v", p)
	}
}

// A world that is gone is not an error: the tolerance for a missing target is
// what lets a backup be restored after the world was deleted.
func TestRestoreWorldBackupRecreatesAMissingWorld(t *testing.T) {
	svc, workDir := newBackupFixture(t)
	writeFile(t, filepath.Join(workDir, "world", "level.dat"), "v1")
	b, err := svc.CreateWorldBackup(testServerID, "world")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(filepath.Join(workDir, "world")); err != nil {
		t.Fatal(err)
	}
	if err := svc.RestoreBackup(testServerID, b.Filename); err != nil {
		t.Fatalf("RestoreBackup into a missing world: %v", err)
	}
	if got, err := os.ReadFile(filepath.Join(workDir, "world", "level.dat")); err != nil || string(got) != "v1" {
		t.Errorf("level.dat = %q, %v; want %q", got, err, "v1")
	}
}

// A pre-split world archive carries no world name, so it restores into the
// server's active world: level-name, or "world" when that is unset.
func TestRestoreLegacyWorldBackupUsesTheActiveWorldPath(t *testing.T) {
	cases := []struct {
		name, properties, want string
	}{
		{"level-name set", "level-name=custom\n", "custom"},
		{"level-name empty", "level-name=\n", "world"},
		{"no server.properties", "", "world"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc, workDir := newBackupFixture(t)
			if tc.properties != "" {
				writeFile(t, filepath.Join(workDir, "server.properties"), tc.properties)
			}
			root, err := svc.backupRoot(testServerID)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.MkdirAll(root, 0755); err != nil {
				t.Fatal(err)
			}
			makeZip(t, filepath.Join(root, "oldworld.zip"), map[string]string{"level.dat": "legacy-level"})
			writeFile(t, filepath.Join(workDir, tc.want, "level.dat"), "stale")
			writeFile(t, filepath.Join(workDir, tc.want, "junk.txt"), "junk")

			if err := svc.RestoreBackup(testServerID, "oldworld.zip"); err != nil {
				t.Fatalf("RestoreBackup: %v", err)
			}
			if got, err := os.ReadFile(filepath.Join(workDir, tc.want, "level.dat")); err != nil || string(got) != "legacy-level" {
				t.Errorf("%s/level.dat = %q, %v; want the archive's", tc.want, got, err)
			}
			if _, err := os.Stat(filepath.Join(workDir, tc.want, "junk.txt")); err == nil {
				t.Error("the stale world's extra file survived")
			}
			if lines := strings.Join(consoleLines(svc.server), "\n"); !strings.Contains(lines, `Restoring world "`+tc.want+`" from oldworld.zip`) {
				t.Errorf("narration = %q, want the target world named", lines)
			}
		})
	}
}

func TestRestoreLegacyServerBackupReplacesTheWorkingDirectory(t *testing.T) {
	svc, workDir := newBackupFixture(t)
	root, err := svc.backupRoot(testServerID)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(root, 0755); err != nil {
		t.Fatal(err)
	}
	makeZip(t, filepath.Join(root, "12345_full.zip"), map[string]string{
		"server.properties": "level-name=world\n",
		"marker.txt":        "from-backup",
	})
	writeFile(t, filepath.Join(workDir, "stray.txt"), "stray")

	if err := svc.RestoreBackup(testServerID, "12345_full.zip"); err != nil {
		t.Fatalf("RestoreBackup: %v", err)
	}
	if got, err := os.ReadFile(filepath.Join(workDir, "marker.txt")); err != nil || string(got) != "from-backup" {
		t.Errorf("marker.txt = %q, %v", got, err)
	}
	if _, err := os.Stat(filepath.Join(workDir, "stray.txt")); err == nil {
		t.Error("a file that was not in the archive survived a full restore")
	}
	if left := leftovers(t, filepath.Dir(workDir)); len(left) != 0 {
		t.Errorf("restore left %v beside the working directory", left)
	}
	if lines := strings.Join(consoleLines(svc.server), "\n"); !strings.Contains(lines, "Restoring the server from 12345_full.zip") {
		t.Errorf("narration = %q", lines)
	}
}

// The swap is the one step that cannot be undone by deleting the staging
// directory: the current files have already been moved aside. When the final
// rename fails they have to come back, and the failure has to say so.
//
// A rename across filesystems is the one way to make that step fail on
// demand: the staging directory is put on /dev/shm, which on Linux is a
// separate mount from the temp directory. Elsewhere the test skips.
func TestRestoreRollsBackWhenTheSwapFails(t *testing.T) {
	shm := "/dev/shm"
	if info, err := os.Stat(shm); err != nil || !info.IsDir() {
		t.Skip("no /dev/shm to stage on another filesystem")
	}
	staging, err := os.MkdirTemp(shm, "konnekt-test-*")
	if err != nil {
		t.Skip("cannot write to /dev/shm")
	}
	t.Cleanup(func() { _ = os.RemoveAll(staging) })
	probe := filepath.Join(staging, "probe")
	writeFile(t, probe, "p")
	if err := os.Rename(probe, filepath.Join(t.TempDir(), "probe")); err == nil {
		t.Skip("the temp directory and /dev/shm share a filesystem, so the swap cannot be made to fail")
	}

	cases := []struct {
		name   string
		backup func(svc *BackupService) (string, error)
	}{
		{"server backup", func(svc *BackupService) (string, error) {
			b, err := svc.CreateBackup(testServerID)
			return b.Filename, err
		}},
		{"world backup", func(svc *BackupService) (string, error) {
			b, err := svc.CreateWorldBackup(testServerID, "world")
			return b.Filename, err
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc, workDir := newBackupFixture(t)
			writeFile(t, filepath.Join(workDir, "world", "level.dat"), "v1")
			filename, err := tc.backup(svc)
			if err != nil {
				t.Fatal(err)
			}
			writeFile(t, filepath.Join(workDir, "world", "level.dat"), "v2")

			orig := mkdirTempRestore
			mkdirTempRestore = func(_, pattern string) (string, error) { return os.MkdirTemp(staging, pattern) }
			t.Cleanup(func() { mkdirTempRestore = orig })
			failed := subscribeFailed(t, svc, EventRestoreFailed)

			err = svc.RestoreBackup(testServerID, filename)
			if err == nil {
				t.Fatal("RestoreBackup across filesystems = nil error, want the swap to fail")
			}
			// The step is narrated and emitted rather than wrapped into the error,
			// which stays the raw rename failure for the toast.
			if !strings.Contains(err.Error(), "rename") {
				t.Errorf("error = %q, want the rename failure itself", err)
			}
			if got, err := os.ReadFile(filepath.Join(workDir, "world", "level.dat")); err != nil || string(got) != "v2" {
				t.Errorf("level.dat after the failed swap = %q, %v; want the current %q put back", got, err, "v2")
			}
			if left := leftovers(t, workDir); len(left) != 0 {
				t.Errorf("failed restore left %v in the working directory", left)
			}
			if left := leftovers(t, filepath.Dir(workDir)); len(left) != 0 {
				t.Errorf("failed restore left %v beside the working directory", left)
			}
			entries, err := os.ReadDir(staging)
			if err != nil {
				t.Fatal(err)
			}
			for _, e := range entries {
				if strings.HasPrefix(e.Name(), "konnekt-restore-") {
					t.Errorf("staging directory %s not removed", e.Name())
				}
			}
			if p := awaitFailed(t, failed, EventRestoreFailed); p["serverID"] != testServerID {
				t.Errorf("payload = %v", p)
			}
			if lines := strings.Join(consoleLines(svc.server), "\n"); !strings.Contains(lines, "Restore failed while swapping files, previous state kept") {
				t.Errorf("narration = %q", lines)
			}
		})
	}
}

// Moving the current files aside fails when their parent is not a directory.
// A missing target is tolerated (the world was deleted); anything else stops
// the restore before the archive is put in place, and says which step.
// nameAtLimit is the longest name a directory can have: NAME_MAX on Linux
// and the per-component limit on NTFS are both 255. The set-aside appends
// ".bak-" and a timestamp to the current directory's name, so a world at the
// limit can be created but never moved aside, and the rename fails with the
// directory still in place, on every platform the suite runs on. (The fixture
// this replaced made the target's parent a file, which is ENOTDIR on Linux
// but ERROR_PATH_NOT_FOUND on Windows, and that one is os.IsNotExist there,
// so the set-aside read as "nothing to move" and the swap failed instead.)
const nameAtLimit = 255

func TestRestoreReportsAFailedSetAside(t *testing.T) {
	longName := strings.Repeat("w", nameAtLimit)

	t.Run("world restore", func(t *testing.T) {
		svc, workDir := newBackupFixture(t)
		writeFile(t, filepath.Join(workDir, longName, "level.dat"), "current")
		writeFile(t, filepath.Join(workDir, "server.properties"), "level-name="+longName+"\n")
		root, err := svc.backupRoot(testServerID)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(root, 0755); err != nil {
			t.Fatal(err)
		}
		makeZip(t, filepath.Join(root, "oldworld.zip"), map[string]string{"level.dat": "legacy-level"})
		orig := mkdirTempRestore
		mkdirTempRestore = func(_, pattern string) (string, error) { return os.MkdirTemp(t.TempDir(), pattern) }
		t.Cleanup(func() { mkdirTempRestore = orig })
		failed := subscribeFailed(t, svc, EventRestoreFailed)

		err = svc.RestoreBackup(testServerID, "oldworld.zip")
		if err == nil {
			t.Fatal("RestoreBackup with a world name at the limit = nil error, want the set-aside to fail")
		}
		if p := awaitFailed(t, failed, EventRestoreFailed); p["serverID"] != testServerID || p["error"] != err.Error() {
			t.Errorf("payload = %v, want the server and the error", p)
		}
		if lines := strings.Join(consoleLines(svc.server), "\n"); !strings.Contains(lines, "Restore failed while moving the current files aside") {
			t.Errorf("narration = %q, want the set-aside step named", lines)
		}
		if got, err := os.ReadFile(filepath.Join(workDir, longName, "level.dat")); err != nil || string(got) != "current" {
			t.Errorf("the current world was disturbed: %q, %v", got, err)
		}
	})

	t.Run("server restore", func(t *testing.T) {
		svc, _ := newBackupFixture(t)
		cfg, err := svc.config.GetServerConfig(testServerID)
		if err != nil {
			t.Fatal(err)
		}
		cfg.WorkingDir = filepath.Join(t.TempDir(), longName)
		if err := svc.config.SaveServerConfig(*cfg); err != nil {
			t.Fatal(err)
		}
		writeFile(t, filepath.Join(cfg.WorkingDir, "marker.txt"), "current")
		root, err := svc.backupRoot(testServerID)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(root, 0755); err != nil {
			t.Fatal(err)
		}
		makeZip(t, filepath.Join(root, "12345_full.zip"), map[string]string{"marker.txt": "x"})
		orig := mkdirTempRestore
		mkdirTempRestore = func(_, pattern string) (string, error) { return os.MkdirTemp(t.TempDir(), pattern) }
		t.Cleanup(func() { mkdirTempRestore = orig })

		if err := svc.RestoreBackup(testServerID, "12345_full.zip"); err == nil {
			t.Fatal("RestoreBackup with a working directory name at the limit = nil error, want the set-aside to fail")
		}
		if lines := strings.Join(consoleLines(svc.server), "\n"); !strings.Contains(lines, "Restore failed while moving the current files aside") {
			t.Errorf("narration = %q, want the set-aside step named", lines)
		}
		if got, err := os.ReadFile(filepath.Join(cfg.WorkingDir, "marker.txt")); err != nil || string(got) != "current" {
			t.Errorf("the current server files were disturbed: %q, %v", got, err)
		}
	})
}

// ─── The sidecar, and the events around a backup ───────────────────────────

func TestDeleteBackupDropsItsMetadata(t *testing.T) {
	svc, workDir := newBackupFixture(t)
	writeFile(t, filepath.Join(workDir, "world", "level.dat"), "data")
	b, err := svc.CreateBackup(testServerID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateBackupMeta(testServerID, b.Filename, "Named", []string{"t"}); err != nil {
		t.Fatal(err)
	}
	if err := svc.DeleteBackup(testServerID, b.Filename); err != nil {
		t.Fatal(err)
	}
	dir, err := svc.serverBackupDir(testServerID)
	if err != nil {
		t.Fatal(err)
	}
	meta, err := svc.loadMeta(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, still := meta[b.Filename]; still {
		t.Error("meta.json still carries the deleted backup")
	}

	if err := svc.DeleteBackup(testServerID, "missing.zip"); err == nil || !strings.Contains(err.Error(), "missing.zip") {
		t.Errorf("DeleteBackup(unknown) = %v, want an error naming the file", err)
	}
	if err := svc.DeleteBackup(testServerID, filepath.Join("..", "x.zip")); err == nil {
		t.Error("DeleteBackup accepted a traversing filename")
	}
}

func TestUpdateBackupMetaRefusalsAndSidecarFailures(t *testing.T) {
	svc, workDir := newBackupFixture(t)
	writeFile(t, filepath.Join(workDir, "world", "level.dat"), "data")
	b, err := svc.CreateBackup(testServerID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateBackupMeta(testServerID, "missing.zip", "x", nil); err == nil {
		t.Error("UpdateBackupMeta(unknown) = nil error")
	}
	if _, err := svc.UpdateBackupMeta(testServerID, filepath.Join("..", "x.zip"), "x", nil); err == nil {
		t.Error("UpdateBackupMeta accepted a traversing filename")
	}

	// A world backup reports its kind and world back.
	wb, err := svc.CreateWorldBackup(testServerID, "world")
	if err != nil {
		t.Fatal(err)
	}
	updated, err := svc.UpdateBackupMeta(testServerID, wb.Filename, "W", nil)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Kind != "world" || updated.World != "world" || updated.SizeBytes != wb.SizeBytes || updated.CreatedAt != wb.CreatedAt {
		t.Errorf("updated world backup = %+v, want kind, world, size and time preserved", updated)
	}

	// A sidecar that will not parse is treated as empty and rewritten.
	dir, err := svc.serverBackupDir(testServerID)
	if err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(dir, "meta.json"), "{not json")
	if _, err := svc.UpdateBackupMeta(testServerID, b.Filename, "Named", []string{"a"}); err != nil {
		t.Fatalf("UpdateBackupMeta over a corrupt sidecar: %v", err)
	}
	meta, err := svc.loadMeta(dir)
	if err != nil || meta[b.Filename].DisplayName != "Named" {
		t.Errorf("sidecar after rewrite = %v, %v", meta, err)
	}

	// A sidecar that cannot be read at all refuses the write and degrades the
	// listing to untagged rather than hiding the archive.
	if err := os.Remove(filepath.Join(dir, "meta.json")); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, "meta.json"), 0755); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateBackupMeta(testServerID, b.Filename, "Again", nil); err == nil {
		t.Error("UpdateBackupMeta with an unreadable sidecar = nil error")
	}
	list, err := svc.ListBackups(testServerID)
	if err != nil {
		t.Fatalf("ListBackups with an unreadable sidecar: %v", err)
	}
	var listed bool
	for _, got := range list {
		if got.Filename == b.Filename {
			listed = true
			if got.DisplayName != "" || got.Tags == nil || len(got.Tags) != 0 {
				t.Errorf("listed as %+v, want untagged", got)
			}
		}
	}
	if !listed {
		t.Error("the backup vanished from the listing with its sidecar unreadable")
	}
}

// The in-progress row lives on these events: started carries the filename it
// will show, progress climbs and never repeats a value, completed names the
// same file. All three name the server, for both kinds of backup.
func TestBackupEventsCarryTheServerAndProgress(t *testing.T) {
	cases := []struct {
		name string
		dir  string // the directory the files go in, relative to the working dir
		run  func(svc *BackupService) (string, error)
	}{
		{"server backup", ".", func(svc *BackupService) (string, error) {
			b, err := svc.CreateBackup(testServerID)
			return b.Filename, err
		}},
		{"world backup", "world", func(svc *BackupService) (string, error) {
			b, err := svc.CreateWorldBackup(testServerID, "world")
			return b.Filename, err
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc, workDir := newBackupFixture(t)
			// One byte of two hundred rounds to 0%: the first step is reported
			// even at zero, the empty third file must not repeat the 100.
			writeFile(t, filepath.Join(workDir, tc.dir, "a.txt"), "1")
			writeFile(t, filepath.Join(workDir, tc.dir, "b.txt"), strings.Repeat("x", 199))
			writeFile(t, filepath.Join(workDir, tc.dir, "c.txt"), "")
			started := subscribeStringEvent(t, svc, EventBackupStarted)
			progress := subscribeFailed(t, svc, EventBackupProgress)
			completed := subscribeFailed(t, svc, EventBackupCompleted)

			filename, err := tc.run(svc)
			if err != nil {
				t.Fatal(err)
			}
			if p := awaitStringEvent(t, started, EventBackupStarted); p["serverID"] != testServerID || p["filename"] != filename {
				t.Errorf("started payload = %v", p)
			}
			if p := awaitFailed(t, completed, EventBackupCompleted); p["serverID"] != testServerID || p["filename"] != filename {
				t.Errorf("completed payload = %v", p)
			}
			percents := map[int]int{}
			deadline := time.After(500 * time.Millisecond)
			for len(percents) < 2 {
				select {
				case p := <-progress:
					if p["serverID"] != testServerID {
						t.Errorf("progress payload = %v", p)
					}
					pct, _ := p["percent"].(int)
					percents[pct]++
				case <-deadline:
					t.Fatalf("progress events = %v, want 0 and 100", percents)
				}
			}
			assertNoEvent(t, progress, EventBackupProgress)
			if len(percents) != 2 || percents[0] != 1 || percents[100] != 1 {
				t.Errorf("progress percents = %v, want exactly one 0 and one 100", percents)
			}
		})
	}

	t.Run("nothing to copy reports no progress", func(t *testing.T) {
		svc, _ := newBackupFixture(t) // the fixture's world directory is empty
		progress := subscribeFailed(t, svc, EventBackupProgress)
		b, err := svc.CreateWorldBackup(testServerID, "world")
		if err != nil {
			t.Fatalf("an empty world must still back up: %v", err)
		}
		if b.Kind != "world" || b.World != "world" || b.Tags == nil || b.SizeBytes <= 0 {
			t.Errorf("returned backup = %+v, want kind, world, empty tags and the archive's size", b)
		}
		assertNoEvent(t, progress, EventBackupProgress)
	})
}

// ─── The quiesce around a backup ───────────────────────────────────────────

func TestBackupQuiescesARunningServer(t *testing.T) {
	svc, workDir := newBackupFixture(t)
	writeFile(t, filepath.Join(workDir, "world", "level.dat"), "data")
	release, _ := fakeRunningServer(t, svc.server)
	svc.server.quiesceWait = time.Millisecond

	if _, err := svc.CreateBackup(testServerID); err != nil {
		t.Fatalf("CreateBackup on a running server: %v", err)
	}
	lines := consoleLines(svc.server)
	pause, resume := -1, -1
	for i, line := range lines {
		if line == "Pausing world saves and flushing to disk" {
			pause = i
		}
		if line == "Resuming world saves" {
			resume = i
		}
	}
	if pause == -1 || resume == -1 || pause > resume {
		t.Errorf("console = %v, want the saves paused before the copy and resumed after", lines)
	}

	in := svc.server.instanceFor(testServerID)
	in.mu.Lock()
	exited := in.exited
	in.mu.Unlock()
	release()
	select {
	case <-exited:
	case <-time.After(2 * time.Second):
		t.Fatal("fake server never exited")
	}
}

type brokenStdin struct{}

var errStdinBroken = errors.New("stdin broken")

func (brokenStdin) Write([]byte) (int, error) { return 0, errStdinBroken }
func (brokenStdin) Close() error              { return nil }

// A copy taken off a world still being written to is worse than no copy: when
// the saves cannot be paused the backup fails, with the reason, before
// anything is zipped (#309). Both kinds of backup quiesce the same way.
func TestBackupFailsWhenTheSavesCannotBePaused(t *testing.T) {
	cases := []struct {
		name string
		run  func(svc *BackupService) error
		dir  func(svc *BackupService) (string, error)
	}{
		{"server backup",
			func(svc *BackupService) error { _, err := svc.CreateBackup(testServerID); return err },
			func(svc *BackupService) (string, error) { return svc.serverBackupDir(testServerID) }},
		{"world backup",
			func(svc *BackupService) error { _, err := svc.CreateWorldBackup(testServerID, "world"); return err },
			func(svc *BackupService) (string, error) { return svc.worldBackupDir(testServerID, "world") }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc, workDir := newBackupFixture(t)
			writeFile(t, filepath.Join(workDir, "world", "level.dat"), "data")
			release, _ := fakeRunningServer(t, svc.server)
			defer release()
			in := svc.server.instanceFor(testServerID)
			in.mu.Lock()
			in.stdin = brokenStdin{}
			in.mu.Unlock()
			failed := subscribeFailed(t, svc, EventBackupFailed)

			err := tc.run(svc)
			if err == nil {
				t.Fatal("backup with a broken stdin = nil error, want the quiesce to fail it")
			}
			if !strings.Contains(err.Error(), "could not pause world saves") {
				t.Errorf("error = %q, want it to say the saves could not be paused", err)
			}
			if !errors.Is(err, errStdinBroken) {
				t.Errorf("error = %v, want it to wrap the stdin failure", err)
			}
			if p := awaitFailed(t, failed, EventBackupFailed); p["serverID"] != testServerID {
				t.Errorf("payload = %v", p)
			}
			dir, err := tc.dir(svc)
			if err != nil {
				t.Fatal(err)
			}
			entries, err := os.ReadDir(dir)
			if err != nil {
				t.Fatal(err)
			}
			for _, e := range entries {
				if strings.HasSuffix(e.Name(), ".zip") {
					t.Errorf("archive %s left behind by a backup that could not quiesce", e.Name())
				}
			}
			if lines := strings.Join(consoleLines(svc.server), "\n"); !strings.Contains(lines, "Backup failed: could not pause world saves") {
				t.Errorf("narration = %q", lines)
			}
		})
	}
}

// Fixtures elsewhere wire a BackupService with no ServerService at all; both
// backup kinds still work, with no quiesce and no narration.
func TestBackupWithNoServerServiceStillWorks(t *testing.T) {
	svc, workDir := newBackupFixture(t)
	svc.server = nil
	writeFile(t, filepath.Join(workDir, "world", "level.dat"), "data")
	if _, err := svc.CreateBackup(testServerID); err != nil {
		t.Errorf("CreateBackup without a ServerService: %v", err)
	}
	if _, err := svc.CreateWorldBackup(testServerID, "world"); err != nil {
		t.Errorf("CreateWorldBackup without a ServerService: %v", err)
	}
}

// ─── Refusals before backup:started ────────────────────────────────────────

func TestBackupRefusesBeforeStartWhenItsDirectoryCannotBeMade(t *testing.T) {
	svc, workDir := newBackupFixture(t)
	writeFile(t, filepath.Join(workDir, "world", "level.dat"), "data")
	root, err := svc.backupRoot(testServerID)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(root, 0755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(root, "server"), "a file where the server backup directory should be")
	writeFile(t, filepath.Join(root, "worlds"), "a file where the world backup directory should be")
	started := subscribeStringEvent(t, svc, EventBackupStarted)

	if _, err := svc.CreateBackup(testServerID); err == nil {
		t.Error("CreateBackup with its directory blocked = nil error")
	}
	if _, err := svc.CreateWorldBackup(testServerID, "world"); err == nil {
		t.Error("CreateWorldBackup with its directory blocked = nil error")
	}
	assertNoStringEvent(t, started, EventBackupStarted)
	if lines := consoleLines(svc.server); len(lines) != 0 {
		t.Errorf("console = %v, want nothing narrated for a refusal", lines)
	}
}

func TestBackupRefusesAnUnknownServerOrWorld(t *testing.T) {
	svc, _ := newBackupFixture(t)
	if _, err := svc.CreateBackup("no-such-server"); err == nil {
		t.Error("CreateBackup(unknown server) = nil error")
	}
	if _, err := svc.CreateWorldBackup("no-such-server", "world"); err == nil {
		t.Error("CreateWorldBackup(unknown server) = nil error")
	}
	if _, err := svc.CreateWorldBackup(testServerID, "atlantis"); err == nil || !strings.Contains(err.Error(), "atlantis") {
		t.Errorf("CreateWorldBackup(unknown world) = %v, want an error naming the world", err)
	}
	if err := svc.RestoreBackup("no-such-server", "12345_x.zip"); err == nil {
		t.Error("RestoreBackup(unknown server) = nil error")
	}
}

// The world branch of a restore has the same two early failures as the server
// branch, and the same duty to say so.
func TestRestoreWorldBackupReportsStagingAndExtractFailures(t *testing.T) {
	t.Run("staging", func(t *testing.T) {
		svc, workDir := newBackupFixture(t)
		writeFile(t, filepath.Join(workDir, "world", "level.dat"), "v1")
		b, err := svc.CreateWorldBackup(testServerID, "world")
		if err != nil {
			t.Fatal(err)
		}
		orig := mkdirTempRestore
		mkdirTempRestore = func(string, string) (string, error) { return "", errors.New("disk full") }
		t.Cleanup(func() { mkdirTempRestore = orig })
		failed := subscribeFailed(t, svc, EventRestoreFailed)

		if err := svc.RestoreBackup(testServerID, b.Filename); err == nil || !strings.Contains(err.Error(), "disk full") {
			t.Fatalf("RestoreBackup = %v, want the staging error", err)
		}
		if p := awaitFailed(t, failed, EventRestoreFailed); p["serverID"] != testServerID {
			t.Errorf("payload = %v", p)
		}
		if lines := strings.Join(consoleLines(svc.server), "\n"); !strings.Contains(lines, "Restore failed while preparing a staging directory") {
			t.Errorf("narration = %q", lines)
		}
		if got, err := os.ReadFile(filepath.Join(workDir, "world", "level.dat")); err != nil || string(got) != "v1" {
			t.Errorf("world touched by a restore that failed before staging: %q, %v", got, err)
		}
	})

	t.Run("extraction", func(t *testing.T) {
		svc, workDir := newBackupFixture(t)
		writeFile(t, filepath.Join(workDir, "world", "level.dat"), "v1")
		b, err := svc.CreateWorldBackup(testServerID, "world")
		if err != nil {
			t.Fatal(err)
		}
		zipPath, _, _, _, err := svc.findBackupFile(testServerID, b.Filename)
		if err != nil {
			t.Fatal(err)
		}
		writeFile(t, zipPath, "not a zip")
		failed := subscribeFailed(t, svc, EventRestoreFailed)

		if err := svc.RestoreBackup(testServerID, b.Filename); err == nil {
			t.Fatal("RestoreBackup over a corrupt world archive = nil error")
		}
		if p := awaitFailed(t, failed, EventRestoreFailed); p["serverID"] != testServerID {
			t.Errorf("payload = %v", p)
		}
		if lines := strings.Join(consoleLines(svc.server), "\n"); !strings.Contains(lines, "Restore failed while extracting") {
			t.Errorf("narration = %q", lines)
		}
		if got, err := os.ReadFile(filepath.Join(workDir, "world", "level.dat")); err != nil || string(got) != "v1" {
			t.Errorf("world touched by a restore that failed to extract: %q, %v", got, err)
		}
	})
}

// A directory that cannot be created is the same refusal for the folder the
// Backups tile opens as for a backup.
func TestOpenBackupDirRefusesABlockedDirectory(t *testing.T) {
	svc, _ := newBackupFixture(t)
	root, err := svc.backupRoot(testServerID)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(root, 0755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(root, "server"), "a file where the directory should be")
	if err := svc.OpenBackupDir(testServerID); err == nil {
		t.Error("OpenBackupDir with its directory blocked = nil error")
	}
	if err := svc.OpenBackupDir("../outside"); err == nil {
		t.Error("OpenBackupDir accepted a path as the server id")
	}
}

func TestReserveBackupFileReportsAMissingDirectory(t *testing.T) {
	_, _, err := reserveBackupFile(filepath.Join(t.TempDir(), "missing"))
	if err == nil {
		t.Fatal("reserveBackupFile in a missing directory = nil error")
	}
	if strings.Contains(err.Error(), "no free backup filename") {
		t.Errorf("error = %q; a missing directory is not a name collision", err)
	}
}
