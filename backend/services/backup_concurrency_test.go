package services

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"konnekt/backend/models"
)

// holdFirstStat swaps statBackup so the first backup to reach it parks there,
// still holding its claim, until the returned release is called. It is how these
// tests hold an operation in flight with no sleep and no timing: reached closes
// once the first backup is parked.
func holdFirstStat(t *testing.T) (reached <-chan struct{}, release func()) {
	t.Helper()
	parked := make(chan struct{})
	proceed := make(chan struct{})
	var once sync.Once
	orig := statBackup
	statBackup = func(name string) (os.FileInfo, error) {
		once.Do(func() {
			close(parked)
			<-proceed
		})
		return orig(name)
	}
	var releaseOnce sync.Once
	release = func() { releaseOnce.Do(func() { close(proceed) }) }
	t.Cleanup(func() {
		release()
		statBackup = orig
	})
	return parked, release
}

// stubBackupNames makes newBackupName return names in order and then fall back
// to the real generator, and returns a pointer to how many times it was called.
func stubBackupNames(t *testing.T, names ...string) *int {
	t.Helper()
	orig := newBackupName
	calls := 0
	newBackupName = func() string {
		calls++
		if calls <= len(names) {
			return names[calls-1]
		}
		return orig()
	}
	t.Cleanup(func() { newBackupName = orig })
	return &calls
}

func countBackups(t *testing.T, svc *BackupService, serverID string) int {
	t.Helper()
	list, err := svc.ListBackups(serverID)
	if err != nil {
		t.Fatalf("ListBackups: %v", err)
	}
	return len(list)
}

// The race behind #29: a second backup of the same server while the first is
// zipping. Held here at the one step after the zip, so the refusal is observed
// with the first backup provably still in flight.
func TestSecondBackupOfOneServerIsRefusedWhileOneRuns(t *testing.T) {
	svc, workDir := newBackupFixture(t)
	writeFile(t, filepath.Join(workDir, "world", "level.dat"), "level")
	reached, release := holdFirstStat(t)

	type result struct {
		b   models.Backup
		err error
	}
	first := make(chan result, 1)
	go func() {
		b, err := svc.CreateBackup(testServerID)
		first <- result{b, err}
	}()
	<-reached

	if _, err := svc.CreateBackup(testServerID); !errors.Is(err, errBackupRunning) {
		t.Errorf("second CreateBackup error = %v, want errBackupRunning", err)
	}
	if _, err := svc.CreateWorldBackup(testServerID, "world"); !errors.Is(err, errBackupRunning) {
		t.Errorf("CreateWorldBackup during a server backup error = %v, want errBackupRunning", err)
	}

	release()
	r := <-first
	if r.err != nil {
		t.Fatalf("first CreateBackup error: %v", r.err)
	}

	if n := countBackups(t, svc, testServerID); n != 1 {
		t.Errorf("ListBackups returned %d archives, want exactly 1", n)
	}
	// The refusals are silent: the UI already shows the running backup, so a
	// second "Backing up" line would describe work that never started.
	started := 0
	for _, l := range consoleLines(svc.server) {
		if strings.Contains(l, "Backing up") {
			started++
		}
	}
	if started != 1 {
		t.Errorf("console narrated %d backups starting, want 1", started)
	}
}

func TestBackupOfOneServerDoesNotBlockAnother(t *testing.T) {
	svc, _ := newBackupFixture(t)
	other := filepath.Join(t.TempDir(), "other")
	writeFile(t, filepath.Join(other, "world", "level.dat"), "level")
	if err := svc.config.SaveServerConfig(models.ServerConfig{ID: "srv2", Name: "Other", WorkingDir: other}); err != nil {
		t.Fatal(err)
	}

	if !svc.claim(testServerID) {
		t.Fatal("claim on a fresh service = false")
	}
	defer svc.release(testServerID)

	if _, err := svc.CreateBackup("srv2"); err != nil {
		t.Errorf("CreateBackup on srv2 while srv1 is claimed error = %v, want nil", err)
	}
	if _, err := svc.CreateWorldBackup("srv2", "world"); err != nil {
		t.Errorf("CreateWorldBackup on srv2 while srv1 is claimed error = %v, want nil", err)
	}
	if _, err := svc.CreateBackup(testServerID); !errors.Is(err, errBackupRunning) {
		t.Errorf("CreateBackup on the claimed server error = %v, want errBackupRunning", err)
	}
}

