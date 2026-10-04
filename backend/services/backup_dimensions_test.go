package services

import (
	"archive/zip"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// ─── Every dimension of a world, in and out of an archive (#26) ────────────
//
// Paper, Spigot and Bukkit keep the nether and the end in sibling folders
// beside the overworld. A world backup used to zip the named folder alone, so
// on those servers two thirds of the world was missing from the archive and
// nothing said so: the Worlds tile draws those siblings as moons around the
// planet whose Backup button had just skipped them. These pin that the write
// side takes every dimension, the read side reports every dimension, and the
// restore puts every dimension back or none of them.

// paperWorld writes an overworld with both dimension siblings and returns the
// marker written into each, keyed by folder name.
func paperWorld(t *testing.T, workDir, name string) map[string]string {
	t.Helper()
	markers := map[string]string{
		name:              "overworld-" + name,
		name + "_nether":  "nether-" + name,
		name + "_the_end": "end-" + name,
	}
	writeBytes(t, filepath.Join(workDir, name, "level.dat"), levelDatBytes(t))
	for dir, marker := range markers {
		writeFile(t, filepath.Join(workDir, dir, "region", "r.0.0.mca"), marker)
	}
	return markers
}

// readMarkers reads each folder's region file back, so a test can say which
// dimensions survived a round trip and what they hold.
func readMarkers(t *testing.T, workDir string, dirs []string) map[string]string {
	t.Helper()
	got := map[string]string{}
	for _, dir := range dirs {
		data, err := os.ReadFile(filepath.Join(workDir, dir, "region", "r.0.0.mca"))
		if err != nil {
			continue
		}
		got[dir] = string(data)
	}
	return got
}

// The write side: all three folders reach the archive, each under its own name.
func TestCreateWorldBackupIncludesDimensionSiblings(t *testing.T) {
	svc, workDir := newBackupFixture(t)
	paperWorld(t, workDir, "world")

	b, err := svc.CreateWorldBackup(testServerID, "world")
	if err != nil {
		t.Fatalf("CreateWorldBackup: %v", err)
	}
	dir, err := svc.worldBackupDir(testServerID, "world")
	if err != nil {
		t.Fatal(err)
	}
	names := zipNames(t, filepath.Join(dir, b.Filename))

	for _, want := range []string{
		"world/level.dat",
		"world/region/r.0.0.mca",
		"world_nether/region/r.0.0.mca",
		"world_the_end/region/r.0.0.mca",
	} {
		if !names[want] {
			t.Errorf("archive is missing %q; it holds %v", want, sortedKeys(names))
		}
	}
	// The overworld's contents must not also sit at the zip root: that is the
	// old layout, and an archive carrying both would restore twice.
	if names["level.dat"] {
		t.Errorf("archive holds level.dat at the root as well as under world/; it holds %v", sortedKeys(names))
	}
}

// A world with no siblings still produces a one-folder archive rather than the
// old root layout, so there is one layout to read rather than two live ones.
func TestCreateWorldBackupOfAWorldWithNoSiblings(t *testing.T) {
	svc, workDir := newBackupFixture(t)
	writeBytes(t, filepath.Join(workDir, "solo", "level.dat"), levelDatBytes(t))
	writeFile(t, filepath.Join(workDir, "solo", "DIM-1", "r.mca"), "vanilla-nether")

	b, err := svc.CreateWorldBackup(testServerID, "solo")
	if err != nil {
		t.Fatalf("CreateWorldBackup: %v", err)
	}
	dir, err := svc.worldBackupDir(testServerID, "solo")
	if err != nil {
		t.Fatal(err)
	}
	names := zipNames(t, filepath.Join(dir, b.Filename))
	if !names["solo/level.dat"] || !names["solo/DIM-1/r.mca"] {
		t.Errorf("archive = %v, want the world under its own folder with DIM-1 inside it", sortedKeys(names))
	}
}

// A backup of a world whose folder is not there is still the same refusal it
// was: the siblings alone are not a world.
func TestCreateWorldBackupRefusesAMissingWorld(t *testing.T) {
	svc, workDir := newBackupFixture(t)
	writeFile(t, filepath.Join(workDir, "ghost_nether", "r.mca"), "orphan")

	if _, err := svc.CreateWorldBackup(testServerID, "ghost"); err == nil {
		t.Fatal("CreateWorldBackup succeeded on a world with no overworld folder")
	}

	// A path that is there but is not a directory contributes no root. Zipping
	// an empty root set would report a backup holding nothing at all.
	writeFile(t, filepath.Join(workDir, "notaworld"), "just a file")
	if _, err := svc.CreateWorldBackup(testServerID, "notaworld"); err == nil {
		t.Error("CreateWorldBackup succeeded on a world name that is a file")
	}
}

// The read side: the Backups tile is told about the siblings it can restore.
func TestGetBackupWorldsReadsAPaperWorldArchive(t *testing.T) {
	svc, workDir := newBackupFixture(t)
	paperWorld(t, workDir, "world")

	b, err := svc.CreateWorldBackup(testServerID, "world")
	if err != nil {
		t.Fatalf("CreateWorldBackup: %v", err)
	}
	systems, err := svc.GetBackupWorlds(testServerID, b.Filename)
	if err != nil {
		t.Fatalf("GetBackupWorlds: %v", err)
	}
	if len(systems) != 1 {
		t.Fatalf("systems = %+v, want the one world", systems)
	}
	sys := systems[0]

	kinds := make([]string, 0, 3)
	paths := map[string]string{}
	for _, d := range sys.Dimensions {
		kinds = append(kinds, d.Kind)
		paths[d.Kind] = d.Path
	}
	if strings.Join(kinds, ",") != "overworld,nether,the_end" {
		t.Errorf("dimensions = %v, want overworld, nether, the_end in that order", kinds)
	}
	if paths["nether"] != "world_nether" || paths["the_end"] != "world_the_end" {
		t.Errorf("sibling paths = %v, want the sibling folder names", paths)
	}
	if !sys.Meta.Found || sys.Meta.LevelName != "testworld" {
		t.Errorf("Meta = %+v, want the overworld level.dat's fields", sys.Meta)
	}
}

// The round trip: back up, wreck all three dimensions, restore, get all three.
func TestRestoreWorldBackupRestoresEveryDimension(t *testing.T) {
	svc, workDir := newBackupFixture(t)
	want := paperWorld(t, workDir, "world")
	dirs := sortedKeys(toSet(want))

	b, err := svc.CreateWorldBackup(testServerID, "world")
	if err != nil {
		t.Fatalf("CreateWorldBackup: %v", err)
	}
	for _, dir := range dirs {
		writeFile(t, filepath.Join(workDir, dir, "region", "r.0.0.mca"), "wrecked")
	}

	if err := svc.RestoreBackup(testServerID, b.Filename); err != nil {
		t.Fatalf("RestoreBackup: %v", err)
	}
	if got := readMarkers(t, workDir, dirs); !sameMarkers(got, want) {
		t.Errorf("after restore = %v, want %v", got, want)
	}
	// The aside copies are cleaned up, so the next ListWorlds does not show
	// three extra worlds called world.bak-<timestamp>.
	entries, err := os.ReadDir(workDir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if strings.Contains(e.Name(), ".bak-") || strings.HasPrefix(e.Name(), "konnekt-restore-") {
			t.Errorf("restore left %q behind in the working directory", e.Name())
		}
	}
}

// A dimension the archive does not hold is left alone rather than deleted. An
// archive written before #26 carries the overworld only, and wiping the nether
// beside it would destroy data the restore was never asked to touch.
func TestRestoreWorldBackupLeavesDimensionsTheArchiveDoesNotHold(t *testing.T) {
	svc, workDir := newBackupFixture(t)
	writeBytes(t, filepath.Join(workDir, "world", "level.dat"), levelDatBytes(t))
	writeFile(t, filepath.Join(workDir, "world", "region", "r.0.0.mca"), "overworld-v1")

	b, err := svc.CreateWorldBackup(testServerID, "world")
	if err != nil {
		t.Fatalf("CreateWorldBackup: %v", err)
	}

	// The nether arrives after the backup was taken.
	writeFile(t, filepath.Join(workDir, "world_nether", "region", "r.0.0.mca"), "nether-later")
	writeFile(t, filepath.Join(workDir, "world", "region", "r.0.0.mca"), "wrecked")

	if err := svc.RestoreBackup(testServerID, b.Filename); err != nil {
		t.Fatalf("RestoreBackup: %v", err)
	}
	got := readMarkers(t, workDir, []string{"world", "world_nether"})
	if got["world"] != "overworld-v1" {
		t.Errorf("overworld = %q, want the archived one", got["world"])
	}
	if got["world_nether"] != "nether-later" {
		t.Errorf("nether = %q, want the one on disk to be untouched", got["world_nether"])
	}
}

// Archives written before #26 have the overworld's contents at the zip root.
// They still restore, into the world folder, exactly as they used to.
func TestRestoreLegacyWorldArchiveStillWorks(t *testing.T) {
	svc, workDir := newBackupFixture(t)
	writeFile(t, filepath.Join(workDir, "world", "region", "r.0.0.mca"), "current")
	writeFile(t, filepath.Join(workDir, "world_nether", "region", "r.0.0.mca"), "nether-current")

	dir, err := svc.worldBackupDir(testServerID, "world")
	if err != nil {
		t.Fatal(err)
	}
	writeLegacyWorldZip(t, filepath.Join(dir, "00001_01_01_26_000000.zip"), map[string]string{
		"level.dat":        "legacy-level",
		"region/r.0.0.mca": "legacy-overworld",
		"DIM-1/r.0.0.mca":  "legacy-nether",
	})

	if err := svc.RestoreBackup(testServerID, "00001_01_01_26_000000.zip"); err != nil {
		t.Fatalf("RestoreBackup: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(workDir, "world", "region", "r.0.0.mca"))
	if err != nil || string(data) != "legacy-overworld" {
		t.Errorf("overworld = %q (%v), want the legacy archive's contents", data, err)
	}
	if _, err := os.Stat(filepath.Join(workDir, "world", "DIM-1", "r.0.0.mca")); err != nil {
		t.Errorf("vanilla sub-dimension missing after a legacy restore: %v", err)
	}
	// The sibling is not in a legacy archive, so it stays as it was.
	sib, err := os.ReadFile(filepath.Join(workDir, "world_nether", "region", "r.0.0.mca"))
	if err != nil || string(sib) != "nether-current" {
		t.Errorf("sibling = %q (%v), want it untouched", sib, err)
	}
}

// GetBackupWorlds reads a legacy archive the way it always did.
func TestGetBackupWorldsReadsALegacyWorldArchive(t *testing.T) {
	svc, _ := newBackupFixture(t)
	dir, err := svc.worldBackupDir(testServerID, "world")
	if err != nil {
		t.Fatal(err)
	}
	writeLegacyWorldZip(t, filepath.Join(dir, "00002_01_01_26_000000.zip"), map[string]string{
		"level.dat":   "x",
		"DIM-1/r.mca": "n",
		"DIM1/r.mca":  "e",
	})

	systems, err := svc.GetBackupWorlds(testServerID, "00002_01_01_26_000000.zip")
	if err != nil {
		t.Fatalf("GetBackupWorlds: %v", err)
	}
	if len(systems) != 1 {
		t.Fatalf("systems = %+v, want the one world", systems)
	}
	kinds := make([]string, 0, 3)
	for _, d := range systems[0].Dimensions {
		kinds = append(kinds, d.Kind)
	}
	if strings.Join(kinds, ",") != "overworld,nether,the_end" {
		t.Errorf("dimensions = %v, want the legacy reading to be unchanged", kinds)
	}
}

// Two renames are not one atomic step, so the guarantee is that a failure part
// way through leaves every dimension as it was, not a restored overworld beside
// a nether it was never paired with.
func TestRestoreWorldBackupRollsBackEveryDimensionOnFailure(t *testing.T) {
	svc, workDir := newBackupFixture(t)
	want := paperWorld(t, workDir, "world")
	dirs := sortedKeys(toSet(want))

	b, err := svc.CreateWorldBackup(testServerID, "world")
	if err != nil {
		t.Fatalf("CreateWorldBackup: %v", err)
	}
	// What is on disk now is what must still be on disk after the failure.
	onDisk := map[string]string{}
	for _, dir := range dirs {
		marker := "live-" + dir
		writeFile(t, filepath.Join(workDir, dir, "region", "r.0.0.mca"), marker)
		onDisk[dir] = marker
	}

	orig := renameIntoPlace
	t.Cleanup(func() { renameIntoPlace = orig })
	calls := 0
	renameIntoPlace = func(from, to string) error {
		calls++
		if calls == 2 {
			return errors.New("simulated rename failure")
		}
		return orig(from, to)
	}

	if err := svc.RestoreBackup(testServerID, b.Filename); err == nil {
		t.Fatal("RestoreBackup succeeded despite a failed swap")
	}
	if calls < 2 {
		t.Fatalf("renameIntoPlace called %d times, want at least one per dimension", calls)
	}
	if got := readMarkers(t, workDir, dirs); !sameMarkers(got, onDisk) {
		t.Errorf("after the failed restore = %v, want the pre-restore state %v", got, onDisk)
	}
}

// ─── Test helpers ──────────────────────────────────────────────────────────

// writeLegacyWorldZip writes an archive in the pre-#26 layout: the overworld
// folder's contents at the zip root, with no folder of its own.
func writeLegacyWorldZip(t *testing.T, path string, entries map[string]string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	w := zip.NewWriter(f)
	for _, name := range sortedKeys(toSet(entries)) {
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

// toSet reduces a marker map to the key set sortedKeys (scheduler_preview.go)
// takes, so the helpers here name folders in a stable order.
func toSet(m map[string]string) map[string]bool {
	set := make(map[string]bool, len(m))
	for k := range m {
		set[k] = true
	}
	return set
}

func sameMarkers(got, want map[string]string) bool {
	if len(got) != len(want) {
		return false
	}
	for k, v := range want {
		if got[k] != v {
			return false
		}
	}
	return true
}

// ─── Which folders a multi-root restore promotes (#452) ────────────────────
//
// An archive shared from outside Konnekt can carry a top-level folder that is
// no dimension of the world: an archiving tool's "__MACOSX", or any stray
// directory. The restore promotes into the server's working directory, so what
// it is willing to promote is the set CreateWorldBackup writes and nothing else.

func TestStagedWorldSwapsPromotesOnlyTheWorldsOwnFolders(t *testing.T) {
	tests := []struct {
		name        string
		world       string
		dirs        []string
		files       []string
		wantSwaps   []string
		wantSkipped []string
		wantErr     bool
	}{
		{
			name:      "the three Paper folders",
			world:     "world",
			dirs:      []string{"world", "world_nether", "world_the_end"},
			wantSwaps: []string{"world", "world_nether", "world_the_end"},
		},
		{
			name:      "the overworld alone",
			world:     "world",
			dirs:      []string{"world"},
			wantSwaps: []string{"world"},
		},
		{
			name:        "strays beside the dimensions are skipped, not promoted",
			world:       "world",
			dirs:        []string{"world", "world_nether", "__MACOSX", "random"},
			wantSwaps:   []string{"world", "world_nether"},
			wantSkipped: []string{"__MACOSX", "random"},
		},
		{
			name:      "a custom level name",
			world:     "survival",
			dirs:      []string{"survival", "survival_nether", "survival_the_end"},
			wantSwaps: []string{"survival", "survival_nether", "survival_the_end"},
		},
		{
			name:        "another world's folders are not this world's dimensions",
			world:       "survival",
			dirs:        []string{"survival", "world", "world_nether"},
			wantSwaps:   []string{"survival"},
			wantSkipped: []string{"world", "world_nether"},
		},
		{
			name:        "nothing allowed is an error that still names what was skipped",
			world:       "world",
			dirs:        []string{"__MACOSX", "random"},
			wantSkipped: []string{"__MACOSX", "random"},
			wantErr:     true,
		},
		{
			name:    "an empty staging dir is an error",
			world:   "world",
			wantErr: true,
		},
		{
			name:        "loose files at the root are ignored, not reported",
			world:       "world",
			dirs:        []string{"world", "__MACOSX"},
			files:       []string{"level.dat", "world_nether"},
			wantSwaps:   []string{"world"},
			wantSkipped: []string{"__MACOSX"},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			tmp := t.TempDir()
			parent := t.TempDir()
			for _, d := range tc.dirs {
				if err := os.MkdirAll(filepath.Join(tmp, d), 0755); err != nil {
					t.Fatal(err)
				}
			}
			for _, f := range tc.files {
				writeFile(t, filepath.Join(tmp, f), "loose")
			}

			swaps, skipped, err := stagedWorldSwaps(tmp, parent, tc.world)
			if (err != nil) != tc.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, tc.wantErr)
			}
			var got []string
			for _, sw := range swaps {
				name := filepath.Base(sw.target)
				got = append(got, name)
				if sw.staged != filepath.Join(tmp, name) || sw.target != filepath.Join(parent, name) {
					t.Errorf("swap %+v, want %s staged under tmp and targeted under the parent dir", sw, name)
				}
			}
			if strings.Join(sortedStrings(got), ",") != strings.Join(sortedStrings(tc.wantSwaps), ",") {
				t.Errorf("swaps = %v, want %v", got, tc.wantSwaps)
			}
			if strings.Join(sortedStrings(skipped), ",") != strings.Join(sortedStrings(tc.wantSkipped), ",") {
				t.Errorf("skipped = %v, want %v", skipped, tc.wantSkipped)
			}
		})
	}
}

func sortedStrings(in []string) []string {
	out := append([]string(nil), in...)
	sort.Strings(out)
	return out
}

// The end to end case: a shared archive with a stray folder restores the world and
// leaves the stray out of the server's working directory.
func TestRestoreWorldBackupDoesNotPlantStrayArchiveFolders(t *testing.T) {
	svc, workDir := newBackupFixture(t)
	writeFile(t, filepath.Join(workDir, "world", "region", "r.0.0.mca"), "current")

	dir, err := svc.worldBackupDir(testServerID, "world")
	if err != nil {
		t.Fatal(err)
	}
	makeZip(t, filepath.Join(dir, "00003_01_01_26_000000.zip"), map[string]string{
		"world/level.dat":           "level",
		"world/region/r.0.0.mca":    "restored-overworld",
		"world_nether/region/n.mca": "restored-nether",
		"__MACOSX/world/._level":    "metadata",
		"stray/notes.txt":           "not a dimension",
	})

	if err := svc.RestoreBackup(testServerID, "00003_01_01_26_000000.zip"); err != nil {
		t.Fatalf("RestoreBackup: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(workDir, "world", "region", "r.0.0.mca"))
	if err != nil || string(data) != "restored-overworld" {
		t.Errorf("overworld = %q (%v), want the archived one", data, err)
	}
	if _, err := os.Stat(filepath.Join(workDir, "world_nether", "region", "n.mca")); err != nil {
		t.Errorf("nether not restored: %v", err)
	}
	for _, stray := range []string{"__MACOSX", "stray"} {
		if _, err := os.Stat(filepath.Join(workDir, stray)); !errors.Is(err, os.ErrNotExist) {
			t.Errorf("%s was promoted into the working directory (stat err: %v)", stray, err)
		}
	}
	entries, err := os.ReadDir(workDir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "konnekt-restore-") {
			t.Errorf("restore left the staging dir %q behind", e.Name())
		}
	}
}
