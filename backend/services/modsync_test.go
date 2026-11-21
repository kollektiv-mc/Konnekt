package services

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha1" //nolint:gosec // the CurseForge fixture's hash format
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"konnekt/backend/models"
)

// --- Fixtures ---

// packMod is one mod in a test pack.
type packMod struct {
	key        string // metafile name without .pw.toml
	file       string
	side       string
	jar        []byte
	projectID  string
	curseforge bool // a metadata:curseforge entry, hashed by sha1
}

// neoJar is a tiny NeoForge mod jar declaring modID. The version goes into
// the bytes too, so two versions of one mod hash differently.
func neoJar(t *testing.T, modID, version string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, err := zw.Create("META-INF/neoforge.mods.toml")
	if err != nil {
		t.Fatal(err)
	}
	fmt.Fprintf(w, "modLoader=\"javafml\"\n[[mods]]\nmodId=\"%s\"\nversion=\"%s\"\ndisplayName=\"%s\"\n", modID, version, modID)
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func sha256Hex(b []byte) string {
	s := sha256.Sum256(b)
	return hex.EncodeToString(s[:])
}

// writePack writes a packwiz pack into dir. Mod downloads point at cdn, plain
// jars are stored in the pack's own mods/ folder.
func writePack(t *testing.T, dir, version, cdn string, mods []packMod, plain map[string][]byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(dir, "mods"), 0o755); err != nil {
		t.Fatal(err)
	}
	var index strings.Builder
	index.WriteString("hash-format = \"sha256\"\n")
	add := func(rel string, data []byte, meta bool) {
		if err := os.WriteFile(filepath.Join(dir, filepath.FromSlash(rel)), data, 0o644); err != nil {
			t.Fatal(err)
		}
		fmt.Fprintf(&index, "\n[[files]]\nfile = %q\nhash = %q\n", rel, sha256Hex(data))
		if meta {
			index.WriteString("metafile = true\n")
		}
	}
	for _, m := range mods {
		var b strings.Builder
		fmt.Fprintf(&b, "name = %q\nfilename = %q\n", m.key, m.file)
		if m.side != "" {
			fmt.Fprintf(&b, "side = %q\n", m.side)
		}
		if m.curseforge {
			sum := sha1.Sum(m.jar) //nolint:gosec // fixture
			fmt.Fprintf(&b, "\n[download]\nhash-format = \"sha1\"\nhash = %q\nmode = \"metadata:curseforge\"\n", hex.EncodeToString(sum[:]))
		} else {
			fmt.Fprintf(&b, "\n[download]\nurl = %q\nhash-format = \"sha512\"\nhash = %q\n", cdn+"/"+m.file, hashOf(m.jar))
		}
		if m.projectID != "" {
			fmt.Fprintf(&b, "\n[update]\n[update.modrinth]\nmod-id = %q\nversion = \"v-%s\"\n", m.projectID, m.file)
		}
		add("mods/"+m.key+".pw.toml", []byte(b.String()), true)
	}
	for name, data := range plain {
		add("mods/"+name, data, false)
	}
	// A config, which a server sync leaves alone.
	add("options.txt", []byte("fov:70\n"), false)
	idx := []byte(index.String())
	if err := os.WriteFile(filepath.Join(dir, "index.toml"), idx, 0o644); err != nil {
		t.Fatal(err)
	}
	packToml := fmt.Sprintf("name = \"Test Pack\"\nversion = %q\npack-format = \"packwiz:1.1.0\"\n\n[index]\nfile = \"index.toml\"\nhash-format = \"sha256\"\nhash = %q\n\n[versions]\nminecraft = \"1.21.1\"\nneoforge = \"21.1.252\"\n", version, sha256Hex(idx))
	if err := os.WriteFile(filepath.Join(dir, "pack.toml"), []byte(packToml), 0o644); err != nil {
		t.Fatal(err)
	}
}

