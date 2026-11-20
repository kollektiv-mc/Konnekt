package services

import (
	"context"
	"crypto/sha1" //nolint:gosec // CurseForge's own digest, under test
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"konnekt/backend/models"
)

const testCurseForgeKey = "test-key-123"

// newCurseForgeTestClient points a client at ts with a fixed key.
func newCurseForgeTestClient(ts *httptest.Server, key string) *CurseForgeClient {
	return &CurseForgeClient{http: ts.Client(), baseURL: ts.URL, key: func() string { return key }}
}

// cfServer answers each path from routes, keyed by path without the query,
// and fails the test on a request without the key or on an unknown path.
func cfServer(t *testing.T, routes map[string]any) (*httptest.Server, *[]*http.Request) {
	t.Helper()
	var seen []*http.Request
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r)
		if got := r.Header.Get("x-api-key"); got != testCurseForgeKey {
			t.Errorf("%s sent x-api-key %q, want the configured key", r.URL.Path, got)
		}
		body, ok := routes[r.Method+" "+r.URL.Path]
		if !ok {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.String())
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if err := json.NewEncoder(w).Encode(body); err != nil {
			t.Errorf("encode %s: %v", r.URL.Path, err)
		}
	}))
	t.Cleanup(ts.Close)
	return ts, &seen
}

func boolPtr(b bool) *bool { return &b }

func cfModJSON(id int, name string, allow *bool) map[string]any {
	m := map[string]any{
		"id":            id,
		"name":          name,
		"slug":          strings.ToLower(name),
		"summary":       name + " summary",
		"links":         map[string]any{"websiteUrl": "https://www.curseforge.com/minecraft/mc-mods/" + strings.ToLower(name)},
		"downloadCount": 1234,
		"thumbsUpCount": 5,
		"dateModified":  "2026-10-01T00:00:00Z",
		"classId":       6,
		"categories":    []any{map[string]any{"id": 412, "name": "Technology", "classId": 6}},
		"authors":       []any{map[string]any{"name": "someone"}},
		"logo":          map[string]any{"thumbnailUrl": "https://media.forgecdn.net/thumb.png"},
	}
	if allow != nil {
		m["allowModDistribution"] = *allow
	}
	return m
}

func TestCurseForgeSearchSendsFiltersAndMapsHits(t *testing.T) {
	ts, seen := cfServer(t, map[string]any{
		"GET /v1/categories": map[string]any{"data": []any{
			map[string]any{"id": 412, "name": "Technology", "classId": 6},
			map[string]any{"id": 6, "name": "Mods", "classId": 6, "isClass": true},
		}},
		"GET /v1/mods/search": map[string]any{
			"data": []any{
				cfModJSON(1, "Create", nil),
				cfModJSON(2, "Locked", boolPtr(false)),
			},
			"pagination": map[string]any{"index": 20, "totalCount": 50000},
		},
	})
	c := newCurseForgeTestClient(ts, testCurseForgeKey)

	q := models.ModSearchQuery{Query: "create", Offset: 20, Categories: []string{"Technology"}, Sort: "downloads"}
	res, err := c.Search(context.Background(), q, "1.21.1", "neoforge")
	if err != nil {
		t.Fatalf("Search: %v", err)
	}

	var search *http.Request
	for _, r := range *seen {
		if r.URL.Path == "/v1/mods/search" {
			search = r
		}
	}
	if search == nil {
		t.Fatal("no search request was sent")
	}
	want := map[string]string{
		"gameId": "432", "classId": "6", "searchFilter": "create", "gameVersion": "1.21.1",
		"modLoaderType": "6", "sortField": "6", "sortOrder": "desc", "index": "20",
		"pageSize": "20", "categoryIds": "[412]",
	}
	for k, v := range want {
		if got := search.URL.Query().Get(k); got != v {
			t.Errorf("search %s = %q, want %q", k, got, v)
		}
	}

	if res.Total != curseForgeMaxWindow {
		t.Errorf("Total = %d, want it capped at the API's %d window", res.Total, curseForgeMaxWindow)
	}
	if len(res.Hits) != 2 {
		t.Fatalf("hits = %d, want 2", len(res.Hits))
	}
	h := res.Hits[0]
	if h.ID != "cf:1" || h.Source != "curseforge" || h.Title != "Create" || h.Author != "someone" ||
		h.IconURL == "" || h.PageURL == "" || h.ManualDownload {
		t.Errorf("first hit = %+v", h)
	}
	if !res.Hits[1].ManualDownload {
		t.Error("a mod with allowModDistribution false is not marked as a manual download")
	}
}

