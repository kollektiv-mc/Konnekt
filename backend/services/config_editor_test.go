package services

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"konnekt/backend/models"
)

// Known gap, deliberately not covered here: sandbox is a purely *lexical* check
// (filepath.Clean plus a prefix test), so a symlink sitting inside the working
// directory and pointing outside it passes and then resolves outside. Tracked in
// agent_docs/HEALTH_CHECKLIST.md rather than fixed alongside these tests — this
// is a local-first app where the user already owns the filesystem. A real fix has
// to resolve the *parent* directory (sandbox runs for files that do not exist yet,
// on the write path), and a test for it needs a skip guard because Windows gates
// symlink creation behind Developer Mode or elevation.
func TestConfigEditorSandbox(t *testing.T) {
	s := &ConfigEditorService{}
	workDir := filepath.Join("C:", "servers", "myserver")

	valid := []string{"server.properties", "config.yml", filepath.Join("plugins", "a.yml")}
	for _, rel := range valid {
		if _, err := s.sandbox(workDir, rel); err != nil {
			t.Errorf("sandbox(%q, %q) error: %v, want nil", workDir, rel, err)
		}
	}

	invalid := []string{
		filepath.Join("..", "..", "etc", "passwd"),
		filepath.Join("..", "sibling.txt"),
		filepath.Join("plugins", "..", "..", "escape.txt"),
	}
	for _, rel := range invalid {
		if _, err := s.sandbox(workDir, rel); err == nil {
			t.Errorf("sandbox(%q, %q) = nil error, want an error", workDir, rel)
		}
	}
}

func TestConfigEditorSandboxAllowsWorkDirItself(t *testing.T) {
	s := &ConfigEditorService{}
	workDir := filepath.Join("C:", "servers", "myserver")

	got, err := s.sandbox(workDir, ".")
	if err != nil {
		t.Fatalf("sandbox(workDir, \".\") error: %v", err)
	}
	if got != filepath.Clean(workDir) {
		t.Errorf("sandbox(workDir, \".\") = %q, want %q", got, filepath.Clean(workDir))
	}
}

// ─── Read / write / backup rotation ────────────────────────────────────────

// newConfigEditorFixture returns a ConfigEditorService wired to temp dirs, plus
// the server working directory its paths resolve against.
func newConfigEditorFixture(t *testing.T) (*ConfigEditorService, string) {
	t.Helper()
	dataDir := t.TempDir()
	workDir := t.TempDir()

	cfgSvc := &ConfigService{}
	cfgSvc.SetDataDir(dataDir)
	if err := cfgSvc.SaveServerConfig(models.ServerConfig{
		ID:         "srv1",
		Name:       "Test",
		WorkingDir: workDir,
	}); err != nil {
		t.Fatal(err)
	}

	return &ConfigEditorService{appConfig: cfgSvc, dataDir: dataDir}, workDir
}

func TestReadWriteConfigFileRoundTrip(t *testing.T) {
	svc, workDir := newConfigEditorFixture(t)

	if err := svc.WriteConfigFile("srv1", "server.properties", "level-name=world\n"); err != nil {
		t.Fatalf("WriteConfigFile error: %v", err)
	}

	onDisk, err := os.ReadFile(filepath.Join(workDir, "server.properties"))
	if err != nil {
		t.Fatalf("reading the written file: %v", err)
	}
	if string(onDisk) != "level-name=world\n" {
		t.Errorf("on-disk content = %q, want %q", onDisk, "level-name=world\n")
	}

	got, err := svc.ReadConfigFile("srv1", "server.properties")
	if err != nil {
		t.Fatalf("ReadConfigFile error: %v", err)
	}
	if got != "level-name=world\n" {
		t.Errorf("ReadConfigFile = %q, want %q", got, "level-name=world\n")
	}
}

// sandbox is unit-tested above; this pins that both public entry points actually
// route through it.
//
// The escape target is a file that really exists outside the working directory.
// Pointing at a non-existent path would make the read assertion pass even with
// the guard removed, because os.ReadFile would fail on its own — the test has to
// be able to tell "refused" apart from "missing".
func TestConfigFileGuardAppliesOnBothPaths(t *testing.T) {
	svc, workDir := newConfigEditorFixture(t)
	secret := filepath.Join(filepath.Dir(workDir), "secret.txt")
	writeFile(t, secret, "top secret")
	escape := filepath.Join("..", "secret.txt")

	if _, err := svc.ReadConfigFile("srv1", escape); err == nil {
		t.Error("ReadConfigFile with a traversing path = nil error, want an error")
	}
	if err := svc.WriteConfigFile("srv1", escape, "overwritten"); err == nil {
		t.Error("WriteConfigFile with a traversing path = nil error, want an error")
	}
	// The write must not have landed either.
	body, err := os.ReadFile(secret)
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != "top secret" {
		t.Errorf("file outside the working directory was modified: %q", body)
	}
}