// cdnFor serves every mod's jar by file name over TLS.
func cdnFor(t *testing.T, mods ...packMod) *httptest.Server {
	t.Helper()
	files := map[string][]byte{}
	for _, m := range mods {
		files["/"+m.file] = m.jar
	}
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, ok := files[r.URL.Path]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if _, err := w.Write(data); err != nil {
			t.Errorf("serve: %v", err)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

// newSyncFixture is a NeoForge server bound to a folder pack.
func newSyncFixture(t *testing.T, loaderVersion string) (*ModService, string, string) {
	t.Helper()
	dataDir := t.TempDir()
	workDir := filepath.Join(t.TempDir(), "server")
	if err := os.MkdirAll(filepath.Join(workDir, "mods"), 0o755); err != nil {
		t.Fatal(err)
	}
	cfgSvc := NewConfigService()
	cfgSvc.SetDataDir(dataDir)
	if err := cfgSvc.SaveServerConfig(models.ServerConfig{
		ID: testServerID, Name: "Test", WorkingDir: workDir,
		Loader: "neoforge", MCVersion: "1.21.1", LoaderVersion: loaderVersion,
	}); err != nil {
		t.Fatal(err)
	}
	s := NewModService(cfgSvc, nil)
	s.SetDataDir(dataDir)
	s.SetBus(NewEventBus())
	s.SetContext(context.Background())
	s.provider = &fakeModProvider{byHash: map[string]models.ModVersion{}}
	packDir := filepath.Join(t.TempDir(), "pack")
	return s, workDir, packDir
}

func bindFolder(t *testing.T, s *ModService, packDir string, exclude, include []string) {
	t.Helper()
	if err := s.SetPackSource(models.PackSource{
		ServerID: testServerID, Location: "folder", Address: packDir,
		Exclude: exclude, Include: include,
	}); err != nil {
		t.Fatalf("SetPackSource: %v", err)
	}
}

func rowFor(p models.ModSyncPlan, file string) models.ModSyncRow {
	for _, r := range p.Rows {
		if r.FileName == file {
			return r
		}
	}
	return models.ModSyncRow{}
}

func modsOnDisk(t *testing.T, workDir string) []string {
	t.Helper()
	entries, err := os.ReadDir(filepath.Join(workDir, "mods"))
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, e := range entries {
		out = append(out, e.Name())
	}
	slices.Sort(out)
	return out
}

func mustPlan(t *testing.T, s *ModService) models.ModSyncPlan {
	t.Helper()
	p, err := s.PlanModSync(testServerID)
	if err != nil {
		t.Fatalf("PlanModSync: %v", err)
	}
	return p
}

func mustApply(t *testing.T, s *ModService, p models.ModSyncPlan) models.ModSyncPlan {
	t.Helper()
	out, err := s.ApplyModSync(testServerID, p.PlanID)
	if err != nil {
		t.Fatalf("ApplyModSync: %v (blockers %v)", err, p.Blockers)
	}
	return out
}

// --- Tests ---

// The first sync on a server set up by hand downloads nothing it already has:
// a jar with the pack's exact bytes is adopted, whatever its name, and a mod
// the pack does not list stays where it is.
func TestModSyncFirstSyncAdoptsMatchingJars(t *testing.T) {
	s, workDir, packDir := newSyncFixture(t, "21.1.252")
	create := packMod{key: "create", file: "create-6.0.10.jar", jar: neoJar(t, "create", "6.0.10"), projectID: "LNytGWDc"}
	lib := packMod{key: "lib", file: "lib-1.0.jar", jar: neoJar(t, "lib", "1.0")}
	cdn := cdnFor(t, create, lib)
	allowDownloads(s, cdn)
	writePack(t, packDir, "1.0.0", cdn.URL, []packMod{create, lib}, nil)
	bindFolder(t, s, packDir, nil, nil)

	mods := filepath.Join(workDir, "mods")
	if err := os.WriteFile(filepath.Join(mods, "Create Renamed.jar"), create.jar, 0o644); err != nil {
		t.Fatal(err)
	}
	writeJar(t, filepath.Join(mods, "bluemap.jar"), map[string]string{"META-INF/neoforge.mods.toml": "[[mods]]\nmodId=\"bluemap\"\n"})

	p := mustPlan(t, s)
	if got := rowFor(p, "create-6.0.10.jar"); got.Action != "adopt" || got.From != "Create Renamed.jar" {
		t.Fatalf("create row = %+v, want adopt from the renamed jar", got)
	}
	if got := rowFor(p, "lib-1.0.jar").Action; got != "add" {
		t.Fatalf("lib action = %q, want add", got)
	}
	mustApply(t, s, p)

	want := []string{"Create Renamed.jar", "bluemap.jar", "lib-1.0.jar"}
	if got := modsOnDisk(t, workDir); !slices.Equal(got, want) {
		t.Fatalf("mods/ = %v, want %v", got, want)
	}
	again := mustPlan(t, s)
	if !again.UpToDate || again.Kept != 2 || again.Adopted != 0 {
		t.Fatalf("second plan = up to date %v, kept %d, adopted %d; want true, 2, 0", again.UpToDate, again.Kept, again.Adopted)
	}
	installed := installedByFile(t, s)
	if !installed["lib-1.0.jar"].Pack || installed["bluemap.jar"].Pack {
		t.Fatalf("ownership: lib %v, bluemap %v; want true, false", installed["lib-1.0.jar"].Pack, installed["bluemap.jar"].Pack)
	}
}

// The pack's client side keeps a mod off the server: present and enabled it is
// disabled, absent it is skipped, and the server's include list overrides it.
func TestModSyncHonoursClientSideAndServerLists(t *testing.T) {
	s, workDir, packDir := newSyncFixture(t, "21.1.252")
	shaders := packMod{key: "iris", file: "iris.jar", side: "client", jar: neoJar(t, "iris", "1")}
	tones := packMod{key: "tones", file: "tones.jar", side: "client", jar: neoJar(t, "tones", "1")}
	wanted := packMod{key: "jade", file: "jade.jar", side: "client", jar: neoJar(t, "jade", "1")}
	fancy := packMod{key: "fancymenu", file: "fancymenu.jar", jar: neoJar(t, "fancymenu", "1")}
	cdn := cdnFor(t, shaders, tones, wanted, fancy)
	allowDownloads(s, cdn)
	writePack(t, packDir, "1.0.0", cdn.URL, []packMod{shaders, tones, wanted, fancy}, nil)
	bindFolder(t, s, packDir, []string{"fancymenu"}, []string{"jade"})
	if err := os.WriteFile(filepath.Join(workDir, "mods", "tones.jar"), tones.jar, 0o644); err != nil {
		t.Fatal(err)
	}

	p := mustPlan(t, s)
	for file, want := range map[string]string{"iris.jar": "skip", "tones.jar": "disable", "jade.jar": "add", "fancymenu.jar": "skip"} {
		if got := rowFor(p, file).Action; got != want {
			t.Errorf("%s: action %q, want %q", file, got, want)
		}
	}
	mustApply(t, s, p)
	want := []string{"jade.jar", "tones.jar.disabled"}
	if got := modsOnDisk(t, workDir); !slices.Equal(got, want) {
		t.Fatalf("mods/ = %v, want %v", got, want)
	}
}

// A new pack version replaces the file the pack installed, removes what it
// dropped, leaves a hand-added mod alone, and rolls back to the folder before.
func TestModSyncUpdatesRemovesAndRollsBack(t *testing.T) {
	s, workDir, packDir := newSyncFixture(t, "21.1.252")
	v1 := packMod{key: "create", file: "create-1.jar", jar: neoJar(t, "create", "1"), projectID: "P"}
	old := packMod{key: "old", file: "old.jar", jar: neoJar(t, "old", "1")}
	v2 := packMod{key: "create", file: "create-2.jar", jar: neoJar(t, "create", "2"), projectID: "P"}
	cdn := cdnFor(t, v1, old, v2)
	allowDownloads(s, cdn)
	writePack(t, packDir, "1.0.0", cdn.URL, []packMod{v1, old}, nil)
	bindFolder(t, s, packDir, nil, nil)
	mustApply(t, s, mustPlan(t, s))
	if err := os.WriteFile(filepath.Join(workDir, "mods", "mine.jar"), neoJar(t, "mine", "1"), 0o644); err != nil {
		t.Fatal(err)
	}
	before := modsOnDisk(t, workDir)

	if err := os.RemoveAll(packDir); err != nil {
		t.Fatal(err)
	}
	writePack(t, packDir, "1.1.0", cdn.URL, []packMod{v2}, nil)
	p := mustPlan(t, s)
	if r := rowFor(p, "create-2.jar"); r.Action != "update" || r.From != "create-1.jar" {
		t.Fatalf("create row = %+v, want update from create-1.jar", r)
	}
	if r := rowFor(p, "old.jar"); r.Action != "remove" {
		t.Fatalf("old row = %+v, want remove", r)
	}
	mustApply(t, s, p)
	if got, want := modsOnDisk(t, workDir), []string{"create-2.jar", "mine.jar"}; !slices.Equal(got, want) {
		t.Fatalf("after update mods/ = %v, want %v", got, want)
	}

	rec, err := s.RollbackModSync(testServerID)
	if err != nil {
		t.Fatalf("RollbackModSync: %v", err)
	}
	if rec.PackVersion != "1.1.0" || !rec.RolledBack {
		t.Fatalf("rolled back %+v, want 1.1.0 marked rolled back", rec)
	}
	if got := modsOnDisk(t, workDir); !slices.Equal(got, before) {
		t.Fatalf("after rollback mods/ = %v, want %v", got, before)
	}
	if !installedByFile(t, s)["create-1.jar"].Pack {
		t.Fatal("rollback did not restore the manifest's ownership of create-1.jar")
	}
}

// A copy of the same mod that came from elsewhere is replaced by the pack's
// version, found by its mod id after the download, not left beside it.
func TestModSyncReplacesAnUnmanagedCopyByModID(t *testing.T) {
	s, workDir, packDir := newSyncFixture(t, "21.1.252")
	pack := packMod{key: "snassets", file: "snassets-1.0.1.jar", jar: neoJar(t, "snassets", "1.0.1")}
	cdn := cdnFor(t, pack)
	allowDownloads(s, cdn)
	writePack(t, packDir, "1.0.0", cdn.URL, []packMod{pack}, nil)
	bindFolder(t, s, packDir, nil, nil)
	if err := os.WriteFile(filepath.Join(workDir, "mods", "snassets-1.0.2.jar"), neoJar(t, "snassets", "1.0.2"), 0o644); err != nil {
		t.Fatal(err)
	}
	p := mustPlan(t, s)
	if r := rowFor(p, "snassets-1.0.1.jar"); r.Action != "update" || r.From != "snassets-1.0.2.jar" {
		t.Fatalf("row = %+v, want update from snassets-1.0.2.jar", r)
	}
}

// A pack built for another loader build is refused before anything moves.
func TestModSyncRefusesALoaderVersionMismatch(t *testing.T) {
	s, workDir, packDir := newSyncFixture(t, "21.1.249")
	m := packMod{key: "a", file: "a.jar", jar: neoJar(t, "a", "1")}
	cdn := cdnFor(t, m)
	allowDownloads(s, cdn)
	writePack(t, packDir, "1.0.0", cdn.URL, []packMod{m}, nil)
	bindFolder(t, s, packDir, nil, nil)
	p := mustPlan(t, s)
	if len(p.Blockers) == 0 || !strings.Contains(p.Blockers[0], "21.1.252") {
		t.Fatalf("blockers = %v, want the loader mismatch", p.Blockers)
	}
	if _, err := s.ApplyModSync(testServerID, p.PlanID); err == nil {
		t.Fatal("ApplyModSync applied a blocked plan")
	}
	if got := modsOnDisk(t, workDir); len(got) != 0 {
		t.Fatalf("mods/ = %v, want it untouched", got)
	}
}

// A CurseForge entry with no direct link blocks the plan, unless the server
// already has its exact bytes, which is then adopted with no download.
func TestModSyncCurseForgeEntryNeedsALocalCopy(t *testing.T) {
	s, workDir, packDir := newSyncFixture(t, "21.1.252")
	cf := packMod{key: "propulsion", file: "createpropulsion-1.1.3.jar", jar: neoJar(t, "createpropulsion", "1.1.3"), curseforge: true}
	writePack(t, packDir, "1.0.0", "https://unused.invalid", []packMod{cf}, nil)
	bindFolder(t, s, packDir, nil, nil)
	if r := rowFor(mustPlan(t, s), cf.file); r.Action != "blocked" {
		t.Fatalf("without a local copy: %+v, want blocked", r)
	}
	if err := os.WriteFile(filepath.Join(workDir, "mods", cf.file), cf.jar, 0o644); err != nil {
		t.Fatal(err)
	}
	p := mustPlan(t, s)
	if r := rowFor(p, cf.file); r.Action != "adopt" || len(p.Blockers) != 0 {
		t.Fatalf("with a local copy: %+v, blockers %v; want adopt and none", r, p.Blockers)
	}
}

// A first-party jar the pack stores itself is copied from the pack folder.
func TestModSyncInstallsAPlainJarFromThePack(t *testing.T) {
	s, workDir, packDir := newSyncFixture(t, "21.1.252")
	jar := neoJar(t, "frangfurd_fixed", "0.7.0")
	writePack(t, packDir, "1.0.0", "https://unused.invalid", nil, map[string][]byte{"frangfurd_fixed-0.7.0.jar": jar})
	bindFolder(t, s, packDir, nil, nil)
	if err := os.WriteFile(filepath.Join(workDir, "mods", "frangfurd_fixed-0.5.0.jar"), neoJar(t, "frangfurd_fixed", "0.5.0"), 0o644); err != nil {
		t.Fatal(err)
	}
	p := mustPlan(t, s)
	if r := rowFor(p, "frangfurd_fixed-0.7.0.jar"); r.Action != "update" || r.From != "frangfurd_fixed-0.5.0.jar" {
		t.Fatalf("row = %+v, want update from 0.5.0", r)
	}
	mustApply(t, s, p)
	if got, want := modsOnDisk(t, workDir), []string{"frangfurd_fixed-0.7.0.jar"}; !slices.Equal(got, want) {
		t.Fatalf("mods/ = %v, want %v", got, want)
	}
}

// Apply refuses a plan the folder has moved on from since it was shown.
func TestModSyncApplyRefusesAStalePlan(t *testing.T) {
	s, workDir, packDir := newSyncFixture(t, "21.1.252")
	m := packMod{key: "a", file: "a.jar", jar: neoJar(t, "a", "1")}
	cdn := cdnFor(t, m)
	allowDownloads(s, cdn)
	writePack(t, packDir, "1.0.0", cdn.URL, []packMod{m}, nil)
	bindFolder(t, s, packDir, nil, nil)
	p := mustPlan(t, s)
	if err := os.WriteFile(filepath.Join(workDir, "mods", "a.jar"), m.jar, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ApplyModSync(testServerID, p.PlanID); err == nil || !strings.Contains(err.Error(), "changed") {
		t.Fatalf("ApplyModSync error = %v, want the stale-plan refusal", err)
	}
}

// Modrinth's opinion of a "both" mod is a note, never a change of action.
func TestModSyncNotesWhatModrinthCallsClientOnly(t *testing.T) {
	s, _, packDir := newSyncFixture(t, "21.1.252")
	m := packMod{key: "melody", file: "melody.jar", jar: neoJar(t, "melody", "1")}
	cdn := cdnFor(t, m)
	allowDownloads(s, cdn)
	s.provider = &fakeModProvider{byHash: map[string]models.ModVersion{hashOf(m.jar): {ID: "v", ClientOnly: true}}}
	writePack(t, packDir, "1.0.0", cdn.URL, []packMod{m}, nil)
	bindFolder(t, s, packDir, nil, nil)
	r := rowFor(mustPlan(t, s), "melody.jar")
	if r.Action != "add" || !strings.Contains(r.Note, "client only") {
		t.Fatalf("row = %+v, want add with a client-only note", r)
	}
}

// A pack served over https is read through its index, and an index that does
// not match pack.toml's hash is refused.
func TestModSyncURLSourceChecksTheIndexHash(t *testing.T) {
	s, workDir, packDir := newSyncFixture(t, "21.1.252")
	m := packMod{key: "a", file: "a.jar", jar: neoJar(t, "a", "1")}
	writePack(t, packDir, "1.0.0", "PLACEHOLDER", []packMod{m}, nil)
	tamper := false
	host := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/a.jar" {
			w.Write(m.jar) //nolint:errcheck // test server
			return
		}
		data, err := os.ReadFile(filepath.Join(packDir, filepath.FromSlash(strings.TrimPrefix(r.URL.Path, "/pack/"))))
		if err != nil {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if tamper && strings.HasSuffix(r.URL.Path, "index.toml") {
			data = append(data, '\n')
		}
		w.Write(data) //nolint:errcheck // test server
	}))
	t.Cleanup(host.Close)
	// Point the metafile at the server just started, then rewrite the pack.
	writePack(t, packDir, "1.0.0", host.URL, []packMod{m}, nil)
	s.downloads = downloadPolicy{hosts: nil, client: host.Client()}
	if err := s.SetPackSource(models.PackSource{ServerID: testServerID, Location: "url", Address: host.URL + "/pack/pack.toml"}); err != nil {
		t.Fatalf("SetPackSource: %v", err)
	}
	p := mustPlan(t, s)
	if r := rowFor(p, "a.jar"); r.Action != "add" {
		t.Fatalf("row = %+v, want add", r)
	}
	mustApply(t, s, p)
	if got := modsOnDisk(t, workDir); !slices.Equal(got, []string{"a.jar"}) {
		t.Fatalf("mods/ = %v", got)
	}
	tamper = true
	if _, err := s.PlanModSync(testServerID); err == nil || !strings.Contains(err.Error(), "mismatch") {
		t.Fatalf("PlanModSync with a tampered index: %v, want a hash mismatch", err)
	}
}

