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

// The console used to narrate every size in MB, so a 4 GiB archive read
// "4096.0 MB". The tiers mirror frontend/src/lib/format.ts's fmtBytes so the
// console line and the tile agree (#260).
func TestFmtBytesTiers(t *testing.T) {
	cases := []struct {
		n    int64
		want string
	}{
		{0, "0 B"},
		{1023, "1023 B"},
		{1024, "1.0 KB"},
		{1536, "1.5 KB"},
		{1 << 20, "1.0 MB"},
		{(1 << 30) - 1, "1024.0 MB"},
		{1 << 30, "1.00 GB"},
		{4 << 30, "4.00 GB"},
	}
	for _, tc := range cases {
		if got := fmtBytes(tc.n); got != tc.want {
			t.Errorf("fmtBytes(%d) = %q, want %q", tc.n, got, tc.want)
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
	out, err := os.Create(zipPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := zipDirWithProgress(src, out, nil); err != nil {
		out.Close()
		t.Fatalf("zipDirWithProgress error: %v", err)
	}
	if err := out.Close(); err != nil {
		t.Fatal(err)
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
		server:  NewServerService(),
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

	// The acceptance case for #113: watched in the console, the whole
	// sequence reads as one story. Order comes from the ring buffer, which
	// is written synchronously (the bus fans out per goroutine).
	lines := consoleLines(svc.server)
	wantOrder := []string{
		"Backing up the server to " + b.Filename,
		"Backup finished: " + b.Filename,
		"Restoring the server from " + b.Filename,
		"Restore finished, server files replaced",
	}
	at := -1
	for _, want := range wantOrder {
		found := -1
		for i, line := range lines {
			if i > at && strings.HasPrefix(line, want) {
				found = i
				break
			}
		}
		if found == -1 {
			t.Fatalf("narration missing or out of order: %q not after index %d in %v", want, at, lines)
		}
		at = found
	}
	for _, line := range lines {
		if strings.Contains(line, "failed") {
			t.Errorf("failure narrated on a clean round trip: %q", line)
		}
		// The fixture server is not running, so the quiesce stays silent.
		if strings.Contains(line, "world saves") {
			t.Errorf("quiesce narrated while the server is stopped: %q", line)
		}
	}
	// Every line is marked as Konnekt's, and its outcome says which dot the
	// console paints: the sequence is start, done, start, done.
	wantOutcomes := []string{outcomeProgress, outcomeOK, outcomeProgress, outcomeOK}
	history := svc.server.GetConsoleHistory(testServerID)
	for i, entry := range history {
		if entry.Source != sourceManager {
			t.Errorf("narrated line %q has Source %q, want %q", entry.Line, entry.Source, sourceManager)
		}
		if i < len(wantOutcomes) && entry.Outcome != wantOutcomes[i] {
			t.Errorf("line %d (%q) has Outcome %q, want %q", i, entry.Line, entry.Outcome, wantOutcomes[i])
		}
	}
}

// Restraint, as a test: a guard that refuses before anything starts says
// nothing in the console. The IPC error and its toast carry that case.
func TestCreateBackupNarratesNothingWhenItRefuses(t *testing.T) {
	svc, workDir := newBackupFixture(t)
	if err := os.RemoveAll(workDir); err != nil {
		t.Fatal(err)
	}

	if _, err := svc.CreateBackup(testServerID); err == nil {
		t.Fatal("CreateBackup with a missing working directory = nil error, want an error")
	}
	if lines := consoleLines(svc.server); len(lines) != 0 {
		t.Errorf("console history = %v, want empty", lines)
	}
}

// A corrupt archive fails during extraction, before the live directory is
// touched, and the console says which stage went wrong.
func TestRestoreBackupNarratesExtractFailure(t *testing.T) {
	svc, workDir := newBackupFixture(t)
	writeFile(t, filepath.Join(workDir, "world", "level.dat"), "data")
	b, err := svc.CreateBackup(testServerID)
	if err != nil {
		t.Fatalf("CreateBackup error: %v", err)
	}

	zipPath, _, _, _, err := svc.findBackupFile(testServerID, b.Filename)
	if err != nil {
		t.Fatalf("findBackupFile error: %v", err)
	}
	writeFile(t, zipPath, "not a zip at all")

	if err := svc.RestoreBackup(testServerID, b.Filename); err == nil {
		t.Fatal("RestoreBackup over a corrupt archive = nil error, want an error")
	}

	var sawExtractFailure, sawFinished bool
	for _, entry := range svc.server.GetConsoleHistory(testServerID) {
		if strings.Contains(entry.Line, "Restore failed while extracting") {
			sawExtractFailure = true
			if entry.Outcome != outcomeFailed {
				t.Errorf("failure line %q has Outcome %q, want %q", entry.Line, entry.Outcome, outcomeFailed)
			}
		}
		if strings.Contains(entry.Line, "Restore finished") {
			sawFinished = true
		}
	}
	if !sawExtractFailure {
		t.Errorf("no extract-failure narration: %v", consoleLines(svc.server))
	}
	if sawFinished {
		t.Error("restore narrated success despite failing")
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

	// The instance for the server being restored, not whichever one is current:
	// the refusal now names its server (#239), so marking the wrong one running
	// would let the restore through — which is the behaviour this test exists to
	// forbid.
	in := svc.server.instanceFor(testServerID)
	in.mu.Lock()
	in.running = true
	in.mu.Unlock()

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

// shortID used to build a fresh rand.Source from time.Now().UnixNano() on every
// call. Windows' clock granularity meant two consecutive calls read the identical
// nanosecond and therefore produced the identical "random" id: 99.01% of the time,
// measured over 100,000 back-to-back pairs, against 0.001% expected by chance.
//
// This asserts the property the filename scheme actually depends on, rather than
// the implementation: ids come from the whole space rather than from the clock. It
// fails against the old version on the first iteration on Windows.
//
// It does not assert that consecutive ids never repeat, which is what it used to do
// and what made it flaky. 1,000 draws are 999 consecutive pairs, each a 1-in-100,000
// chance of matching, so a correct generator trips that assertion with probability
// 1-(1-1e-5)^999, about 1%: roughly one CI run in a hundred, and it did fail one.
// Do not re-tighten it to zero. The two assertions below are what a low-entropy
// generator actually fails, both by hundreds rather than by one:
//
//   - maxRepeats 3 is unreachable by chance. The repeat count is Poisson with
//     lambda = 999*1e-5 = 0.01, so P(4 or more) is about 4e-10. A replica of the
//     old clock-derived id scores 981.
//   - 900 distinct of 1,000 leaves ample room for chance collisions and is the
//     stronger check anyway. A clock-derived id collapses to a handful of values.
//
// Neither is fixed by seeding: math/rand/v2's top-level functions take no seed, and
// pinning one would test a recorded sequence instead of the generator.
func TestShortIDDoesNotRepeatOnConsecutiveCalls(t *testing.T) {
	const (
		draws      = 1000
		maxRepeats = 3
	)

	repeats := 0
	prev := shortID()
	seen := map[string]bool{prev: true}
	for i := 1; i < draws; i++ {
		id := shortID()
		if id == prev {
			repeats++
		}
		if len(id) != 5 {
			t.Fatalf("shortID() = %q, want five digits", id)
		}
		seen[id] = true
		prev = id
	}

	if repeats > maxRepeats {
		t.Errorf("shortID() repeated the previous id %d time(s) in %d draws, want at most %d", repeats, draws, maxRepeats)
	}
	if len(seen) < 900 {
		t.Errorf("shortID() produced %d distinct ids in %d draws, want at least 900", len(seen), draws)
	}
}

// The filename is {5-digit-id}_{DD_MM_YY_HHMMSS}.zip, so two backups taken inside
// the same second are separated by the id alone. When that id repeated, os.Create
// truncated the first archive and the user was left with one backup having asked
// for two. This is that scenario end to end: back-to-back CreateBackup calls, which
// on any machine land in the same second.
func TestBackToBackBackupsDoNotOverwriteEachOther(t *testing.T) {
	svc, workDir := newBackupFixture(t)
	writeFile(t, filepath.Join(workDir, "world", "level.dat"), "world-data")

	first, err := svc.CreateBackup(testServerID)
	if err != nil {
		t.Fatal(err)
	}
	second, err := svc.CreateBackup(testServerID)
	if err != nil {
		t.Fatal(err)
	}

	if first.Filename == second.Filename {
		t.Fatalf("both backups got the filename %q; one overwrote the other", first.Filename)
	}

	list, err := svc.ListBackups(testServerID)
	if err != nil {
		t.Fatal(err)
	}
	names := make(map[string]bool, len(list))
	for _, b := range list {
		names[b.Filename] = true
	}
	if !names[first.Filename] || !names[second.Filename] {
		t.Errorf("ListBackups = %v, want both %q and %q", names, first.Filename, second.Filename)
	}
	if len(list) != 2 {
		t.Errorf("ListBackups returned %d backups, want 2", len(list))
	}
}

// reserveBackupFile is what makes the above a guarantee rather than a probability:
// a name already on disk is retried, never truncated. Seeding the directory with
// every name shortID can produce is impractical, so this checks the weaker but
// load-bearing half directly: an existing file is left exactly as it was.
func TestReserveBackupFileNeverTruncatesAnExistingFile(t *testing.T) {
	dir := t.TempDir()

	f, name, err := reserveBackupFile(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteString("original-contents"); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}

	// Whatever the next reservation picks, it must not be this file.
	for i := 0; i < 50; i++ {
		next, nextName, err := reserveBackupFile(dir)
		if err != nil {
			t.Fatal(err)
		}
		if err := next.Close(); err != nil {
			t.Fatal(err)
		}
		if nextName == name {
			t.Fatalf("reserveBackupFile returned %q twice", name)
		}
	}

	got, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "original-contents" {
		t.Errorf("existing backup = %q, want it untouched", got)
	}
}
