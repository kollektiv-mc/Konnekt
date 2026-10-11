package services

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// ─── The predicate ─────────────────────────────────────────────────────────

func TestIsLodDatabase(t *testing.T) {
	cases := []struct {
		path string
		want bool
	}{
		{"world/data/DistantHorizons.sqlite", true},
		{"world/data/DistantHorizons.sqlite-wal", true},
		{"world/data/DistantHorizons.sqlite-shm", true},
		{"world/DIM-1/data/DistantHorizons.sqlite", true},
		{"world/dimensions/minecraft/overworld/data/DistantHorizons.sqlite-wal", true},
		{"world/Data/DISTANTHORIZONS.SQLITE", true},
		{"world/data/distanthorizons.sqlite-SHM", true},
		{"data/DistantHorizons.sqlite", true},
		// Controls: the right name in the wrong place, or the wrong name in the right one.
		{"world/DistantHorizons.sqlite", false},
		{"world/region/DistantHorizons.sqlite", false},
		{"world/data/sub/DistantHorizons.sqlite", false},
		{"world/data/other.sqlite", false},
		{"world/data/DistantHorizons.sqlite-journal", false},
		{"world/data/DistantHorizons.sqlite.bak", false},
		{"world/data/MyDistantHorizons.sqlite", false},
		{"world/metadata/DistantHorizons.sqlite", false},
	}
	for _, tc := range cases {
		if got := isLodDatabase(filepath.FromSlash(tc.path)); got != tc.want {
			t.Errorf("isLodDatabase(%q) = %v, want %v", tc.path, got, tc.want)
		}
	}
}

func TestLodTallyNarration(t *testing.T) {
	var none *lodTally
	if none.skipped() || none.narration() != "" {
		t.Error("a nil tally must be silent and not skipped")
	}
	empty := &lodTally{}
	if empty.skipped() || empty.narration() != "" {
		t.Error("a tally that matched nothing must be silent and not skipped")
	}
	one := &lodTally{}
	one.add(512)
	if got, want := one.narration(), "Skipped Distant Horizons LODs (1 file, 512 B): the server was running"; got != want {
		t.Errorf("one file = %q, want %q", got, want)
	}
	three := &lodTally{files: 3, bytes: 3 << 30}
	if got, want := three.narration(), "Skipped Distant Horizons LODs (3 files, 3.00 GB): the server was running"; got != want {
		t.Errorf("three files = %q, want %q", got, want)
	}
}

// ─── The fixture world ─────────────────────────────────────────────────────

const (
	lodMainSize = 6000
	lodWalSize  = 3000
	lodShmSize  = 1000
)

// lodEntries are the zip names a backup of the fixture world can hold, split
// into what a running server's backup must leave out and what it must keep.
var (
	lodDropped = []string{
		"world/data/DistantHorizons.sqlite",
		"world/data/DistantHorizons.sqlite-wal",
		"world/data/DistantHorizons.sqlite-shm",
		"world/dimensions/minecraft/the_nether/data/DistantHorizons.sqlite",
		"world/DIM1/DATA/DISTANTHORIZONS.SQLITE-SHM",
	}
	lodKept = []string{
		"world/level.dat",
		"world/data/other.sqlite",
		"world/data/raids.dat",
		"world/DistantHorizons.sqlite",
		"world/region/DistantHorizons.sqlite",
	}
)

// writeLodWorld lays out #563's fixture: the three files under world/data and
// under a nested dimension folder, a mixed-case copy, and controls that share a
// name or a folder with them and must survive. The databases are large against
// the controls on purpose, so a progress total that still counted them would
// leave the bar short of 100.
func writeLodWorld(t *testing.T, workDir string) {
	t.Helper()
	filler := func(n int) string { return strings.Repeat("x", n) }
	sizes := map[string]int{
		"world/data/DistantHorizons.sqlite":                                 lodMainSize,
		"world/data/DistantHorizons.sqlite-wal":                             lodWalSize,
		"world/data/DistantHorizons.sqlite-shm":                             lodShmSize,
		"world/dimensions/minecraft/the_nether/data/DistantHorizons.sqlite": lodMainSize,
		"world/DIM1/DATA/DISTANTHORIZONS.SQLITE-SHM":                        lodShmSize,
	}
	for name, n := range sizes {
		writeFile(t, filepath.Join(workDir, filepath.FromSlash(name)), filler(n))
	}
	for _, name := range lodKept {
		writeFile(t, filepath.Join(workDir, filepath.FromSlash(name)), "control-"+name)
	}
}

