package services

import (
	"archive/zip"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"konnekt/backend/models"
)

func TestValidateFilename(t *testing.T) {
	valid := []string{"backup.zip", "my-server_2026-07-02.zip"}
	for _, f := range valid {
		if err := validateFilename(f); err != nil {
			t.Errorf("validateFilename(%q) = %v, want nil", f, err)
		}
	}

	invalid := []string{
		"../backup.zip",
		"../../etc/passwd.zip",
		"a/b.zip",
		`a\b.zip`,
		"backup.txt",
		"backup",
		"",
	}
	for _, f := range invalid {
		if err := validateFilename(f); err == nil {
			t.Errorf("validateFilename(%q) = nil, want error", f)
		}
	}
}

func TestZipDirRoundTrip(t *testing.T) {
	src := t.TempDir()
	if err := os.MkdirAll(filepath.Join(src, "nested"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "top.txt"), []byte("top-level"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "nested", "inner.txt"), []byte("nested-content"), 0644); err != nil {
		t.Fatal(err)
	}

	zipPath := filepath.Join(t.TempDir(), "out.zip")
	if err := zipDirWithProgress(src, zipPath, nil); err != nil {
		t.Fatalf("zipDirWithProgress error: %v", err)
	}

	dest := t.TempDir()
	if err := unzipTo(zipPath, dest); err != nil {
		t.Fatalf("unzipTo error: %v", err)
	}

	top, err := os.ReadFile(filepath.Join(dest, "top.txt"))
	if err != nil || string(top) != "top-level" {
		t.Errorf("top.txt = %q, %v; want %q, nil", top, err, "top-level")
	}
	inner, err := os.ReadFile(filepath.Join(dest, "nested", "inner.txt"))
	if err != nil || string(inner) != "nested-content" {
		t.Errorf("nested/inner.txt = %q, %v; want %q, nil", inner, err, "nested-content")
	}
}

