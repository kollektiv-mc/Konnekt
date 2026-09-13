package services

import (
	"archive/zip"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"
)

// ─── Reading worlds out of an archive ──────────────────────────────────────
//
// GetBackupWorlds, worldsFromServerZip and worldsFromWorldZip had no test at
// all: every one of their mutants survived the 2026-09-12 run (#348). They
// decide what the Backups tile shows for an archive, so each of their rules
// is pinned here by an archive that would read differently without it.

// levelDatBytes is buildTestLevelDat's gzip-compressed NBT, so a world in a
// fixture can carry metadata the reader actually parses.
func levelDatBytes(t *testing.T) []byte {
	t.Helper()
	path := buildTestLevelDat(t)
	t.Cleanup(func() { _ = os.Remove(path) })
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read level.dat: %v", err)
	}
	return data
}

func writeBytes(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatal(err)
	}
}

func TestGetBackupWorldsReadsAServerArchive(t *testing.T) {
	svc, workDir := newBackupFixture(t)
	level := levelDatBytes(t)

	// The active world with vanilla sub-dimensions inside it.
	writeFile(t, filepath.Join(workDir, "server.properties"), "level-name=alpha\n")
	writeBytes(t, filepath.Join(workDir, "alpha", "level.dat"), level)
	writeFile(t, filepath.Join(workDir, "alpha", "region", "r.0.0.mca"), "overworld-region")
	writeFile(t, filepath.Join(workDir, "alpha", "DIM-1", "region", "r.0.0.mca"), "nether-data")
	writeFile(t, filepath.Join(workDir, "alpha", "DIM1", "region", "r.0.0.mca"), "end")
	// An inactive world laid out the Bukkit way, with a nether sibling directory.
	// Its DIM-1 folder must not add a second nether: the sibling already is one.
	writeFile(t, filepath.Join(workDir, "beta", "level.dat"), "not-nbt")
	writeFile(t, filepath.Join(workDir, "beta", "DIM-1", "r.mca"), "x")
	writeFile(t, filepath.Join(workDir, "beta_nether", "level.dat"), "bn")
	// A level.dat below the top level is not a world.
	writeFile(t, filepath.Join(workDir, "nested", "inner", "level.dat"), "deep")
	// Server files outside any world count towards nothing.
	writeFile(t, filepath.Join(workDir, "plugins", "foo.txt"), "plugin")

	b, err := svc.CreateBackup(testServerID)
	if err != nil {
		t.Fatalf("CreateBackup: %v", err)
	}
	systems, err := svc.GetBackupWorlds(testServerID, b.Filename)
	if err != nil {
		t.Fatalf("GetBackupWorlds: %v", err)
	}
	sort.Slice(systems, func(i, j int) bool { return systems[i].Name < systems[j].Name })
	if len(systems) != 2 || systems[0].Name != "alpha" || systems[1].Name != "beta" {
		t.Fatalf("systems = %+v, want alpha and beta", systems)
	}

	alpha, beta := systems[0], systems[1]
	if !alpha.Active || beta.Active {
		t.Errorf("Active: alpha=%v beta=%v, want the level-name world and only it", alpha.Active, beta.Active)
	}
	wantAlpha := []string{"overworld", "nether", "the_end"}
	gotAlpha := make([]string, 0, 3)
	paths := map[string]string{}
	for _, d := range alpha.Dimensions {
		gotAlpha = append(gotAlpha, d.Kind)
		paths[d.Kind] = d.Path
	}
	if strings.Join(gotAlpha, ",") != strings.Join(wantAlpha, ",") {
		t.Errorf("alpha dimensions = %v, want %v", gotAlpha, wantAlpha)
	}
	if paths["overworld"] != "alpha" || paths["nether"] != "alpha/DIM-1" || paths["the_end"] != "alpha/DIM1" {
		t.Errorf("alpha dimension paths = %v", paths)
	}
	if want := int64(len(level) + len("overworld-region") + len("nether-data") + len("end")); alpha.TotalSize != want {
		t.Errorf("alpha TotalSize = %d, want %d (every file under alpha/ and its DIM folders)", alpha.TotalSize, want)
	}
	if alpha.Modified <= 0 {
		t.Errorf("alpha Modified = %d, want the newest entry's timestamp", alpha.Modified)
	}
	if !alpha.Meta.Found || alpha.Meta.LevelName != "testworld" || alpha.Meta.Version != "1.20.4" {
		t.Errorf("alpha Meta = %+v, want the level.dat's fields", alpha.Meta)
	}

	gotBeta := make([]string, 0, 2)
	for _, d := range beta.Dimensions {
		gotBeta = append(gotBeta, d.Kind+"@"+d.Path)
	}
	if strings.Join(gotBeta, ",") != "overworld@beta,nether@beta_nether" {
		t.Errorf("beta dimensions = %v, want the overworld and the sibling nether only", gotBeta)
	}
	if want := int64(len("not-nbt") + len("x") + len("bn")); beta.TotalSize != want {
		t.Errorf("beta TotalSize = %d, want %d", beta.TotalSize, want)
	}
	if beta.Meta.Found {
		t.Error("beta Meta.Found = true for a level.dat that is not NBT")
	}
}