// lodDroppedBytes is what the fixture's skipped files add up to.
func lodDroppedBytes() int64 {
	return int64(2*lodMainSize + lodWalSize + 2*lodShmSize)
}

func lodBackupKinds() []struct {
	name   string
	create func(t *testing.T, svc *BackupService) (dir, filename string, flagged bool)
	kind   string
} {
	return []struct {
		name   string
		create func(t *testing.T, svc *BackupService) (dir, filename string, flagged bool)
		kind   string
	}{
		{"server backup", func(t *testing.T, svc *BackupService) (string, string, bool) {
			b, err := svc.CreateBackup(testServerID)
			if err != nil {
				t.Fatalf("CreateBackup: %v", err)
			}
			dir, err := svc.serverBackupDir(testServerID)
			if err != nil {
				t.Fatal(err)
			}
			return dir, b.Filename, b.LodsSkipped
		}, "server"},
		{"world backup", func(t *testing.T, svc *BackupService) (string, string, bool) {
			b, err := svc.CreateWorldBackup(testServerID, "world")
			if err != nil {
				t.Fatalf("CreateWorldBackup: %v", err)
			}
			dir, err := svc.worldBackupDir(testServerID, "world")
			if err != nil {
				t.Fatal(err)
			}
			return dir, b.Filename, b.LodsSkipped
		}, "world"},
	}
}

// collectProgress records the highest percent the backup reports.
func collectProgress(t *testing.T, svc *BackupService) func() int {
	t.Helper()
	ch := subscribeFailed(t, svc, EventBackupProgress)
	return func() int {
		highest := -1
		deadline := time.After(300 * time.Millisecond)
		for {
			select {
			case p := <-ch:
				if pct, _ := p["percent"].(int); pct > highest {
					highest = pct
				}
			case <-deadline:
				return highest
			}
		}
	}
}