func TestUnzipToRejectsZipSlip(t *testing.T) {
	zipPath := filepath.Join(t.TempDir(), "evil.zip")
	f, err := os.Create(zipPath)
	if err != nil {
		t.Fatal(err)
	}
	w := zip.NewWriter(f)
	fw, err := w.CreateHeader(&zip.FileHeader{Name: "../evil.txt"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fw.Write([]byte("escaped")); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	f.Close()

	dest := filepath.Join(t.TempDir(), "dest")
	if err := os.MkdirAll(dest, 0755); err != nil {
		t.Fatal(err)
	}

	if err := unzipTo(zipPath, dest); err == nil {
		t.Fatal("expected unzipTo to reject a zip-slip entry, got nil error")
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(dest), "evil.txt")); err == nil {
		t.Fatal("zip-slip entry was written outside the destination directory")
	}
}

// ─── Create / restore orchestration ────────────────────────────────────────
//
// The guards below these flows (validateFilename, unzipTo's zip-slip check)
// were already covered above; what follows covers the flows that call them.

const testServerID = "srv1"

// newBackupFixture returns a BackupService wired to temp directories, plus the
// working directory it backs up. bus and ctx stay nil on purpose: EventBus.Emit
// is nil-safe, and CreateBackup guards its ServerService use behind a nil check,
// so neither is needed to exercise these paths.
func newBackupFixture(t *testing.T) (*BackupService, string) {
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

	return &BackupService{
		config:  cfgSvc,
		server:  &ServerService{},
		dataDir: dataDir,
	}, workDir
}

// writeFile lives in serverlaunch_test.go — same package, so it is reused here.

// The highest-value test here: it drives CreateBackup, findBackupFile, unzipTo
// and the working-directory swap in one pass, which is the sequence a user hits
// when they restore.
func TestCreateAndRestoreBackupRoundTrip(t *testing.T) {
	svc, workDir := newBackupFixture(t)
	writeFile(t, filepath.Join(workDir, "server.properties"), "level-name=world")
	writeFile(t, filepath.Join(workDir, "world", "level.dat"), "original-level")

	b, err := svc.CreateBackup(testServerID)
	if err != nil {
		t.Fatalf("CreateBackup error: %v", err)
	}
	if b.Kind != "server" {
		t.Errorf("Kind = %q, want %q", b.Kind, "server")
	}
	if b.SizeBytes <= 0 {
		t.Errorf("SizeBytes = %d, want > 0", b.SizeBytes)
	}

	// Corrupt the working directory the way a bad save would.
	writeFile(t, filepath.Join(workDir, "world", "level.dat"), "corrupted")
	if err := os.Remove(filepath.Join(workDir, "server.properties")); err != nil {
		t.Fatal(err)
	}

	if err := svc.RestoreBackup(testServerID, b.Filename); err != nil {
		t.Fatalf("RestoreBackup error: %v", err)
	}

	got, err := os.ReadFile(filepath.Join(workDir, "world", "level.dat"))
	if err != nil || string(got) != "original-level" {
		t.Errorf("level.dat = %q, %v; want %q, nil", got, err, "original-level")
	}
	if _, err := os.Stat(filepath.Join(workDir, "server.properties")); err != nil {
		t.Errorf("server.properties was not restored: %v", err)
	}
}

func TestCreateBackupMissingWorkingDir(t *testing.T) {
	svc, workDir := newBackupFixture(t)
	if err := os.RemoveAll(workDir); err != nil {
		t.Fatal(err)
	}

	if _, err := svc.CreateBackup(testServerID); err == nil {
		t.Fatal("CreateBackup with a missing working directory = nil error, want an error")
	}
}

func TestRestoreBackupRefusesWhileServerRunning(t *testing.T) {
	svc, workDir := newBackupFixture(t)
	writeFile(t, filepath.Join(workDir, "world", "level.dat"), "data")
	b, err := svc.CreateBackup(testServerID)
	if err != nil {
		t.Fatal(err)
	}

	svc.server.mu.Lock()
	svc.server.running = true
	svc.server.mu.Unlock()

	err = svc.RestoreBackup(testServerID, b.Filename)
	if err == nil {
		t.Fatal("RestoreBackup while running = nil error, want an error")
	}
	if !strings.Contains(err.Error(), "stop the server") {
		t.Errorf("error = %q, want it to mention stopping the server", err)
	}
}

// validateFilename is unit-tested above; this pins that RestoreBackup actually
// calls it rather than reaching the filesystem with a traversing name.
func TestRestoreBackupRejectsTraversingFilename(t *testing.T) {
	svc, _ := newBackupFixture(t)

	if err := svc.RestoreBackup(testServerID, filepath.Join("..", "escape.zip")); err == nil {
		t.Fatal("RestoreBackup with a traversing filename = nil error, want an error")
	}
}

// World backups live under worlds/{name}/ and server backups under server/, and
// ListBackups has to report each with the right Kind so the tile can tell them
// apart.
func TestWorldAndServerBackupsResolveSeparately(t *testing.T) {
	svc, workDir := newBackupFixture(t)
	writeFile(t, filepath.Join(workDir, "world", "level.dat"), "world-data")

	serverBackup, err := svc.CreateBackup(testServerID)
	if err != nil {
		t.Fatal(err)
	}
	worldBackup, err := svc.CreateWorldBackup(testServerID, "world")
	if err != nil {
		t.Fatalf("CreateWorldBackup error: %v", err)
	}

	list, err := svc.ListBackups(testServerID)
	if err != nil {
		t.Fatal(err)
	}

	byName := make(map[string]models.Backup, len(list))
	for _, b := range list {
		byName[b.Filename] = b
	}
	if got := byName[serverBackup.Filename]; got.Kind != "server" || got.World != "" {
		t.Errorf("server backup = {Kind:%q World:%q}, want {server, \"\"}", got.Kind, got.World)
	}
	if got := byName[worldBackup.Filename]; got.Kind != "world" || got.World != "world" {
		t.Errorf("world backup = {Kind:%q World:%q}, want {world, world}", got.Kind, got.World)
	}
}

func TestUpdateBackupMetaRoundTrip(t *testing.T) {
	svc, workDir := newBackupFixture(t)
	writeFile(t, filepath.Join(workDir, "world", "level.dat"), "data")
	b, err := svc.CreateBackup(testServerID)
	if err != nil {
		t.Fatal(err)
	}

	// Tags are sanitized on the way in: a leading # is stripped, surrounding
	// space trimmed, empties dropped.
	updated, err := svc.UpdateBackupMeta(testServerID, b.Filename, "  Before the update  ", []string{"#stable", " pre-1.21 ", ""})
	if err != nil {
		t.Fatalf("UpdateBackupMeta error: %v", err)
	}
	if updated.DisplayName != "Before the update" {
		t.Errorf("DisplayName = %q, want %q", updated.DisplayName, "Before the update")
	}
	if len(updated.Tags) != 2 || updated.Tags[0] != "stable" || updated.Tags[1] != "pre-1.21" {
		t.Errorf("Tags = %v, want [stable pre-1.21]", updated.Tags)
	}

	// The point of the round trip: it survives a re-read through meta.json.
	list, err := svc.ListBackups(testServerID)
	if err != nil {
		t.Fatal(err)
	}
	var found bool
	for _, got := range list {
		if got.Filename != b.Filename {
			continue
		}
		found = true
		if got.DisplayName != "Before the update" {
			t.Errorf("reloaded DisplayName = %q, want %q", got.DisplayName, "Before the update")
		}
		if len(got.Tags) != 2 {
			t.Errorf("reloaded Tags = %v, want 2 entries", got.Tags)
		}
	}
	if !found {
		t.Fatalf("backup %q missing from ListBackups", b.Filename)
	}
}

func TestDeleteBackupRemovesFile(t *testing.T) {
	svc, workDir := newBackupFixture(t)
	writeFile(t, filepath.Join(workDir, "world", "level.dat"), "data")
	b, err := svc.CreateBackup(testServerID)
	if err != nil {
		t.Fatal(err)
	}

	if err := svc.DeleteBackup(testServerID, b.Filename); err != nil {
		t.Fatalf("DeleteBackup error: %v", err)
	}
	list, err := svc.ListBackups(testServerID)
	if err != nil {
		t.Fatal(err)
	}
	for _, got := range list {
		if got.Filename == b.Filename {
			t.Errorf("backup %q still listed after DeleteBackup", b.Filename)
		}
	}
}