func TestCurseForgeWithoutAKeySendsNothing(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Error("a request was sent with no key configured")
	}))
	defer ts.Close()
	c := newCurseForgeTestClient(ts, "")

	_, err := c.Search(context.Background(), models.ModSearchQuery{}, "1.21.1", "fabric")
	if !errors.Is(err, ErrCurseForgeNoKey) {
		t.Fatalf("Search error = %v, want ErrCurseForgeNoKey", err)
	}
}

func TestCurseForgeRefusedKeySaysSo(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer ts.Close()

	err := newCurseForgeTestClient(ts, "x").CheckKey(context.Background(), "wrong")
	if err == nil || !strings.Contains(err.Error(), "API key was refused") {
		t.Fatalf("CheckKey error = %v, want the refused-key message", err)
	}
}

func cfFileJSON(id int, date, url string, gameVersions ...string) map[string]any {
	return map[string]any{
		"id": id, "modId": 1, "isAvailable": true, "displayName": "create-" + date,
		"fileName": "create-" + date + ".jar", "releaseType": 1, "fileDate": date,
		"fileLength": 100, "downloadUrl": url, "gameVersions": gameVersions,
		"hashes": []any{
			map[string]any{"value": "ABCDEF0123456789ABCDEF0123456789ABCDEF01", "algo": 1},
			map[string]any{"value": "md5md5", "algo": 2},
		},
		"dependencies": []any{
			map[string]any{"modId": 7, "relationType": 3},
			map[string]any{"modId": 8, "relationType": 4},
		},
	}
}

func TestCurseForgeVersionsAreNewestFirstAndMapped(t *testing.T) {
	serverPack := cfFileJSON(13, "2026-10-03T00:00:00Z", "https://edge.forgecdn.net/files/13/server.zip", "1.21.1")
	serverPack["isServerPack"] = true
	noURL := cfFileJSON(14, "2026-10-04T00:00:00Z", "", "1.21.1", "NeoForge")
	ts, _ := cfServer(t, map[string]any{
		"GET /v1/mods/1": map[string]any{"data": cfModJSON(1, "Create", boolPtr(true))},
		"GET /v1/mods/1/files": map[string]any{
			"data": []any{
				cfFileJSON(11, "2026-10-01T00:00:00Z", "https://edge.forgecdn.net/files/11/a.jar", "1.21.1", "NeoForge", "Server", "Client"),
				cfFileJSON(12, "2026-10-02T00:00:00Z", "https://edge.forgecdn.net/files/12/b.jar", "1.21.1", "NeoForge", "Client"),
				serverPack,
				noURL,
			},
			"pagination": map[string]any{"totalCount": 4},
		},
	})
	c := newCurseForgeTestClient(ts, testCurseForgeKey)

	got, err := c.GetVersions(context.Background(), "cf:1", "1.21.1", "neoforge")
	if err != nil {
		t.Fatalf("GetVersions: %v", err)
	}
	ids := make([]string, len(got))
	for i, v := range got {
		ids[i] = v.ID
	}
	if strings.Join(ids, ",") != "cf:14,cf:12,cf:11" {
		t.Fatalf("versions = %v, want newest first without the server pack", ids)
	}

	manual := got[0]
	if manual.FileURL != "" || manual.PageURL != "https://www.curseforge.com/minecraft/mc-mods/create/files/14" {
		t.Errorf("file with no downloadUrl = FileURL %q PageURL %q, want only the page", manual.FileURL, manual.PageURL)
	}

	b := got[1]
	if !b.ClientOnly {
		t.Error("a file tagged Client and not Server is not client-only")
	}
	if got[2].ClientOnly {
		t.Error("a file tagged both Client and Server is client-only")
	}
	if b.SHA1 != "abcdef0123456789abcdef0123456789abcdef01" {
		t.Errorf("SHA1 = %q, want the algo-1 hash, lower-cased", b.SHA1)
	}
	if strings.Join(b.Loaders, ",") != "neoforge" || strings.Join(b.GameVersions, ",") != "1.21.1" {
		t.Errorf("loaders %v, game versions %v", b.Loaders, b.GameVersions)
	}
	if len(b.Dependencies) != 1 || b.Dependencies[0].ProjectID != "cf:7" || b.Dependencies[0].DependencyType != "required" {
		t.Errorf("dependencies = %+v, want only the required one, a Tool is not a mod", b.Dependencies)
	}
}