func TestCleanPackPathRefusesEscapes(t *testing.T) {
	for _, p := range []string{"", "..", "../x", "a/../../x", "/etc/passwd", `mods\x.jar`, "C:/x"} {
		if _, err := cleanPackPath(p); err == nil {
			t.Errorf("cleanPackPath(%q) accepted", p)
		}
	}
	for _, p := range []string{"mods/a.jar", "./mods/a.jar", "config/x/y.toml"} {
		if _, err := cleanPackPath(p); err != nil {
			t.Errorf("cleanPackPath(%q): %v", p, err)
		}
	}
}

func TestParsePackURL(t *testing.T) {
	for _, tc := range []struct {
		in string
		ok bool
	}{
		{"https://packs.example/frangfurd/pack.toml", true},
		{"http://localhost:8080/pack.toml", true},
		{"http://127.0.0.1:8080/pack.toml", true},
		{"http://packs.example/pack.toml", false},
		{"https://packs.example/frangfurd/", false},
		{"https://user:pw@packs.example/pack.toml", false},
		{"file:///tmp/pack.toml", false},
	} {
		_, err := parsePackURL(tc.in)
		if (err == nil) != tc.ok {
			t.Errorf("parsePackURL(%q) error = %v, want ok=%v", tc.in, err, tc.ok)
		}
	}
}

// A folder source must hold a pack, and a plugin server has no pack to follow.
func TestSetPackSourceChecksTheAddress(t *testing.T) {
	s, _, packDir := newSyncFixture(t, "21.1.252")
	if err := s.SetPackSource(models.PackSource{ServerID: testServerID, Location: "folder", Address: packDir}); err == nil {
		t.Fatal("accepted a folder with no pack.toml")
	}
	if err := s.SetPackSource(models.PackSource{ServerID: testServerID, Location: "folder", Address: "relative/pack"}); err == nil {
		t.Fatal("accepted a relative folder")
	}
	if err := s.SetPackSource(models.PackSource{ServerID: testServerID, Location: "ftp", Address: "x"}); err == nil {
		t.Fatal("accepted an unknown location")
	}
}