// The ordering is the point: validation runs before backup() and before the
// write, so a rejected edit must leave the original file untouched.
func TestWriteConfigFileRejectsInvalidJSONWithoutWriting(t *testing.T) {
	svc, workDir := newConfigEditorFixture(t)
	original := `{"valid": true}`
	writeFile(t, filepath.Join(workDir, "config.json"), original)

	err := svc.WriteConfigFile("srv1", "config.json", "{not valid json")
	if err == nil {
		t.Fatal("WriteConfigFile with invalid JSON = nil error, want an error")
	}
	if !strings.Contains(err.Error(), "invalid JSON") {
		t.Errorf("error = %q, want it to mention invalid JSON", err)
	}

	after, readErr := os.ReadFile(filepath.Join(workDir, "config.json"))
	if readErr != nil {
		t.Fatal(readErr)
	}
	if string(after) != original {
		t.Errorf("file was modified despite the error: %q, want %q", after, original)
	}
}

// Only .json is validated today; other formats pass through untouched.
func TestWriteConfigFileSkipsJSONValidationForOtherFormats(t *testing.T) {
	svc, _ := newConfigEditorFixture(t)

	if err := svc.WriteConfigFile("srv1", "server.properties", "{not valid json"); err != nil {
		t.Errorf("WriteConfigFile on a non-JSON file = %v, want nil", err)
	}
}

func TestWriteConfigFileBacksUpOnlyExistingFiles(t *testing.T) {
	svc, workDir := newConfigEditorFixture(t)
	backupDir := filepath.Join(svc.dataDir, "config_backups", "srv1")

	// A brand-new file has nothing to preserve, so backup() returns early.
	if err := svc.WriteConfigFile("srv1", "fresh.yml", "a: 1"); err != nil {
		t.Fatal(err)
	}
	if entries, err := os.ReadDir(backupDir); err == nil && len(entries) != 0 {
		t.Errorf("new file produced %d backup(s), want 0", len(entries))
	}

	// Overwriting it preserves the previous contents.
	if err := svc.WriteConfigFile("srv1", "fresh.yml", "a: 2"); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(backupDir)
	if err != nil {
		t.Fatalf("reading backup dir: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("overwrite produced %d backup(s), want 1", len(entries))
	}
	body, err := os.ReadFile(filepath.Join(backupDir, entries[0].Name()))
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != "a: 1" {
		t.Errorf("backup holds %q, want the pre-overwrite %q", body, "a: 1")
	}

	// The current file is the new content, not the backup.
	current, err := os.ReadFile(filepath.Join(workDir, "fresh.yml"))
	if err != nil {
		t.Fatal(err)
	}
	if string(current) != "a: 2" {
		t.Errorf("current file = %q, want %q", current, "a: 2")
	}
}

// pruneBackups is driven directly rather than through repeated WriteConfigFile
// calls, so the seeded names can span six distinct days without six real saves.
//
// The names here are the legacy second-resolution shape on purpose. New backups
// carry milliseconds (see createConfigBackupFile), and this pins that pruning still
// works on the names already sitting in users' data directories.
func TestPruneBackupsKeepsExactlyBackupKeep(t *testing.T) {
	dir := t.TempDir()
	const prefix = "server.properties"

	var seeded []string
	for i := 1; i <= 6; i++ {
		name := fmt.Sprintf("%s.2026081%d_120000.bak", prefix, i)
		writeFile(t, filepath.Join(dir, name), fmt.Sprintf("copy-%d", i))
		seeded = append(seeded, name)
	}
	// A different config file's backups must not be collateral damage.
	other := "bukkit.yml.20260810_120000.bak"
	writeFile(t, filepath.Join(dir, other), "other")

	svc := &ConfigEditorService{}
	svc.pruneBackups(dir, prefix)

	remaining := make(map[string]bool)
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		remaining[e.Name()] = true
	}

	// The timestamp format sorts lexically in chronological order, so the three
	// kept are the three newest.
	var kept int
	for i, name := range seeded {
		want := i >= len(seeded)-backupKeep
		if remaining[name] != want {
			t.Errorf("%s present = %v, want %v", name, remaining[name], want)
		}
		if remaining[name] {
			kept++
		}
	}
	if kept != backupKeep {
		t.Errorf("kept %d backups, want %d", kept, backupKeep)
	}
	if !remaining[other] {
		t.Error("pruning removed a different config file's backup")
	}
}