// An author's opt-out wins even over a file that still carries a URL.
func TestCurseForgeOptedOutModIsNeverDownloadable(t *testing.T) {
	ts, _ := cfServer(t, map[string]any{
		"POST /v1/mods/files": map[string]any{"data": []any{
			cfFileJSON(11, "2026-10-01T00:00:00Z", "https://edge.forgecdn.net/files/11/a.jar", "1.21.1"),
		}},
		"GET /v1/mods/1": map[string]any{"data": cfModJSON(1, "Create", boolPtr(false))},
	})
	v, err := newCurseForgeTestClient(ts, testCurseForgeKey).GetVersion(context.Background(), "cf:11")
	if err != nil {
		t.Fatalf("GetVersion: %v", err)
	}
	if v.FileURL != "" || v.PageURL == "" {
		t.Errorf("opted-out file = FileURL %q PageURL %q, want only the page", v.FileURL, v.PageURL)
	}
}

func TestCurseForgeResolvesDependencyByMod(t *testing.T) {
	dep := cfFileJSON(21, "2026-10-05T00:00:00Z", "", "1.21.1")
	dep["modId"] = 7
	dep["dependencies"] = []any{}
	ts, _ := cfServer(t, map[string]any{
		"POST /v1/mods/files": map[string]any{"data": []any{
			cfFileJSON(11, "2026-10-01T00:00:00Z", "https://edge.forgecdn.net/files/11/a.jar", "1.21.1"),
		}},
		"GET /v1/mods/1":       map[string]any{"data": cfModJSON(1, "Create", nil)},
		"GET /v1/mods/7":       map[string]any{"data": cfModJSON(7, "Flywheel", boolPtr(false))},
		"GET /v1/mods/7/files": map[string]any{"data": []any{dep}, "pagination": map[string]any{"totalCount": 1}},
	})
	c := newCurseForgeTestClient(ts, testCurseForgeKey)

	deps, err := c.ResolveDependencies(context.Background(), "cf:11", "1.21.1", "neoforge", map[string]bool{})
	if err != nil {
		t.Fatalf("ResolveDependencies: %v", err)
	}
	if len(deps) != 1 {
		t.Fatalf("deps = %+v, want Flywheel", deps)
	}
	d := deps[0]
	if d.ProjectID != "cf:7" || d.ProjectTitle != "Flywheel" || !d.Required {
		t.Errorf("dep = %+v", d)
	}
	if d.Version.FileURL != "" || d.Version.PageURL == "" {
		t.Error("an opted-out dependency is offered as an install rather than as a page to visit")
	}
}

func TestCurseForgeNativeIDRefusesForeignIDs(t *testing.T) {
	for _, tc := range []struct {
		id string
		ok bool
	}{
		{"cf:123", true},
		{"123", false},
		{"cf:", false},
		{"cf:12/../34", false},
		{"cf:-1", false},
		{"AABBCCDD", false},
	} {
		_, err := curseForgeNativeID(tc.id)
		if (err == nil) != tc.ok {
			t.Errorf("curseForgeNativeID(%q) error = %v, want ok=%v", tc.id, err, tc.ok)
		}
	}
}

func TestDedentHTMLKeepsPreformattedText(t *testing.T) {
	if got := dedentHTML("<p>a</p>\n\n    <p>b</p>"); got != "<p>a</p>\n\n<p>b</p>" {
		t.Errorf("dedentHTML = %q, want the indentation gone", got)
	}
	in := "<pre>\n    code\n</pre>"
	if got := dedentHTML(in); got != in {
		t.Errorf("dedentHTML touched a <pre>: %q", got)
	}
}

// --- ModService with CurseForge ---

func sha1Of(b []byte) string {
	sum := sha1.Sum(b) //nolint:gosec // CurseForge's own digest, under test
	return hex.EncodeToString(sum[:])
}

// cfFixture is a ModService whose CurseForge provider is a fake and whose
// CurseForge download policy points at files, which also records the key the
// download carried.
func cfFixture(t *testing.T, jar []byte, version models.ModVersion) (*ModService, string, *string) {
	t.Helper()
	var sentKey string
	files := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sentKey = r.Header.Get("x-api-key")
		if _, err := w.Write(jar); err != nil {
			t.Errorf("serve jar: %v", err)
		}
	}))
	t.Cleanup(files.Close)
	version.FileURL = strings.Replace(version.FileURL, "https://edge.forgecdn.net", files.URL, 1)

	s, workDir := newModFixture(t, &fakeModProvider{})
	s.curseforge = &fakeModProvider{
		id:       "curseforge",
		versions: map[string]models.ModVersion{version.ID: version},
		projects: map[string]models.ModProject{version.ProjectID: {ID: version.ProjectID, Title: "Create"}},
	}
	allowDownloads(s, files)
	s.cfDownloads = s.downloads
	s.cfDownloads.header = func(h http.Header) { h.Set("x-api-key", testCurseForgeKey) }
	return s, workDir, &sentKey
}

