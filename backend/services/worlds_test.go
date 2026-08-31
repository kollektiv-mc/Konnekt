package services

import (
	"os"
	"path/filepath"
	"testing"

	"konnekt/backend/models"
)

// fakeServerGuard records the quiesce calls DuplicateWorld makes. The
// ordering assertions live in the callbacks so position relative to the copy
// is checked at call time, not reconstructed afterwards.
type fakeServerGuard struct {
	running   bool
	calls     []string
	onPrepare func()
	onResume  func()
	ids       []string
}

// ids records which server each call named, so a test can assert the quiesce
// reached the server being worked on rather than merely that it happened (#239).
func (f *fakeServerGuard) IsRunning(serverID string) bool {
	f.ids = append(f.ids, serverID)
	return f.running
}

func (f *fakeServerGuard) PrepareForBackup(serverID string) bool {
	f.calls = append(f.calls, "prepare")
	f.ids = append(f.ids, serverID)
	if f.onPrepare != nil {
		f.onPrepare()
	}
	return f.running
}

func (f *fakeServerGuard) ResumeSaves(serverID string) {
	f.calls = append(f.calls, "resume")
	f.ids = append(f.ids, serverID)
	if f.onResume != nil {
		f.onResume()
	}
}

// newWorldFixture mirrors newBackupFixture: a WorldService wired to temp
// directories, returning the working directory it operates on. backup stays
// nil because none of the paths under test reach it.
func newWorldFixture(t *testing.T, guard *fakeServerGuard) (*WorldService, string) {
	t.Helper()
	dataDir := t.TempDir()
	workDir := filepath.Join(t.TempDir(), "server")
	if err := os.MkdirAll(filepath.Join(workDir, "world"), 0755); err != nil {
		t.Fatal(err)
	}

	cfgSvc := &ConfigService{}
	cfgSvc.SetDataDir(dataDir)
	if err := cfgSvc.SaveServerConfig(models.ServerConfig{
		ID:         testServerID,
		Name:       "Test",
		WorkingDir: workDir,
	}); err != nil {
		t.Fatal(err)
	}

	return &WorldService{config: cfgSvc, server: guard}, workDir
}

// The issue (#115): duplicating a live world copied region files mid-write.
// The fix borrows the backup path's quiesce, and the contract is ordering:
// saves are flushed and paused strictly before the copy starts, and resumed
// strictly after it finishes.
func TestDuplicateWorldQuiescesSavesAroundTheCopy(t *testing.T) {
	guard := &fakeServerGuard{running: true}
	svc, workDir := newWorldFixture(t, guard)
	writeFile(t, filepath.Join(workDir, "world", "region.mca"), "region-data")
	writeFile(t, filepath.Join(workDir, "world_nether", "DIM-1", "region.mca"), "nether-data")

	dst := filepath.Join(workDir, "copy")
	guard.onPrepare = func() {
		if _, err := os.Stat(dst); !os.IsNotExist(err) {
			t.Error("PrepareForBackup ran after the copy had already begun")
		}
	}
	guard.onResume = func() {
		if _, err := os.Stat(dst); err != nil {
			t.Error("ResumeSaves ran before the copy produced the destination")
		}
	}

	if err := svc.DuplicateWorld(testServerID, "world", "copy"); err != nil {
		t.Fatalf("DuplicateWorld: %v", err)
	}

	if len(guard.calls) != 2 || guard.calls[0] != "prepare" || guard.calls[1] != "resume" {
		t.Errorf("quiesce calls = %v, want [prepare resume]", guard.calls)
	}
	got, err := os.ReadFile(filepath.Join(dst, "region.mca"))
	if err != nil || string(got) != "region-data" {
		t.Errorf("copied overworld = %q, %v; want %q, nil", got, err, "region-data")
	}
	got, err = os.ReadFile(filepath.Join(workDir, "copy_nether", "DIM-1", "region.mca"))
	if err != nil || string(got) != "nether-data" {
		t.Errorf("copied nether sibling = %q, %v; want %q, nil", got, err, "nether-data")
	}
}

// PrepareForBackup returns false when the server is not running, and the
// duplicate must then proceed exactly as before: no resume, plain copy.
func TestDuplicateWorldWhileStoppedSkipsTheQuiesce(t *testing.T) {
	guard := &fakeServerGuard{running: false}
	svc, workDir := newWorldFixture(t, guard)
	writeFile(t, filepath.Join(workDir, "world", "region.mca"), "region-data")

	if err := svc.DuplicateWorld(testServerID, "world", "copy"); err != nil {
		t.Fatalf("DuplicateWorld: %v", err)
	}

	for _, c := range guard.calls {
		if c == "resume" {
			t.Errorf("quiesce calls = %v, want no resume when saving was never paused", guard.calls)
		}
	}
	got, err := os.ReadFile(filepath.Join(workDir, "copy", "region.mca"))
	if err != nil || string(got) != "region-data" {
		t.Errorf("copied overworld = %q, %v; want %q, nil", got, err, "region-data")
	}
}

// Validation failures must refuse before saves are ever touched, or a bad
// name would leave a running server with auto-save paused for nothing.
func TestDuplicateWorldRefusesExistingNameBeforeQuiescing(t *testing.T) {
	guard := &fakeServerGuard{running: true}
	svc, workDir := newWorldFixture(t, guard)
	writeFile(t, filepath.Join(workDir, "world", "region.mca"), "region-data")
	if err := os.MkdirAll(filepath.Join(workDir, "taken"), 0755); err != nil {
		t.Fatal(err)
	}

	if err := svc.DuplicateWorld(testServerID, "world", "taken"); err == nil {
		t.Fatal("DuplicateWorld onto an existing name = nil, want an error")
	}
	if len(guard.calls) != 0 {
		t.Errorf("quiesce calls = %v, want none when the duplicate is refused", guard.calls)
	}
}