// A claim that outlived its backup would refuse every later one until restart.
func TestClaimIsReleasedAfterABackupFails(t *testing.T) {
	svc, _ := newBackupFixture(t)
	errStat := errors.New("simulated stat failure")
	orig := statBackup
	statBackup = func(string) (os.FileInfo, error) { return nil, errStat }
	t.Cleanup(func() { statBackup = orig })

	if _, err := svc.CreateBackup(testServerID); !errors.Is(err, errStat) {
		t.Fatalf("CreateBackup error = %v, want the stat failure", err)
	}
	if _, err := svc.CreateWorldBackup(testServerID, "world"); !errors.Is(err, errStat) {
		t.Fatalf("CreateWorldBackup error = %v, want the stat failure", err)
	}

	statBackup = orig
	if _, err := svc.CreateBackup(testServerID); err != nil {
		t.Errorf("CreateBackup after a failed one error = %v, want nil", err)
	}
	if _, err := svc.CreateWorldBackup(testServerID, "world"); err != nil {
		t.Errorf("CreateWorldBackup after a failed one error = %v, want nil", err)
	}
}

func TestClaimIsReleasedWhenABackupIsRefusedBeforeItStarts(t *testing.T) {
	svc, workDir := newBackupFixture(t)
	if _, err := svc.CreateWorldBackup(testServerID, "no-such-world"); err == nil {
		t.Fatal("CreateWorldBackup of a missing world = nil error")
	}
	if err := os.RemoveAll(filepath.Join(workDir, "world")); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CreateBackup(testServerID); err != nil {
		t.Errorf("CreateBackup after a refused world backup error = %v, want nil", err)
	}
}

func TestRestoreIsRefusedWhileABackupHoldsTheServer(t *testing.T) {
	svc, workDir := newBackupFixture(t)
	level := filepath.Join(workDir, "world", "level.dat")
	writeFile(t, level, "original")
	b, err := svc.CreateBackup(testServerID)
	if err != nil {
		t.Fatal(err)
	}
	writeFile(t, level, "changed since")

	if !svc.claim(testServerID) {
		t.Fatal("claim = false")
	}
	if err := svc.RestoreBackup(testServerID, b.Filename); !errors.Is(err, errRestoreBlocked) {
		t.Fatalf("RestoreBackup while a backup runs error = %v, want errRestoreBlocked", err)
	}
	if got, err := os.ReadFile(level); err != nil || string(got) != "changed since" {
		t.Errorf("level.dat = %q, %v; a refused restore must leave the server alone", got, err)
	}

	svc.release(testServerID)
	if err := svc.RestoreBackup(testServerID, b.Filename); err != nil {
		t.Fatalf("RestoreBackup once released error = %v", err)
	}
	if got, err := os.ReadFile(level); err != nil || string(got) != "original" {
		t.Errorf("level.dat = %q, %v; want %q", got, err, "original")
	}
	// The restore released its own claim on the way out.
	if !svc.claim(testServerID) {
		t.Error("claim after a finished restore = false, want it released")
	}
}

// Seeding every name shortID can produce is impractical, so the generator is
// stubbed to offer a taken name first and a free one second.
func TestReserveBackupFileSkipsANameHeldInAnotherFolder(t *testing.T) {
	cases := []struct {
		name  string
		taken func(root string) string
	}{
		{"server folder", func(root string) string { return filepath.Join(root, "server", "11111_taken.zip") }},
		{"a world folder", func(root string) string { return filepath.Join(root, "worlds", "nether", "11111_taken.zip") }},
		{"legacy root", func(root string) string { return filepath.Join(root, "11111_taken.zip") }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			writeFile(t, tc.taken(root), "someone else's backup")
			// Reserving in a folder that is none of the above, and in the one
			// that is, so a hit anywhere counts and not just in dir.
			for _, dir := range []string{filepath.Join(root, "worlds", "overworld"), filepath.Join(root, "server")} {
				if err := os.MkdirAll(dir, 0o755); err != nil {
					t.Fatal(err)
				}
				calls := stubBackupNames(t, "11111_taken.zip", "22222_free.zip")
				f, name, err := reserveBackupFile(root, dir)
				if err != nil {
					t.Fatal(err)
				}
				if err := f.Close(); err != nil {
					t.Fatal(err)
				}
				if name != "22222_free.zip" {
					t.Errorf("reserveBackupFile in %s = %q, want the free name", dir, name)
				}
				if *calls != 2 {
					t.Errorf("generator called %d times, want 2 (one retry)", *calls)
				}
				if err := os.Remove(filepath.Join(dir, name)); err != nil {
					t.Fatal(err)
				}
			}
		})
	}
}

