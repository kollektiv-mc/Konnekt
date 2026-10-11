package services

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const dhTestPart = 1024

// dhBytes is deterministic filler that differs between parts and between seeds,
// standing in for a database: nothing here is SQLite, and nothing opens it.
func dhBytes(n int, seed byte) []byte {
	b := make([]byte, n)
	for i := range b {
		b[i] = byte(i*31+i/dhTestPart*7) ^ seed
	}
	return b
}

func hexSum(b []byte) string {
	s := sha256.Sum256(b)
	return hex.EncodeToString(s[:])
}

func testKeys(t *testing.T, token string) SnapshotKeys {
	t.Helper()
	k, err := snapshotKeys("dh", token, time.Date(2026, 10, 11, 4, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	return k
}

// dhSource builds a source with one level per entry, written under a temp dir.
func dhSource(t *testing.T, dbs map[string][]byte) DHSnapshotSource {
	t.Helper()
	root := t.TempDir()
	src := DHSnapshotSource{DHVersion: "3.3.3-b", ServerFolder: "42_frang"}
	for _, folder := range []string{"pfx@minecraft@@overworld", "pfx@minecraft@@the_nether"} {
		data, ok := dbs[folder]
		if !ok {
			continue
		}
		p := dhWrite(t, root, folder+".sqlite", data)
		src.Levels = append(src.Levels, DHLevel{Folder: folder, Path: p})
	}
	return src
}

func TestDHPartSizeIsAboveTheMultipartMinimum(t *testing.T) {
	if DHPartSize != 8<<20 {
		t.Errorf("DHPartSize = %d, want 8 MiB", DHPartSize)
	}
	if DHPartSize < 5<<20 {
		t.Error("parts below 5 MiB cannot be assembled with UploadPartCopy")
	}
}

func TestStageHashesAreStable(t *testing.T) {
	data := dhBytes(3*dhTestPart+100, 1)
	src := dhSource(t, map[string][]byte{"pfx@minecraft@@overworld": data})

	first, _, err := stageDHSnapshot(src, nil, "", testKeys(t, ""), dhTestPart)
	if err != nil {
		t.Fatal(err)
	}
	second, _, err := stageDHSnapshot(src, nil, "", testKeys(t, ""), dhTestPart)
	if err != nil {
		t.Fatal(err)
	}
	a, err := first.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	b, err := second.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(a, b) {
		t.Error("the same bytes produced two different indexes")
	}

	lvl := first.Levels[0]
	if lvl.SHA256 != hexSum(data) || lvl.Size != int64(len(data)) {
		t.Errorf("whole-file hash or size wrong: %+v", lvl)
	}
	if len(lvl.Parts) != 4 {
		t.Fatalf("parts = %d, want 4", len(lvl.Parts))
	}
	for i, p := range lvl.Parts {
		lo, hi := i*dhTestPart, min((i+1)*dhTestPart, len(data))
		if p.SHA256 != hexSum(data[lo:hi]) || p.Size != int64(hi-lo) {
			t.Errorf("part %d = %+v", i, p)
		}
	}
}

func TestStageShortLastPart(t *testing.T) {
	data := dhBytes(2*dhTestPart+5, 2)
	src := dhSource(t, map[string][]byte{"pfx@minecraft@@overworld": data})
	ix, absent, err := stageDHSnapshot(src, nil, "", testKeys(t, ""), dhTestPart)
	if err != nil {
		t.Fatal(err)
	}
	parts := ix.Levels[0].Parts
	if len(parts) != 3 || parts[0].Size != dhTestPart || parts[1].Size != dhTestPart || parts[2].Size != 5 {
		t.Errorf("parts = %+v", parts)
	}
	if len(absent) != 3 {
		t.Errorf("absent = %d, want 3 on a first snapshot", len(absent))
	}
}

func TestStageExactMultipleHasNoEmptyTrailingPart(t *testing.T) {
	src := dhSource(t, map[string][]byte{"pfx@minecraft@@overworld": dhBytes(2*dhTestPart, 3)})
	ix, _, err := stageDHSnapshot(src, nil, "", testKeys(t, ""), dhTestPart)
	if err != nil {
		t.Fatal(err)
	}
	if n := len(ix.Levels[0].Parts); n != 2 {
		t.Errorf("parts = %d, want 2", n)
	}
}

func TestStageDatabaseSmallerThanOnePart(t *testing.T) {
	// The real part size, so the constant is exercised too.
	data := dhBytes(4096, 4)
	src := dhSource(t, map[string][]byte{"pfx@minecraft@@overworld": data})
	stageDir := t.TempDir()
	ix, absent, err := stageDHSnapshot(src, nil, stageDir, testKeys(t, ""), DHPartSize)
	if err != nil {
		t.Fatal(err)
	}
	lvl := ix.Levels[0]
	if len(lvl.Parts) != 1 || lvl.Parts[0].Size != 4096 || lvl.Parts[0].SHA256 != lvl.SHA256 {
		t.Errorf("level = %+v", lvl)
	}
	if len(absent) != 1 {
		t.Fatalf("absent = %d", len(absent))
	}
	got, err := os.ReadFile(filepath.Join(stageDir, "parts", absent[0].SHA256))
	if err != nil || !bytes.Equal(got, data) {
		t.Errorf("staged part does not match the database: %v", err)
	}
}

func TestStageEmptyDatabase(t *testing.T) {
	src := dhSource(t, map[string][]byte{"pfx@minecraft@@overworld": {}})
	ix, absent, err := stageDHSnapshot(src, nil, "", testKeys(t, ""), dhTestPart)
	if err != nil {
		t.Fatal(err)
	}
	lvl := ix.Levels[0]
	if lvl.Size != 0 || len(lvl.Parts) != 0 || lvl.SHA256 != hexSum(nil) || len(absent) != 0 {
		t.Errorf("level = %+v, absent = %v", lvl, absent)
	}
}

func TestStagePartAlignedEditChangesExactlyOnePart(t *testing.T) {
	original := dhBytes(5*dhTestPart+300, 5)
	src := dhSource(t, map[string][]byte{"pfx@minecraft@@overworld": original})
	prev, _, err := stageDHSnapshot(src, nil, "", testKeys(t, ""), dhTestPart)
	if err != nil {
		t.Fatal(err)
	}

	edited := append([]byte(nil), original...)
	for i := 2 * dhTestPart; i < 3*dhTestPart; i++ { // exactly part 2
		edited[i] ^= 0xFF
	}
	dhWrite(t, filepath.Dir(src.Levels[0].Path), filepath.Base(src.Levels[0].Path), edited)

	stageDir := t.TempDir()
	next, absent, err := stageDHSnapshot(src, &prev, stageDir, testKeys(t, ""), dhTestPart)
	if err != nil {
		t.Fatal(err)
	}
	if len(absent) != 1 || absent[0].SHA256 != hexSum(edited[2*dhTestPart:3*dhTestPart]) {
		t.Fatalf("absent = %+v, want only part 2", absent)
	}
	for i, p := range next.Levels[0].Parts {
		same := p == prev.Levels[0].Parts[i]
		if same == (i == 2) {
			t.Errorf("part %d: unchanged=%v", i, same)
		}
	}
	if next.Levels[0].SHA256 == prev.Levels[0].SHA256 {
		t.Error("whole-file hash did not change")
	}
	entries, err := os.ReadDir(filepath.Join(stageDir, "parts"))
	if err != nil || len(entries) != 1 {
		t.Errorf("staged %d files (%v), want exactly 1", len(entries), err)
	}
}

func TestStageUnchangedDatabaseStagesNothing(t *testing.T) {
	src := dhSource(t, map[string][]byte{"pfx@minecraft@@overworld": dhBytes(3*dhTestPart, 6)})
	prev, _, err := stageDHSnapshot(src, nil, "", testKeys(t, ""), dhTestPart)
	if err != nil {
		t.Fatal(err)
	}
	stageDir := t.TempDir()
	_, absent, err := stageDHSnapshot(src, &prev, stageDir, testKeys(t, ""), dhTestPart)
	if err != nil {
		t.Fatal(err)
	}
	if len(absent) != 0 {
		t.Errorf("absent = %+v", absent)
	}
	if _, err := os.Stat(filepath.Join(stageDir, "parts")); !os.IsNotExist(err) {
		t.Errorf("a parts folder was created for nothing: %v", err)
	}
}

func TestStageDeduplicatesWithinARunAndAcrossLevels(t *testing.T) {
	zero := make([]byte, 3*dhTestPart) // three identical parts
	src := dhSource(t, map[string][]byte{
		"pfx@minecraft@@overworld":  zero,
		"pfx@minecraft@@the_nether": zero,
	})
	stageDir := t.TempDir()
	ix, absent, err := stageDHSnapshot(src, nil, stageDir, testKeys(t, ""), dhTestPart)
	if err != nil {
		t.Fatal(err)
	}
	if len(absent) != 1 {
		t.Errorf("absent = %d, want one object for identical parts", len(absent))
	}
	if len(ix.Levels) != 2 || len(ix.Levels[0].Parts) != 3 || len(ix.Levels[1].Parts) != 3 {
		t.Errorf("the index must still list every part of every level: %+v", ix.Levels)
	}
}

func TestStageKnownPartInAnotherLevelIsNotCopied(t *testing.T) {
	shared := dhBytes(dhTestPart, 7)
	prev := DHIndex{Format: 1, Levels: []DHIndexLevel{{Folder: "pfx@minecraft@@the_nether", Parts: []DHPart{{SHA256: hexSum(shared), Size: dhTestPart}}}}}
	src := dhSource(t, map[string][]byte{"pfx@minecraft@@overworld": shared})
	_, absent, err := stageDHSnapshot(src, &prev, "", testKeys(t, ""), dhTestPart)
	if err != nil || len(absent) != 0 {
		t.Errorf("absent = %+v, err = %v", absent, err)
	}
}

func TestStageErrors(t *testing.T) {
	keys := testKeys(t, "")
	missing := DHSnapshotSource{Levels: []DHLevel{{Folder: "f", Path: filepath.Join(t.TempDir(), "gone.sqlite")}}}
	if _, _, err := stageDHSnapshot(missing, nil, "", keys, dhTestPart); err == nil {
		t.Error("a missing database was not an error")
	}
	src := dhSource(t, map[string][]byte{"pfx@minecraft@@overworld": dhBytes(10, 8)})
	if _, _, err := stageDHSnapshot(src, nil, "", keys, 0); err == nil {
		t.Error("a zero part size was accepted")
	}
	// A file where the parts folder must go.
	stageDir := t.TempDir()
	dhWrite(t, stageDir, "parts", []byte("in the way"))
	if _, _, err := stageDHSnapshot(src, nil, stageDir, keys, dhTestPart); err == nil {
		t.Error("an unwritable stage directory was not an error")
	}
}

func TestIndexRoundTrip(t *testing.T) {
	src := dhSource(t, map[string][]byte{
		"pfx@minecraft@@overworld":  dhBytes(2*dhTestPart+9, 9),
		"pfx@minecraft@@the_nether": dhBytes(17, 10),
	})
	ix, _, err := stageDHSnapshot(src, nil, "", testKeys(t, ""), dhTestPart)
	if err != nil {
		t.Fatal(err)
	}
	if ix.Format != 1 || ix.CreatedAt != "2026-10-11T04:00:00Z" || ix.PartsBase != "../../parts/" ||
		ix.DHVersion != "3.3.3-b" || ix.ServerFolder != "42_frang" {
		t.Errorf("header = %+v", ix)
	}
	data, err := ix.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{`"format"`, `"createdAt"`, `"partsBase"`, `"dhVersion"`, `"serverFolder"`, `"folder"`, `"size"`, `"sha256"`, `"parts"`} {
		if !strings.Contains(string(data), field) {
			t.Errorf("index.json has no %s", field)
		}
	}
	back, err := parseDHIndex(data)
	if err != nil {
		t.Fatal(err)
	}
	again, err := back.Marshal()
	if err != nil || !bytes.Equal(data, again) {
		t.Errorf("round trip changed the index: %v", err)
	}
	if len(back.Levels) != 2 || back.Levels[0].Parts[0] != ix.Levels[0].Parts[0] {
		t.Errorf("decoded = %+v", back)
	}
}

func TestParseDHIndexRefusals(t *testing.T) {
	for name, in := range map[string]string{
		"not json":       "nope",
		"unknown format": `{"format":2}`,
		"no format":      `{}`,
	} {
		if _, err := parseDHIndex([]byte(in)); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestSnapshotKeys(t *testing.T) {
	at := time.Date(2026, 10, 11, 6, 0, 0, 0, time.FixedZone("CEST", 2*3600)) // 04:00Z

	t.Run("public", func(t *testing.T) {
		k, err := snapshotKeys("frangfurd/dh", "", at)
		if err != nil {
			t.Fatal(err)
		}
		want := SnapshotKeys{
			CreatedAt:   "2026-10-11T04:00:00Z",
			Latest:      "frangfurd/dh/latest.json",
			Index:       "frangfurd/dh/snapshots/2026-10-11T04:00:00Z/index.json",
			Page:        "frangfurd/dh/snapshots/2026-10-11T04:00:00Z/index.html",
			PartsPrefix: "frangfurd/dh/parts/",
			PartsBase:   "../../parts/",
		}
		k.snapshotDir = ""
		if k != want {
			t.Errorf("got %+v\nwant %+v", k, want)
		}
	})

	t.Run("private", func(t *testing.T) {
		k, err := snapshotKeys("frangfurd/dh", "abcdefghijklmnopqrstuvwxyz", at)
		if err != nil {
			t.Fatal(err)
		}
		if k.Latest != "frangfurd/dh/abcdefghijklmnopqrstuvwxyz/latest.json" ||
			k.Index != "frangfurd/dh/abcdefghijklmnopqrstuvwxyz/snapshots/2026-10-11T04:00:00Z/index.json" ||
			k.Page != "frangfurd/dh/abcdefghijklmnopqrstuvwxyz/snapshots/2026-10-11T04:00:00Z/index.html" {
			t.Errorf("small files are not under the token: %+v", k)
		}
		if k.PartsPrefix != "frangfurd/dh/parts/" || k.PartsBase != "../../../parts/" {
			t.Errorf("parts must stay out of the token: %q, base %q", k.PartsPrefix, k.PartsBase)
		}
	})

	t.Run("partsBase resolves to the parts folder from the index", func(t *testing.T) {
		for _, token := range []string{"", "tok"} {
			k, err := snapshotKeys("p", token, at)
			if err != nil {
				t.Fatal(err)
			}
			got := path.Join(path.Dir(k.Index), k.PartsBase)
			if got+"/" != k.PartsPrefix {
				t.Errorf("token %q: %s from %s is %s, want %s", token, k.PartsBase, k.Index, got, k.PartsPrefix)
			}
		}
	})

	t.Run("empty and slashed prefixes", func(t *testing.T) {
		k, err := snapshotKeys("", "", at)
		if err != nil || k.Latest != "latest.json" || k.PartsPrefix != "parts/" {
			t.Errorf("empty prefix: %+v, %v", k, err)
		}
		k, err = snapshotKeys("/a/b/", "tok", at)
		if err != nil || k.Latest != "a/b/tok/latest.json" || k.PartsPrefix != "a/b/parts/" {
			t.Errorf("slashed prefix: %+v, %v", k, err)
		}
	})

	t.Run("part and assembled keys", func(t *testing.T) {
		k, err := snapshotKeys("p", "tok", at)
		if err != nil {
			t.Fatal(err)
		}
		if got := k.PartKey("abc"); got != "p/parts/abc" {
			t.Errorf("PartKey = %s", got)
		}
		if got := k.AssembledKey("pfx@minecraft@@overworld"); got != "p/tok/snapshots/2026-10-11T04:00:00Z/pfx@minecraft@@overworld/DistantHorizons.sqlite" {
			t.Errorf("AssembledKey = %s", got)
		}
	})

	t.Run("a token that is not one path segment", func(t *testing.T) {
		for _, bad := range []string{"a/b", "..", "a b", "tok\n"} {
			if _, err := snapshotKeys("p", bad, at); err == nil {
				t.Errorf("token %q accepted", bad)
			}
		}
	})
}