// stopFakeServer releases the fake child and waits until the service reports it
// stopped, so a restore (which refuses a running server) can follow.
func stopFakeServer(t *testing.T, svc *BackupService, release func()) {
	t.Helper()
	release()
	deadline := time.Now().Add(2 * time.Second)
	for svc.server.IsRunning(testServerID) {
		if time.Now().After(deadline) {
			t.Fatal("fake server never stopped")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func linePrefixed(lines []string, prefix string) bool {
	for _, l := range lines {
		if strings.HasPrefix(l, prefix) {
			return true
		}
	}
	return false
}

// ─── Backups ───────────────────────────────────────────────────────────────

// A running server's backup leaves Distant Horizons' databases out and says so;
// a stopped server's keeps them (#563). Both kinds of backup, because each has
// its own zip entry point.
func TestBackupLeavesLodDatabasesOutOnlyWhileRunning(t *testing.T) {
	for _, kind := range lodBackupKinds() {
		for _, running := range []bool{true, false} {
			name := kind.name + " stopped"
			if running {
				name = kind.name + " running"
			}
			t.Run(name, func(t *testing.T) {
				svc, workDir := newBackupFixture(t)
				writeLodWorld(t, workDir)
				if running {
					release, _ := fakeRunningServer(t, svc.server)
					defer release()
					svc.server.quiesceWait = time.Millisecond
				}
				highest := collectProgress(t, svc)

				dir, filename, flagged := kind.create(t, svc)

				names := zipNames(t, filepath.Join(dir, filename))
				for _, n := range lodDropped {
					if names[n] == running {
						t.Errorf("entry %q present = %v with the server running = %v, want the opposite", n, names[n], running)
					}
				}
				for _, n := range lodKept {
					if !names[n] {
						t.Errorf("control %q missing from the archive", n)
					}
				}
				if flagged != running {
					t.Errorf("returned LodsSkipped = %v, want %v", flagged, running)
				}
				if got := highest(); got != 100 {
					t.Errorf("progress reached %d, want 100", got)
				}

				lines := consoleLines(svc.server)
				if got := linePrefixed(lines, "Skipped Distant Horizons LODs"); got != running {
					t.Errorf("skip line present = %v, want %v; console = %v", got, running, lines)
				}
				if running {
					want := "Skipped Distant Horizons LODs (5 files, " + fmtBytes(lodDroppedBytes()) + "): the server was running"
					found := false
					for _, l := range lines {
						found = found || l == want
					}
					if !found {
						t.Errorf("console = %v, want the line %q", lines, want)
					}
				}

				listed, err := svc.ListBackups(testServerID)
				if err != nil {
					t.Fatal(err)
				}
				if len(listed) != 1 || listed[0].LodsSkipped != running {
					t.Errorf("ListBackups = %+v, want one backup with LodsSkipped = %v", listed, running)
				}
			})
		}
	}
}

// A running server with no Distant Horizons databases lost nothing, so its
// backup is neither flagged nor narrated.
func TestBackupOfARunningServerWithoutLodsIsNotFlagged(t *testing.T) {
	for _, kind := range lodBackupKinds() {
		t.Run(kind.name, func(t *testing.T) {
			svc, workDir := newBackupFixture(t)
			writeFile(t, filepath.Join(workDir, "world", "level.dat"), "data")
			release, _ := fakeRunningServer(t, svc.server)
			defer release()
			svc.server.quiesceWait = time.Millisecond

			_, _, flagged := kind.create(t, svc)

			if flagged {
				t.Error("LodsSkipped = true, want false when nothing matched")
			}
			if lines := consoleLines(svc.server); linePrefixed(lines, "Skipped Distant Horizons") {
				t.Errorf("console = %v, want no skip line", lines)
			}
			if _, err := os.Stat(filepath.Join(svc.dataDir, "backups", testServerID, "server", "meta.json")); err == nil {
				t.Error("meta.json written for a backup that skipped nothing")
			}
		})
	}
}

// dirSize counts what the zip writes, so the filter has to be on both sides.
func TestDirSizeSkipsLodDatabasesOnRequest(t *testing.T) {
	_, workDir := newBackupFixture(t)
	writeLodWorld(t, workDir)
	world := filepath.Join(workDir, "world")

	all := dirSize(world, false)
	kept := dirSize(world, true)
	if all-kept != lodDroppedBytes() {
		t.Errorf("dirSize drops %d bytes with skipLods, want %d", all-kept, lodDroppedBytes())
	}
}

// ─── The flag after creation ───────────────────────────────────────────────

func TestUpdateBackupMetaKeepsTheLodsFlag(t *testing.T) {
	for _, kind := range lodBackupKinds() {
		t.Run(kind.name, func(t *testing.T) {
			svc, workDir := newBackupFixture(t)
			writeLodWorld(t, workDir)
			release, _ := fakeRunningServer(t, svc.server)
			defer release()
			svc.server.quiesceWait = time.Millisecond
			_, filename, flagged := kind.create(t, svc)
			if !flagged {
				t.Fatal("fixture backup was not flagged")
			}

			updated, err := svc.UpdateBackupMeta(testServerID, filename, "Before the raid", []string{"#raid"})
			if err != nil {
				t.Fatalf("UpdateBackupMeta: %v", err)
			}
			if !updated.LodsSkipped || updated.DisplayName != "Before the raid" {
				t.Errorf("returned backup = %+v, want the rename and the flag", updated)
			}

			listed, err := svc.ListBackups(testServerID)
			if err != nil {
				t.Fatal(err)
			}
			if len(listed) != 1 || !listed[0].LodsSkipped || listed[0].DisplayName != "Before the raid" {
				t.Errorf("ListBackups after a rename = %+v, want the flag kept", listed)
			}

			// A second rename on top of the first is the case that would lose it
			// if the entry were built from the request alone.
			if _, err := svc.UpdateBackupMeta(testServerID, filename, "", nil); err != nil {
				t.Fatal(err)
			}
			listed, err = svc.ListBackups(testServerID)
			if err != nil {
				t.Fatal(err)
			}
			if len(listed) != 1 || !listed[0].LodsSkipped {
				t.Errorf("ListBackups after clearing the name = %+v, want the flag kept", listed)
			}
		})
	}
}

func TestLegacyBackupListingReadsTheLodsFlag(t *testing.T) {
	svc, _ := newBackupFixture(t)
	root, err := svc.backupRoot(testServerID)
	if err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(root, "00001_01_01_26_000000.zip"), "zip")
	writeFile(t, filepath.Join(root, "meta.json"), `{"00001_01_01_26_000000.zip":{"lodsSkipped":true}}`)

	listed, err := svc.ListBackups(testServerID)
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || !listed[0].LodsSkipped {
		t.Errorf("ListBackups = %+v, want the legacy entry flagged", listed)
	}
}

// ─── Restore ───────────────────────────────────────────────────────────────

func TestRestoreNarratesThatLodsAreNotIncluded(t *testing.T) {
	for _, kind := range lodBackupKinds() {
		for _, running := range []bool{true, false} {
			name := kind.name + " stopped"
			if running {
				name = kind.name + " running"
			}
			t.Run(name, func(t *testing.T) {
				svc, workDir := newBackupFixture(t)
				writeFile(t, filepath.Join(workDir, "server.properties"), "level-name=world\n")
				writeLodWorld(t, workDir)
				var release func()
				if running {
					release, _ = fakeRunningServer(t, svc.server)
					defer release()
					svc.server.quiesceWait = time.Millisecond
				}
				_, filename, _ := kind.create(t, svc)
				if running {
					stopFakeServer(t, svc, release)
				}

				if err := svc.RestoreBackup(testServerID, filename); err != nil {
					t.Fatalf("RestoreBackup: %v", err)
				}

				lines := consoleLines(svc.server)
				if got := linePrefixed(lines, lodsNote); got != running {
					t.Errorf("restore note present = %v, want %v; console = %v", got, running, lines)
				}
				if running {
					for _, l := range lines {
						if strings.HasPrefix(l, lodsNote) && !strings.Contains(l, "no Distant Horizons database until Distant Horizons makes a new one") {
							t.Errorf("restore note = %q, want it to say what the restored world lacks", l)
						}
					}
					// The restored world really has none.
					if _, err := os.Stat(filepath.Join(workDir, "world", "data", "DistantHorizons.sqlite")); err == nil {
						t.Error("restored world holds a Distant Horizons database the backup skipped")
					}
				}
			})
		}
	}
}

// ─── World duplication ─────────────────────────────────────────────────────

func TestDuplicateWorldSkipsLodDatabasesOnlyWhileRunning(t *testing.T) {
	for _, running := range []bool{true, false} {
		name := "stopped"
		if running {
			name = "running"
		}
		t.Run(name, func(t *testing.T) {
			svc, workDir := newWorldFixture(t, &fakeServerGuard{running: running})
			writeLodWorld(t, workDir)

			if err := svc.DuplicateWorld(testServerID, "world", "copy"); err != nil {
				t.Fatalf("DuplicateWorld: %v", err)
			}

			for _, n := range lodDropped {
				copied := filepath.Join(workDir, "copy", filepath.FromSlash(strings.TrimPrefix(n, "world/")))
				_, err := os.Stat(copied)
				if present := err == nil; present == running {
					t.Errorf("copied %q present = %v with the server running = %v, want the opposite", n, present, running)
				}
			}
			for _, n := range lodKept {
				copied := filepath.Join(workDir, "copy", filepath.FromSlash(strings.TrimPrefix(n, "world/")))
				if _, err := os.Stat(copied); err != nil {
					t.Errorf("control %q missing from the duplicate: %v", n, err)
				}
			}
		})
	}
}