func TestInstallFromCurseForgeVerifiesSHA1AndSendsTheKey(t *testing.T) {
	jar := pluginJarBytes(t, "Create", "6.0.0")
	s, workDir, sentKey := cfFixture(t, jar, models.ModVersion{
		ID: "cf:11", ProjectID: "cf:1", VersionNumber: "create-6.0.0", FileName: "create-6.0.0.jar",
		FileURL: "https://edge.forgecdn.net/files/11/create.jar", SHA1: sha1Of(jar),
	})

	if err := s.Install(testServerID, []string{"cf:11"}); err != nil {
		t.Fatalf("Install: %v", err)
	}
	if *sentKey != testCurseForgeKey {
		t.Errorf("CDN download carried x-api-key %q, want the key", *sentKey)
	}
	if _, err := os.Stat(filepath.Join(workDir, "plugins", "create-6.0.0.jar")); err != nil {
		t.Fatalf("jar not installed: %v", err)
	}
	mod := installedByFile(t, s)["create-6.0.0.jar"]
	if mod.Source != "curseforge" || mod.Provider != "curseforge" || mod.ProjectID != "cf:1" || mod.DisplayName != "Create" {
		t.Errorf("installed row = %+v, want a CurseForge row for Create", mod)
	}
	manifest, err := s.loadManifest(testServerID)
	if err != nil {
		t.Fatalf("loadManifest: %v", err)
	}
	if got := manifest.Items[0].SHA512; got != hashOf(jar) {
		t.Errorf("manifest SHA512 = %q, want the downloaded file's own", got)
	}
}

func TestInstallFromCurseForgeRefusesASHA1Mismatch(t *testing.T) {
	jar := pluginJarBytes(t, "Create", "6.0.0")
	s, workDir, _ := cfFixture(t, jar, models.ModVersion{
		ID: "cf:11", ProjectID: "cf:1", FileName: "create.jar",
		FileURL: "https://edge.forgecdn.net/files/11/create.jar", SHA1: sha1Of([]byte("other")),
	})
	err := s.Install(testServerID, []string{"cf:11"})
	if err == nil || !strings.Contains(err.Error(), "sha1 mismatch") {
		t.Fatalf("Install error = %v, want a sha1 mismatch", err)
	}
	entries, err := os.ReadDir(filepath.Join(workDir, "plugins"))
	if err != nil {
		t.Fatalf("read plugins: %v", err)
	}
	if len(entries) != 0 {
		t.Errorf("plugins/ holds %d files after a refused download", len(entries))
	}
}

func TestInstallOfAManualOnlyFileIsRefused(t *testing.T) {
	s, workDir, _ := cfFixture(t, nil, models.ModVersion{
		ID: "cf:11", ProjectID: "cf:1", FileName: "create.jar",
		PageURL: "https://www.curseforge.com/minecraft/mc-mods/create/files/11",
	})
	err := s.Install(testServerID, []string{"cf:11"})
	var manual *ManualDownloadError
	if !errors.As(err, &manual) || manual.PageURL == "" {
		t.Fatalf("Install error = %v, want a ManualDownloadError naming the page", err)
	}
	if entries, rerr := os.ReadDir(filepath.Join(workDir, "plugins")); rerr != nil || len(entries) != 0 {
		t.Errorf("plugins/ = %v, %v; want it untouched", entries, rerr)
	}
}

func TestModServiceRoutesIDsToTheirProvider(t *testing.T) {
	s, _ := newModFixture(t, &fakeModProvider{})
	cf := &fakeModProvider{id: "curseforge"}
	s.curseforge = cf
	if s.providerFor("cf:1") != cf || s.providerFor("AABBCCDD") == ModProvider(cf) {
		t.Error("providerFor does not route on the cf: prefix")
	}
	if _, err := s.providerNamed("spigotmc"); err == nil {
		t.Error("providerNamed accepted an unknown source")
	}
	if p, err := s.providerNamed(""); err != nil || p.ID() != "modrinth" {
		t.Errorf("providerNamed(\"\") = %v, %v; want Modrinth", p, err)
	}
}