func TestGetBackupWorldsReadsAWorldArchive(t *testing.T) {
	svc, workDir := newBackupFixture(t)
	level := levelDatBytes(t)
	writeBytes(t, filepath.Join(workDir, "gamma", "level.dat"), level)
	writeFile(t, filepath.Join(workDir, "gamma", "region", "r.0.0.mca"), "over")
	writeFile(t, filepath.Join(workDir, "gamma", "DIM-1", "a.mca"), "n1")
	writeFile(t, filepath.Join(workDir, "gamma", "DIM-1", "b.mca"), "n2")
	writeFile(t, filepath.Join(workDir, "gamma", "DIM1", "c.mca"), "e")

	b, err := svc.CreateWorldBackup(testServerID, "gamma")
	if err != nil {
		t.Fatalf("CreateWorldBackup: %v", err)
	}
	systems, err := svc.GetBackupWorlds(testServerID, b.Filename)
	if err != nil {
		t.Fatalf("GetBackupWorlds: %v", err)
	}
	if len(systems) != 1 || systems[0].Name != "gamma" {
		t.Fatalf("systems = %+v, want the one world", systems)
	}
	sys := systems[0]
	kinds := make([]string, 0, 3)
	for _, d := range sys.Dimensions {
		kinds = append(kinds, d.Kind)
	}
	// Two nether files, one nether dimension.
	if strings.Join(kinds, ",") != "overworld,nether,the_end" {
		t.Errorf("dimensions = %v, want overworld, nether, the_end once each", kinds)
	}
	if sys.Dimensions[0].Path != "gamma" {
		t.Errorf("overworld path = %q, want the world name", sys.Dimensions[0].Path)
	}
	if want := int64(len(level) + len("over") + len("n1") + len("n2") + len("e")); sys.TotalSize != want {
		t.Errorf("TotalSize = %d, want %d", sys.TotalSize, want)
	}
	if sys.Modified <= 0 {
		t.Errorf("Modified = %d, want the newest entry's timestamp", sys.Modified)
	}
	if !sys.Meta.Found || sys.Meta.LevelName != "testworld" {
		t.Errorf("Meta = %+v, want the level.dat's fields", sys.Meta)
	}
}

func TestGetBackupWorldsRefusals(t *testing.T) {
	svc, workDir := newBackupFixture(t)
	writeFile(t, filepath.Join(workDir, "world", "level.dat"), "data")
	b, err := svc.CreateBackup(testServerID)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := svc.GetBackupWorlds(testServerID, filepath.Join("..", "escape.zip")); err == nil {
		t.Error("a traversing filename was accepted")
	}
	if _, err := svc.GetBackupWorlds(testServerID, "missing.zip"); err == nil || !strings.Contains(err.Error(), "missing.zip") {
		t.Errorf("unknown filename error = %v, want it to name the file", err)
	}
	zipPath, _, _, _, err := svc.findBackupFile(testServerID, b.Filename)
	if err != nil {
		t.Fatal(err)
	}
	writeFile(t, zipPath, "not a zip")
	if _, err := svc.GetBackupWorlds(testServerID, b.Filename); err == nil {
		t.Error("a corrupt archive was read as worlds")
	}
}

func TestParsePropertiesReader(t *testing.T) {
	in := "# a comment\n\n  level-name = alpha  \nno-equals-here\nmotd=a=b\n"
	got := parsePropertiesReader(strings.NewReader(in))
	if len(got) != 2 || got["level-name"] != "alpha" || got["motd"] != "a=b" {
		t.Errorf("parsePropertiesReader = %v, want level-name=alpha and motd=a=b only", got)
	}
}