func TestReserveBackupFileGivesUpWhenEveryNameIsTaken(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "server", "11111_taken.zip"), "x")
	orig := newBackupName
	calls := 0
	newBackupName = func() string { calls++; return "11111_taken.zip" }
	t.Cleanup(func() { newBackupName = orig })

	_, _, err := reserveBackupFile(root, filepath.Join(root, "worlds", "w"))
	if err == nil || !strings.Contains(err.Error(), "no free backup filename") {
		t.Fatalf("error = %v, want the exhausted-names error", err)
	}
	if calls != 10 {
		t.Errorf("generator called %d times, want the 10-attempt cap", calls)
	}
}

// End to end for #552: a world backup whose first name is already a server
// backup's must come out under a different one, or findBackupFile (server/
// first) would resolve the world backup's name to the server archive.
func TestWorldBackupNameNeverShadowsAServerBackup(t *testing.T) {
	svc, _ := newBackupFixture(t)
	stubBackupNames(t, "33333_same.zip", "33333_same.zip", "44444_other.zip")

	srv, err := svc.CreateBackup(testServerID)
	if err != nil {
		t.Fatal(err)
	}
	world, err := svc.CreateWorldBackup(testServerID, "world")
	if err != nil {
		t.Fatal(err)
	}
	if srv.Filename == world.Filename {
		t.Fatalf("server and world backups share the name %q", srv.Filename)
	}
	_, _, kind, w, err := svc.findBackupFile(testServerID, world.Filename)
	if err != nil || kind != "world" || w != "world" {
		t.Errorf("findBackupFile(%q) = kind %q, world %q, %v; want the world backup", world.Filename, kind, w, err)
	}
}

// #553: the Backups tile's folder button showed server/ and hid worlds/.
func TestOpenBackupDirOpensTheRootAndMakesIt(t *testing.T) {
	svc, _ := newBackupFixture(t)
	var opened []string
	openBackupPath = func(p string) error { opened = append(opened, p); return nil }
	t.Cleanup(func() { openBackupPath = OpenPath })

	root, err := svc.backupRoot(testServerID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(root); !os.IsNotExist(err) {
		t.Fatalf("fixture already has a backup root (%v); the test needs a fresh server", err)
	}

	if err := svc.OpenBackupDir(testServerID); err != nil {
		t.Fatalf("OpenBackupDir error: %v", err)
	}
	if len(opened) != 1 || opened[0] != root {
		t.Errorf("opened %v, want exactly [%s]", opened, root)
	}
	if fi, err := os.Stat(root); err != nil || !fi.IsDir() {
		t.Errorf("backup root not created: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "server")); !os.IsNotExist(err) {
		t.Errorf("OpenBackupDir created server/ (%v); it only needs the root", err)
	}
}

func TestOpenBackupDirReportsAFailedOpen(t *testing.T) {
	svc, _ := newBackupFixture(t)
	errOpen := errors.New("no file manager")
	openBackupPath = func(string) error { return errOpen }
	t.Cleanup(func() { openBackupPath = OpenPath })
	if err := svc.OpenBackupDir(testServerID); !errors.Is(err, errOpen) {
		t.Errorf("OpenBackupDir error = %v, want the open failure", err)
	}
}

func TestNewBackupServiceMakesItsClaimMap(t *testing.T) {
	svc := NewBackupService(&ConfigService{}, NewServerService())
	if svc.busy == nil {
		t.Fatal("NewBackupService left the claim map nil")
	}
	if !svc.claim("a") || svc.claim("a") || !svc.claim("b") {
		t.Error("claim: want a first claim to win, a repeat to lose, and another server to win")
	}
}
