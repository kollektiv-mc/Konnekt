package services

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
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
	// prepareErr stands for a server neither RCON nor stdin could reach, the
	// case DuplicateWorld now refuses rather than copying through (#309).
	prepareErr error
}

// ids records which server each call named, so a test can assert the quiesce
// reached the server being worked on rather than merely that it happened (#239).
func (f *fakeServerGuard) IsRunning(serverID string) bool {
	f.ids = append(f.ids, serverID)
	return f.running
}

func (f *fakeServerGuard) PrepareForBackup(serverID string) (bool, error) {
	f.calls = append(f.calls, "prepare")
	f.ids = append(f.ids, serverID)
	if f.onPrepare != nil {
		f.onPrepare()
	}
	if f.prepareErr != nil {
		return false, f.prepareErr
	}
	return f.running, nil
}

func (f *fakeServerGuard) ResumeSaves(serverID string) error {
	f.calls = append(f.calls, "resume")
	f.ids = append(f.ids, serverID)
	if f.onResume != nil {
		f.onResume()
	}
	return nil
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

// A duplication that cannot quiesce would copy a world still being written
// to, which is the torn copy #115 closed. It is refused for that reason (#309)
// rather than copying through, and nothing is left behind when it refuses.
func TestDuplicateWorldRefusesWhenTheQuiesceFails(t *testing.T) {
	guard := &fakeServerGuard{running: true, prepareErr: errors.New("neither channel answered")}
	svc, workDir := newWorldFixture(t, guard)
	writeFile(t, filepath.Join(workDir, "world", "region.mca"), "region-data")

	err := svc.DuplicateWorld(testServerID, "world", "copy")
	if err == nil {
		t.Fatal("DuplicateWorld with a failed quiesce = nil error, want a refusal")
	}
	if !strings.Contains(err.Error(), "pause world saves") {
		t.Errorf("error = %q, want it to name the quiesce", err)
	}

	if _, statErr := os.Stat(filepath.Join(workDir, "copy")); statErr == nil {
		t.Error("a refused duplication left a copy behind")
	}
	for _, c := range guard.calls {
		if c == "resume" {
			t.Errorf("quiesce calls = %v, want no resume: PrepareForBackup already put saving back", guard.calls)
		}
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

// badWorldNames are names that must never reach a path join: traversal,
// absolute and drive-relative paths, UNC shares, and the forms Windows
// normalises back onto a real folder (trailing dots and spaces strip to the
// working directory or to a sibling, so "world " would slip past the
// active-world check while deleting the active world).
var badWorldNames = []string{
	"", ".", "..", "...", ".. ", ". ", "..  .", " ", "\t",
	"../keep", "..\\keep", "../../etc", "..\\..\\Windows",
	"/etc", "/etc/passwd", `C:\keep`, "C:keep", "C:", `\\server\share`,
	"a/b", `a\b`, "world/", `world\`,
	"world.", "world ", "world:stream", "world::$DATA", "a\x00b",
	"CON", "nul", "com1", "LPT9", "NUL.txt", "wor?ld", "wor*ld", "wor|ld",
}

// TestValidateWorldName is the guard S3.2 asks a traversal test for: it sits
// in front of a recursive delete that Remote Access can reach without a
// desktop approval.
func TestValidateWorldName(t *testing.T) {
	for _, name := range badWorldNames {
		if err := validateWorldName(name); err == nil {
			t.Errorf("validateWorldName(%q) = nil, want a refusal", name)
		}
	}
	for _, name := range []string{"world", "My World", "world_nether", "survival-2", "world.bak", ".hidden", "a.b", "console"} {
		if err := validateWorldName(name); err != nil {
			t.Errorf("validateWorldName(%q) = %v, want nil", name, err)
		}
	}
}

// traversalFixture is newWorldFixture plus something that must survive: a
// sentinel folder beside the server directory (what "../keep" reaches) and a
// level-name line to hold still. abs names the sentinel by absolute path.
func traversalFixture(t *testing.T) (svc *WorldService, workDir, abs string) {
	t.Helper()
	svc, workDir = newWorldFixture(t, &fakeServerGuard{})
	writeFile(t, filepath.Join(workDir, "world", "level.dat"), "level")
	writeFile(t, filepath.Join(workDir, "server.properties"), "level-name=world\n")
	abs = filepath.Join(filepath.Dir(workDir), "keep")
	writeFile(t, filepath.Join(abs, "data.txt"), "precious")
	return svc, workDir, abs
}

// assertUntouched fails if the sentinel, the server directory's world or its
// properties changed.
func assertUntouched(t *testing.T, workDir, abs string) {
	t.Helper()
	for path, want := range map[string]string{
		filepath.Join(abs, "data.txt"):               "precious",
		filepath.Join(workDir, "world", "level.dat"): "level",
		filepath.Join(workDir, "server.properties"):  "level-name=world\n",
	} {
		got, err := os.ReadFile(path)
		if err != nil || string(got) != want {
			t.Errorf("%s = %q, %v; want %q, nil", path, got, err, want)
		}
	}
}

// worldNameAttacks is the hostile set plus the sentinel named by absolute path.
func worldNameAttacks(abs string) []string {
	return append([]string{abs, filepath.Join(abs, "data.txt")}, badWorldNames...)
}

// The two-name methods try each hostile name as the target and then as the
// new name, so a guard on only one argument fails here.
func TestDeleteWorldRefusesTraversalNames(t *testing.T) {
	svc, workDir, abs := traversalFixture(t)
	for _, name := range worldNameAttacks(abs) {
		if err := svc.DeleteWorld(testServerID, name); err == nil {
			t.Errorf("DeleteWorld(%q) = nil, want a refusal", name)
		}
	}
	assertUntouched(t, workDir, abs)
}

func TestRenameWorldRefusesTraversalNames(t *testing.T) {
	svc, workDir, abs := traversalFixture(t)
	for _, name := range worldNameAttacks(abs) {
		if err := svc.RenameWorld(testServerID, name, "moved"); err == nil {
			t.Errorf("RenameWorld(%q, moved) = nil, want a refusal", name)
		}
		if err := svc.RenameWorld(testServerID, "world", name); err == nil {
			t.Errorf("RenameWorld(world, %q) = nil, want a refusal", name)
		}
	}
	assertUntouched(t, workDir, abs)
	if _, err := os.Stat(filepath.Join(workDir, "moved")); err == nil {
		t.Error("a refused rename still created the destination")
	}
}

func TestDuplicateWorldRefusesTraversalNames(t *testing.T) {
	svc, workDir, abs := traversalFixture(t)
	for _, name := range worldNameAttacks(abs) {
		if err := svc.DuplicateWorld(testServerID, name, "copy"); err == nil {
			t.Errorf("DuplicateWorld(%q, copy) = nil, want a refusal", name)
		}
		if err := svc.DuplicateWorld(testServerID, "world", name); err == nil {
			t.Errorf("DuplicateWorld(world, %q) = nil, want a refusal", name)
		}
	}
	assertUntouched(t, workDir, abs)
	if _, err := os.Stat(filepath.Join(workDir, "copy")); err == nil {
		t.Error("a refused duplication still created the destination")
	}
}

func TestSetActiveWorldRefusesTraversalNames(t *testing.T) {
	svc, workDir, abs := traversalFixture(t)
	for _, name := range worldNameAttacks(abs) {
		if err := svc.SetActiveWorld(testServerID, name); err == nil {
			t.Errorf("SetActiveWorld(%q) = nil, want a refusal", name)
		}
	}
	assertUntouched(t, workDir, abs)
}

// BackupWorld has no BackupService behind the fixture: a name that got past
// the guard would panic on the nil service, which is also a failure.
func TestBackupWorldRefusesTraversalNames(t *testing.T) {
	svc, _, abs := traversalFixture(t)
	for _, name := range worldNameAttacks(abs) {
		if _, err := svc.BackupWorld(testServerID, name); err == nil {
			t.Errorf("BackupWorld(%q) = nil, want a refusal", name)
		}
	}
}