// The legacy naming rule: five digits, an underscore, and enough after it to
// be a name. Each case is one boundary of that rule.
func TestIsServerFilename(t *testing.T) {
	cases := map[string]bool{
		"12345_x.zip":  true,
		"00000_x.zip":  true, // both digit boundaries
		"99999_x.zip":  true,
		"12345_":       false, // too short to be a name
		"12345_a":      true,  // the shortest name that qualifies
		"1234_xx.zip":  false, // four digits
		"123456_x.zip": false, // six digits: the sixth is not the separator
		"12345x.zip":   false, // no separator
		"abcde_x.zip":  false, // not digits
		"1234x_x.zip":  false, // a letter among the digits
	}
	for name, want := range cases {
		if got := isServerFilename(name); got != want {
			t.Errorf("isServerFilename(%q) = %v, want %v", name, got, want)
		}
	}
}

// ─── The legacy layout, and listing order ──────────────────────────────────

// Backups made before the server/worlds split sit directly under the server's
// backup root, with the kind read off the filename. They still list, still
// carry their sidecar metadata, and still restore.
func TestLegacyRootBackupsListAndResolve(t *testing.T) {
	svc, _ := newBackupFixture(t)
	root, err := svc.backupRoot(testServerID)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(root, 0755); err != nil {
		t.Fatal(err)
	}
	makeZip(t, filepath.Join(root, "12345_full.zip"), map[string]string{"server.properties": "level-name=world\n"})
	makeZip(t, filepath.Join(root, "oldworld.zip"), map[string]string{"level.dat": "legacy-level"})
	writeFile(t, filepath.Join(root, "meta.json"), `{"oldworld.zip":{"displayName":"Old","tags":["keep"]}}`)

	list, err := svc.ListBackups(testServerID)
	if err != nil {
		t.Fatal(err)
	}
	byName := map[string]int{}
	for i, b := range list {
		byName[b.Filename] = i
	}
	full, ok := byName["12345_full.zip"]
	if !ok {
		t.Fatalf("legacy server backup not listed: %+v", list)
	}
	old, ok := byName["oldworld.zip"]
	if !ok {
		t.Fatalf("legacy world backup not listed: %+v", list)
	}
	if got := list[full]; got.Kind != "server" || got.World != "" || got.Tags == nil || len(got.Tags) != 0 {
		t.Errorf("legacy server backup = %+v, want Kind server, no world, empty non-nil tags", got)
	}
	if got := list[old]; got.Kind != "world" || got.DisplayName != "Old" || len(got.Tags) != 1 || got.Tags[0] != "keep" {
		t.Errorf("legacy world backup = %+v, want Kind world with its sidecar name and tag", got)
	}
	info, err := os.Stat(filepath.Join(root, "oldworld.zip"))
	if err != nil {
		t.Fatal(err)
	}
	if got := list[old]; got.SizeBytes != info.Size() || got.CreatedAt != info.ModTime().UnixMilli() {
		t.Errorf("legacy world backup size/time = %d/%d, want the file's %d/%d", got.SizeBytes, got.CreatedAt, info.Size(), info.ModTime().UnixMilli())
	}

	path, metaDir, kind, world, err := svc.findBackupFile(testServerID, "oldworld.zip")
	if err != nil || path != filepath.Join(root, "oldworld.zip") || metaDir != root || kind != "world" || world != "" {
		t.Errorf("findBackupFile(legacy world) = %q, %q, %q, %q, %v", path, metaDir, kind, world, err)
	}
	if _, _, kind, _, err := svc.findBackupFile(testServerID, "12345_full.zip"); err != nil || kind != "server" {
		t.Errorf("findBackupFile(legacy server) kind = %q, %v; want server", kind, err)
	}
}