func TestCurseForgeKeyIsCheckedSavedAndCleared(t *testing.T) {
	prev := curseForgeBuiltInKey
	curseForgeBuiltInKey = ""
	t.Cleanup(func() { curseForgeBuiltInKey = prev })

	s, _ := newModFixture(t, &fakeModProvider{})
	var checked []string
	s.checkCurseForgeKey = func(_ context.Context, key string) error {
		checked = append(checked, key)
		if key == "bad" {
			return errors.New("curseforge: the API key was refused (HTTP 403)")
		}
		return nil
	}

	if st := s.CurseForgeStatus(); st.KeySet || st.BuiltIn {
		t.Fatalf("fresh status = %+v, want nothing set", st)
	}
	if err := s.SetCurseForgeKey("has space"); err == nil {
		t.Error("a key with a space was accepted")
	}
	if err := s.SetCurseForgeKey("bad"); err == nil {
		t.Error("a key CurseForge refused was saved")
	}
	if s.CurseForgeStatus().KeySet {
		t.Error("a refused key shows as set")
	}
	if err := s.SetCurseForgeKey("  good-key  "); err != nil {
		t.Fatalf("SetCurseForgeKey: %v", err)
	}
	if strings.Join(checked, ",") != "bad,good-key" {
		t.Errorf("checked = %v, want the invalid one refused before any request", checked)
	}

	path := filepath.Join(s.dataDir, curseForgeKeyFile)
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("key file: %v", err)
	}
	// Windows has no Unix mode bits: os.Stat reports 0666 for any writable file.
	if perm := info.Mode().Perm(); runtime.GOOS != "windows" && perm&0o077 != 0 {
		t.Errorf("key file mode = %o, want owner-only", perm)
	}

	// A fresh service reads it back from disk.
	s2 := NewModService(s.cfg, nil)
	s2.SetDataDir(s.dataDir)
	if got := s2.curseForgeAPIKey(); got != "good-key" {
		t.Errorf("reloaded key = %q", got)
	}

	if err := s.ClearCurseForgeKey(); err != nil {
		t.Fatalf("ClearCurseForgeKey: %v", err)
	}
	if s.CurseForgeStatus().KeySet || s.curseForgeAPIKey() != "" {
		t.Error("the key outlived Clear")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Errorf("key file after Clear: %v", err)
	}
}

func TestCurseForgeBuiltInKeyIsTheFallback(t *testing.T) {
	prev := curseForgeBuiltInKey
	curseForgeBuiltInKey = "built-in"
	t.Cleanup(func() { curseForgeBuiltInKey = prev })

	s, _ := newModFixture(t, &fakeModProvider{})
	s.checkCurseForgeKey = func(context.Context, string) error { return nil }
	if got := s.curseForgeAPIKey(); got != "built-in" {
		t.Errorf("key with nothing saved = %q, want the built-in one", got)
	}
	if st := s.CurseForgeStatus(); !st.BuiltIn || st.KeySet {
		t.Errorf("status = %+v", st)
	}
	if err := s.SetCurseForgeKey("mine"); err != nil {
		t.Fatalf("SetCurseForgeKey: %v", err)
	}
	if got := s.curseForgeAPIKey(); got != "mine" {
		t.Errorf("key = %q, want the saved one ahead of the built-in", got)
	}
}

// The shared helper keeps the 429 back-off the Modrinth client relied on.
func TestProviderAPIRetriesATooManyRequests(t *testing.T) {
	calls := 0
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls == 1 {
			w.Header().Set("Retry-After", "0")
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		if _, err := io.WriteString(w, `{"ok":true}`); err != nil {
			t.Errorf("write: %v", err)
		}
	}))
	defer ts.Close()
	var out struct{ OK bool }
	api := providerAPI{name: "test", http: ts.Client(), baseURL: ts.URL}
	if err := api.getJSON(context.Background(), "/", &out); err != nil || !out.OK || calls != 2 {
		t.Errorf("getJSON = %v, ok %v after %d calls; want success on the retry", err, out.OK, calls)
	}
}

func TestCurseForgePageURLIsPinnedToCurseForge(t *testing.T) {
	cases := map[string]string{
		"https://www.curseforge.com/minecraft/mc-mods/create": "https://www.curseforge.com/minecraft/mc-mods/create",
		"https://curseforge.com/x":                            "https://curseforge.com/x",
		"http://www.curseforge.com/x":                         "",
		"https://evil.example/x":                              "",
		"https://curseforge.com.evil.example/x":               "",
		"https://user@www.curseforge.com/x":                   "",
		"javascript:alert(1)":                                 "",
		"":                                                    "",
	}
	for in, want := range cases {
		if got := curseForgePageURL(in); got != want {
			t.Errorf("curseForgePageURL(%q) = %q, want %q", in, got, want)
		}
	}
}