// backupKeep is 3, so three rapid saves must leave three distinct backups holding
// the three distinct previous contents. They used to leave one: the stamp was
// second resolution and os.Create truncates, so every save inside the same second
// wrote over the last one's backup. Nothing sleeps here on purpose, since the
// whole point is that same-second saves are now safe.
func TestRapidSavesEachKeepTheirOwnBackup(t *testing.T) {
	svc, _ := newConfigEditorFixture(t)
	backupDir := filepath.Join(svc.dataDir, "config_backups", "srv1")

	// The first write creates the file, so it backs nothing up. Each of the next
	// three preserves the contents the one before it wrote.
	for i := 1; i <= 4; i++ {
		if err := svc.WriteConfigFile("srv1", "server.properties", fmt.Sprintf("motd=%d", i)); err != nil {
			t.Fatal(err)
		}
	}

	entries, err := os.ReadDir(backupDir)
	if err != nil {
		t.Fatalf("reading backup dir: %v", err)
	}
	if len(entries) != 3 {
		names := make([]string, 0, len(entries))
		for _, e := range entries {
			names = append(names, e.Name())
		}
		t.Fatalf("four rapid saves left %d backup(s) %v, want 3", len(entries), names)
	}

	// One backup per previous revision, none lost to a collision.
	got := make(map[string]bool, len(entries))
	for _, e := range entries {
		body, err := os.ReadFile(filepath.Join(backupDir, e.Name()))
		if err != nil {
			t.Fatal(err)
		}
		got[string(body)] = true
	}
	for i := 1; i <= 3; i++ {
		if want := fmt.Sprintf("motd=%d", i); !got[want] {
			t.Errorf("no backup holds %q; backups hold %v", want, got)
		}
	}
}

// The stamp gained milliseconds, joined with an underscore rather than a dot so
// that a legacy second-resolution name still sorts before a same-second new one.
// pruneBackups deletes the lexicographically first entry, so getting this backwards
// would have made it delete the newest backups first.
func TestConfigBackupNamesSortLegacyBeforeNewInTheSameSecond(t *testing.T) {
	dir := t.TempDir()

	f, err := createConfigBackupFile(dir, "server.properties")
	if err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	fresh := entries[0].Name()

	// The legacy shape for the very same second the fresh one just used.
	second := strings.SplitN(strings.TrimPrefix(fresh, "server.properties."), "_", 3)
	if len(second) != 3 {
		t.Fatalf("unexpected backup name %q", fresh)
	}
	legacy := fmt.Sprintf("server.properties.%s_%s.bak", second[0], second[1])

	if !(legacy < fresh) {
		t.Errorf("legacy %q does not sort before new %q; pruneBackups would delete the newer one first", legacy, fresh)
	}
}

// ─── eula.txt ─────────────────────────────────────────────────────────────

// The write behind #259: eula.txt used to be a raw os.WriteFile from app.go, the
// one file the app wrote without going through writeFileAtomic after #116. The
// rename seam simulates the crash and the file must be untouched by it.
func TestAcceptEulaWritesTheFlagAtomically(t *testing.T) {
	svc, workDir := newConfigEditorFixture(t)

	if err := svc.AcceptEula("srv1"); err != nil {
		t.Fatalf("AcceptEula: %v", err)
	}
	got, err := os.ReadFile(filepath.Join(workDir, "eula.txt"))
	if err != nil {
		t.Fatalf("read eula.txt: %v", err)
	}
	if !strings.Contains(string(got), "eula=true\n") {
		t.Errorf("eula.txt = %q, want it to contain eula=true", got)
	}

	// Seed a different content so the failed rewrite has something to tear.
	if err := os.WriteFile(filepath.Join(workDir, "eula.txt"), []byte("eula=false\n"), 0644); err != nil {
		t.Fatal(err)
	}
	orig := renameFile
	renameFile = func(oldpath, newpath string) error {
		return errors.New("simulated crash at rename")
	}
	t.Cleanup(func() { renameFile = orig })

	if err := svc.AcceptEula("srv1"); err == nil {
		t.Fatal("AcceptEula with a failing rename = nil, want an error")
	}
	got, err = os.ReadFile(filepath.Join(workDir, "eula.txt"))
	if err != nil {
		t.Fatalf("read eula.txt after failed write: %v", err)
	}
	if string(got) != "eula=false\n" {
		t.Errorf("eula.txt after a failed write = %q, want the old content intact", got)
	}
	if names := readDirNames(t, workDir); len(names) != 1 || names[0] != "eula.txt" {
		t.Errorf("working dir holds %v, want only eula.txt (no temp file left behind)", names)
	}
}

// filepath.Join("", "eula.txt") is the relative path eula.txt, so an
// unconfigured server used to write into whatever directory Konnekt was
// launched from. Every config-editor path resolves the working directory
// through the same helper, so the read path is asserted alongside.
func TestConfigEditorRefusesAnEmptyWorkingDir(t *testing.T) {
	svc, _ := newConfigEditorFixture(t)
	if err := svc.appConfig.SaveServerConfig(models.ServerConfig{ID: "bare", Name: "Bare"}); err != nil {
		t.Fatal(err)
	}

	err := svc.AcceptEula("bare")
	if err == nil {
		t.Fatal("AcceptEula on a server with no working directory = nil, want an error")
	}
	if !strings.Contains(err.Error(), "no working directory") {
		t.Errorf("error = %q, want it to name the missing working directory", err)
	}
	if _, statErr := os.Stat("eula.txt"); statErr == nil {
		t.Error("eula.txt was written into the process's working directory")
	}

	if _, err := svc.ReadConfigFile("bare", "server.properties"); err == nil || !strings.Contains(err.Error(), "no working directory") {
		t.Errorf("ReadConfigFile on an empty working dir = %v, want the same refusal", err)
	}
}