// Newest first, by the archive's own timestamp, across every directory.
func TestListBackupsOrdersNewestFirst(t *testing.T) {
	svc, workDir := newBackupFixture(t)
	writeFile(t, filepath.Join(workDir, "world", "level.dat"), "data")

	first, err := svc.CreateBackup(testServerID)
	if err != nil {
		t.Fatal(err)
	}
	second, err := svc.CreateWorldBackup(testServerID, "world")
	if err != nil {
		t.Fatal(err)
	}
	// Age the world backup so the order is decided by time, not by directory.
	worldDir, err := svc.worldBackupDir(testServerID, "world")
	if err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-2 * time.Hour)
	if err := os.Chtimes(filepath.Join(worldDir, second.Filename), old, old); err != nil {
		t.Fatal(err)
	}

	list, err := svc.ListBackups(testServerID)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 || list[0].Filename != first.Filename || list[1].Filename != second.Filename {
		t.Fatalf("ListBackups order = %v, want the newer server backup first", list)
	}
	if list[1].CreatedAt != old.UnixMilli() {
		t.Errorf("aged backup CreatedAt = %d, want %d (the file's mtime)", list[1].CreatedAt, old.UnixMilli())
	}
	serverDir, err := svc.serverBackupDir(testServerID)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(serverDir, first.Filename))
	if err != nil {
		t.Fatal(err)
	}
	if list[0].SizeBytes != info.Size() || first.SizeBytes != info.Size() {
		t.Errorf("SizeBytes = %d (listed) / %d (returned), want the file's %d", list[0].SizeBytes, first.SizeBytes, info.Size())
	}
	if first.CreatedAt != info.ModTime().UnixMilli() {
		t.Errorf("CreatedAt = %d, want the file's %d", first.CreatedAt, info.ModTime().UnixMilli())
	}
	if first.Tags == nil {
		t.Error("a fresh backup's Tags is nil; the tile expects an empty list")
	}
}

// ─── The archive itself ────────────────────────────────────────────────────

func TestZipDirSkipsSessionLockAndKeepsEmptyDirs(t *testing.T) {
	src := t.TempDir()
	writeFile(t, filepath.Join(src, "level.dat"), "l")
	writeFile(t, filepath.Join(src, "session.lock"), "held by the server")
	if err := os.MkdirAll(filepath.Join(src, "empty"), 0755); err != nil {
		t.Fatal(err)
	}

	zipPath := filepath.Join(t.TempDir(), "out.zip")
	out, err := os.Create(zipPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := zipDirWithProgress(src, out, nil); err != nil {
		t.Fatal(err)
	}
	if err := out.Close(); err != nil {
		t.Fatal(err)
	}

	names := zipNames(t, zipPath)
	if names["session.lock"] {
		t.Error("session.lock was archived; the running server holds it and it carries no data")
	}
	if !names["empty/"] {
		t.Errorf("the empty directory was dropped: %v", names)
	}
	if !names["level.dat"] {
		t.Errorf("level.dat missing: %v", names)
	}

	dest := t.TempDir()
	if err := unzipTo(zipPath, dest); err != nil {
		t.Fatal(err)
	}
	if info, err := os.Stat(filepath.Join(dest, "empty")); err != nil || !info.IsDir() {
		t.Errorf("empty directory not recreated on extract: %v", err)
	}
}

// makeZip writes entries (name -> content; a name ending in "/" is a
// directory) into a fresh archive at path.
func makeZip(t *testing.T, path string, entries map[string]string) {
	t.Helper()
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	w := zip.NewWriter(f)
	names := make([]string, 0, len(entries))
	for name := range entries {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		fw, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := fw.Write([]byte(entries[name])); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
}

func zipNames(t *testing.T, path string) map[string]bool {
	t.Helper()
	r, err := zip.OpenReader(path)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	names := map[string]bool{}
	for _, f := range r.File {
		names[f.Name] = true
	}
	return names
}

// An archive whose entries contradict each other (a file where a parent
// directory is needed, a directory where a file is named) cannot be
// extracted, and says so rather than leaving a half-written tree silent.
func TestUnzipToReportsConflictingEntries(t *testing.T) {
	cases := map[string]map[string]string{
		"a file where a directory is needed": {"a": "file", "a/b": "x"},
		"a directory where a file is named":  {"d/": "", "d": "x"},
	}
	for name, entries := range cases {
		t.Run(name, func(t *testing.T) {
			zipPath := filepath.Join(t.TempDir(), "bad.zip")
			makeZip(t, zipPath, entries)
			if err := unzipTo(zipPath, t.TempDir()); err == nil {
				t.Error("unzipTo of conflicting entries = nil error")
			}
		})
	}
}
