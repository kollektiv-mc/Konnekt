package services

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha512"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"konnekt/backend/models"
)

// --- Fixtures ---

// fakeModProvider stands in for Modrinth. Only the methods the paths under test
// reach are wired; the rest satisfy the interface and are never called, which is
// itself an assertion — a test that starts hitting one has changed behaviour.
type fakeModProvider struct {
	versions map[string]models.ModVersion // versionID → version
	projects map[string]models.ModProject // projectID → project
	byHash   map[string]models.ModVersion // sha512 → version
	hashErr  error

	onGetVersion  func(versionID string)
	hashCalls     int
	getProjectHit int
}

func (f *fakeModProvider) ID() string { return "modrinth" }

func (f *fakeModProvider) GetVersion(_ context.Context, versionID string) (models.ModVersion, error) {
	if f.onGetVersion != nil {
		f.onGetVersion(versionID)
	}
	v, ok := f.versions[versionID]
	if !ok {
		return models.ModVersion{}, errors.New("no such version: " + versionID)
	}
	return v, nil
}

func (f *fakeModProvider) GetProject(_ context.Context, projectID string) (models.ModProject, error) {
	f.getProjectHit++
	p, ok := f.projects[projectID]
	if !ok {
		return models.ModProject{}, errors.New("no such project: " + projectID)
	}
	return p, nil
}

func (f *fakeModProvider) GetVersionsByHashes(_ context.Context, hashes []string) (map[string]models.ModVersion, error) {
	f.hashCalls++
	if f.hashErr != nil {
		return nil, f.hashErr
	}
	out := make(map[string]models.ModVersion)
	for _, h := range hashes {
		if v, ok := f.byHash[h]; ok {
			out[h] = v
		}
	}
	return out, nil
}

func (f *fakeModProvider) Search(context.Context, models.ModSearchQuery, string, string) (models.ModSearchResult, error) {
	return models.ModSearchResult{}, errors.New("not used in this test")
}

func (f *fakeModProvider) GetVersions(context.Context, string, string, string) ([]models.ModVersion, error) {
	return nil, errors.New("not used in this test")
}

func (f *fakeModProvider) GetAllVersions(context.Context, string) ([]models.ModVersion, error) {
	return nil, errors.New("not used in this test")
}

func (f *fakeModProvider) ResolveDependencies(context.Context, string, string, string, map[string]bool) ([]models.ResolvedDependency, error) {
	return nil, errors.New("not used in this test")
}

func (f *fakeModProvider) GetCategories(context.Context) ([]models.ModCategory, error) {
	return nil, errors.New("not used in this test")
}

func (f *fakeModProvider) GetProjectsByAuthor(context.Context, string) ([]models.ModProject, error) {
	return nil, errors.New("not used in this test")
}

// testServerID is declared once for the package, in backup_test.go.

// newModFixture wires a ModService to temp directories with one Paper server
// configured, and returns the service plus that server's working directory.
func newModFixture(t *testing.T, provider ModProvider) (*ModService, string) {
	t.Helper()
	dataDir := t.TempDir()
	workDir := filepath.Join(t.TempDir(), "server")
	if err := os.MkdirAll(filepath.Join(workDir, "plugins"), 0755); err != nil {
		t.Fatalf("create plugins dir: %v", err)
	}

	cfgSvc := NewConfigService()
	cfgSvc.SetDataDir(dataDir)
	if err := cfgSvc.SaveServerConfig(models.ServerConfig{
		ID:         testServerID,
		Name:       "Test",
		WorkingDir: workDir,
		Loader:     "paper",
		MCVersion:  "1.21.1",
	}); err != nil {
		t.Fatalf("SaveServerConfig: %v", err)
	}

	s := NewModService(cfgSvc, nil)
	s.SetDataDir(dataDir)
	s.SetBus(NewEventBus())
	s.SetContext(context.Background())
	s.provider = provider
	return s, workDir
}

// writePluginJar writes a real (tiny) plugin jar: a zip carrying a plugin.yml,
// which is what parseJarMeta reads for a Paper server. The bytes are unique per
// name, so hashes differ between fixtures the way real jars do.
func writePluginJar(t *testing.T, dir, fileName, pluginName, version string) string {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, err := zw.Create("plugin.yml")
	if err != nil {
		t.Fatalf("create plugin.yml: %v", err)
	}
	if _, err := w.Write([]byte("name: " + pluginName + "\nversion: " + version + "\nmain: com.example.Main\n")); err != nil {
		t.Fatalf("write plugin.yml: %v", err)
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}

	path := filepath.Join(dir, fileName)
	if err := os.WriteFile(path, buf.Bytes(), 0644); err != nil {
		t.Fatalf("write jar: %v", err)
	}
	return hashOf(buf.Bytes())
}

func hashOf(b []byte) string {
	sum := sha512.Sum512(b)
	return hex.EncodeToString(sum[:])
}

func installedByFile(t *testing.T, s *ModService) map[string]models.InstalledMod {
	t.Helper()
	list, err := s.ListInstalled(testServerID)
	if err != nil {
		t.Fatalf("ListInstalled: %v", err)
	}
	out := make(map[string]models.InstalledMod, len(list))
	for _, m := range list {
		out[m.FileName] = m
	}
	return out
}

// --- Install ordering (#52) ---

// The bug this pins: Install used to write the manifest once, after the loop,
// while every mod:installed subscriber answers the event by re-reading that
// file. A mod announced before its row existed came back from ListInstalled as
// an unmanaged local jar, with no icon, no project and no update check.
func TestInstallWritesManifestBeforeMovingOn(t *testing.T) {
	files := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := w.Write([]byte("jar-bytes-for" + r.URL.Path)); err != nil {
			t.Errorf("serve jar: %v", err)
		}
	}))
	defer files.Close()

	provider := &fakeModProvider{
		versions: map[string]models.ModVersion{
			"v1": {ID: "v1", ProjectID: "p1", VersionNumber: "1.0.0", FileName: "First.jar",
				FileURL: files.URL + "/first", SHA512: hashOf([]byte("jar-bytes-for/first"))},
			"v2": {ID: "v2", ProjectID: "p2", VersionNumber: "2.0.0", FileName: "Second.jar",
				FileURL: files.URL + "/second", SHA512: hashOf([]byte("jar-bytes-for/second"))},
		},
		projects: map[string]models.ModProject{
			"p1": {ID: "p1", Title: "First Plugin", IconURL: "https://example.test/first.png"},
			"p2": {ID: "p2", Title: "Second Plugin"},
		},
	}

	s, _ := newModFixture(t, provider)

	// Observed from inside the install rather than from the event: the handler
	// runs in its own goroutine, so an event-side assertion would race the very
	// write it is meant to be checking. By the time the second version is
	// fetched, the first must already be on disk *and* in the manifest.
	var firstSeen *modManifestItem
	provider.onGetVersion = func(versionID string) {
		if versionID != "v2" {
			return
		}
		manifest, err := s.loadManifest(testServerID)
		if err != nil {
			t.Errorf("loadManifest mid-install: %v", err)
			return
		}
		for i := range manifest.Items {
			if manifest.Items[i].FileName == "First.jar" {
				firstSeen = &manifest.Items[i]
			}
		}
	}

	if err := s.Install(testServerID, []string{"v1", "v2"}); err != nil {
		t.Fatalf("Install: %v", err)
	}

	if firstSeen == nil {
		t.Fatal("First.jar was announced before its manifest row was written: a refresh in that window reports it as a local jar (#52)")
	}
	if firstSeen.Source != "modrinth" || firstSeen.ProjectID != "p1" {
		t.Errorf("mid-install manifest row = %+v, want source modrinth for project p1", *firstSeen)
	}

	installed := installedByFile(t, s)
	for _, name := range []string{"First.jar", "Second.jar"} {
		mod, ok := installed[name]
		if !ok {
			t.Fatalf("%s missing from installed list", name)
		}
		if mod.Source != "modrinth" {
			t.Errorf("%s source = %q, want modrinth", name, mod.Source)
		}
	}
	if got := installed["First.jar"].DisplayName; got != "First Plugin" {
		t.Errorf("First.jar displayName = %q, want the project title", got)
	}
}

func TestInstallKeepsEarlierFilesWhenALaterOneFails(t *testing.T) {
	files := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/second" {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if _, err := w.Write([]byte("jar-bytes-for" + r.URL.Path)); err != nil {
			t.Errorf("serve jar: %v", err)
		}
	}))
	defer files.Close()

	provider := &fakeModProvider{
		versions: map[string]models.ModVersion{
			"v1": {ID: "v1", ProjectID: "p1", VersionNumber: "1.0.0", FileName: "First.jar",
				FileURL: files.URL + "/first", SHA512: hashOf([]byte("jar-bytes-for/first"))},
			"v2": {ID: "v2", ProjectID: "p2", VersionNumber: "2.0.0", FileName: "Second.jar",
				FileURL: files.URL + "/second"},
		},
		projects: map[string]models.ModProject{"p1": {ID: "p1", Title: "First Plugin"}},
	}
	s, _ := newModFixture(t, provider)

	if err := s.Install(testServerID, []string{"v1", "v2"}); err == nil {
		t.Fatal("Install: want an error when the second download fails")
	}

	// The first file is on disk. Its manifest row has to be too, or it is
	// stranded as a local jar by a failure that had nothing to do with it.
	if got := installedByFile(t, s)["First.jar"].Source; got != "modrinth" {
		t.Errorf("First.jar source after a later failure = %q, want modrinth", got)
	}
}

// --- Identification of jars Konnekt did not install ---

func TestRescanIdentifiesADroppedJar(t *testing.T) {
	provider := &fakeModProvider{
		projects: map[string]models.ModProject{
			"ess": {ID: "ess", Title: "EssentialsX", IconURL: "https://example.test/ess.png"},
		},
	}
	s, workDir := newModFixture(t, provider)

	hash := writePluginJar(t, filepath.Join(workDir, "plugins"), "EssentialsX-2.21.0.jar", "Essentials", "2.21.0")
	provider.byHash = map[string]models.ModVersion{
		hash: {ID: "ver1", ProjectID: "ess", VersionNumber: "2.21.0", FileName: "EssentialsX-2.21.0.jar"},
	}

	if err := s.Rescan(testServerID); err != nil {
		t.Fatalf("Rescan: %v", err)
	}

	mod := installedByFile(t, s)["EssentialsX-2.21.0.jar"]
	if mod.Source != "modrinth" {
		t.Errorf("source = %q, want modrinth: a jar copied into plugins/ by hand is still a Modrinth file", mod.Source)
	}
	if mod.ProjectID != "ess" || mod.VersionID != "ver1" {
		t.Errorf("projectID/versionID = %q/%q, want ess/ver1", mod.ProjectID, mod.VersionID)
	}
	if mod.DisplayName != "EssentialsX" {
		t.Errorf("displayName = %q, want the project title for a primary file", mod.DisplayName)
	}
	if mod.IconURL == "" {
		t.Error("iconUrl is empty, so the row still renders as an unidentified jar")
	}
	if mod.InstalledAt == 0 {
		t.Error("installedAt = 0, so the row sinks to the bottom of a list sorted newest-first")
	}
}

// A secondary file of a version — EssentialsX ships EssentialsXChat and the
// rest of its modules that way, which is exactly what #52 reported — gets the
// project but deliberately not the version: offering to "update" it would
// download the primary jar over a different plugin.
func TestRescanIdentifiesSecondaryFileWithoutClaimingItsVersion(t *testing.T) {
	provider := &fakeModProvider{
		projects: map[string]models.ModProject{"ess": {ID: "ess", Title: "EssentialsX", IconURL: "https://example.test/ess.png"}},
	}
	s, workDir := newModFixture(t, provider)

	hash := writePluginJar(t, filepath.Join(workDir, "plugins"), "EssentialsXChat-2.21.0.jar", "EssentialsChat", "2.21.0")
	provider.byHash = map[string]models.ModVersion{
		// The version's own file is the primary EssentialsX jar; this hash is
		// one of its extra files.
		hash: {ID: "ver1", ProjectID: "ess", VersionNumber: "2.21.0", FileName: "EssentialsX-2.21.0.jar"},
	}

	if err := s.Rescan(testServerID); err != nil {
		t.Fatalf("Rescan: %v", err)
	}

	mod := installedByFile(t, s)["EssentialsXChat-2.21.0.jar"]
	if mod.Source != "modrinth" || mod.ProjectID != "ess" {
		t.Errorf("source/projectID = %q/%q, want modrinth/ess", mod.Source, mod.ProjectID)
	}
	if mod.VersionID != "" {
		t.Errorf("versionID = %q, want empty: a secondary file is not the version, and a version switch would replace it with the primary jar", mod.VersionID)
	}
	if mod.DisplayName != "EssentialsChat" {
		t.Errorf("displayName = %q, want the jar's own name so sibling modules stay distinguishable", mod.DisplayName)
	}
	if mod.VersionNumber != "2.21.0" {
		t.Errorf("versionNumber = %q, want 2.21.0", mod.VersionNumber)
	}
}

func TestRescanFetchesEachProjectOnce(t *testing.T) {
	provider := &fakeModProvider{
		projects: map[string]models.ModProject{"ess": {ID: "ess", Title: "EssentialsX"}},
	}
	s, workDir := newModFixture(t, provider)
	pluginsDir := filepath.Join(workDir, "plugins")

	// The shape that motivated this: one project, several files on disk.
	primary := writePluginJar(t, pluginsDir, "EssentialsX-2.21.0.jar", "Essentials", "2.21.0")
	chat := writePluginJar(t, pluginsDir, "EssentialsXChat-2.21.0.jar", "EssentialsChat", "2.21.0")
	spawn := writePluginJar(t, pluginsDir, "EssentialsXSpawn-2.21.0.jar", "EssentialsSpawn", "2.21.0")
	version := models.ModVersion{ID: "ver1", ProjectID: "ess", VersionNumber: "2.21.0", FileName: "EssentialsX-2.21.0.jar"}
	provider.byHash = map[string]models.ModVersion{primary: version, chat: version, spawn: version}

	if err := s.Rescan(testServerID); err != nil {
		t.Fatalf("Rescan: %v", err)
	}

	if provider.hashCalls != 1 {
		t.Errorf("hash lookups = %d, want 1: every unknown file goes in one request", provider.hashCalls)
	}
	if provider.getProjectHit != 1 {
		t.Errorf("project fetches = %d, want 1 for three files of the same project", provider.getProjectHit)
	}

	installed := installedByFile(t, s)
	if got := installed["EssentialsXChat-2.21.0.jar"].DisplayName; got != "EssentialsChat" {
		t.Errorf("chat module displayName = %q, want its own name", got)
	}
	if got := installed["EssentialsXSpawn-2.21.0.jar"].DisplayName; got != "EssentialsSpawn" {
		t.Errorf("spawn module displayName = %q, want its own name", got)
	}
	if got := installed["EssentialsX-2.21.0.jar"].DisplayName; got != "EssentialsX" {
		t.Errorf("primary displayName = %q, want the project title", got)
	}
}

func TestRescanRemembersThatAJarIsUnknown(t *testing.T) {
	provider := &fakeModProvider{byHash: map[string]models.ModVersion{}}
	s, workDir := newModFixture(t, provider)
	writePluginJar(t, filepath.Join(workDir, "plugins"), "HandBuilt-1.0.jar", "HandBuilt", "1.0")

	if err := s.Rescan(testServerID); err != nil {
		t.Fatalf("Rescan: %v", err)
	}
	if provider.hashCalls != 1 {
		t.Fatalf("hash lookups = %d, want 1", provider.hashCalls)
	}
	if got := installedByFile(t, s)["HandBuilt-1.0.jar"].Source; got != "local" {
		t.Errorf("source = %q, want local", got)
	}

	// Nothing moved and the answer is already known, so the second pass must
	// cost neither a hash nor a request — this runs every 30 seconds.
	if err := s.Rescan(testServerID); err != nil {
		t.Fatalf("second Rescan: %v", err)
	}
	if provider.hashCalls != 1 {
		t.Errorf("hash lookups after a second scan = %d, want 1: a negative answer has to be remembered", provider.hashCalls)
	}
}

func TestRescanRetriesAfterALookupFailure(t *testing.T) {
	provider := &fakeModProvider{hashErr: errors.New("network unreachable")}
	s, workDir := newModFixture(t, provider)
	hash := writePluginJar(t, filepath.Join(workDir, "plugins"), "SomePlugin-1.0.jar", "SomePlugin", "1.0")

	if err := s.Rescan(testServerID); err == nil {
		t.Fatal("Rescan: want the lookup error surfaced")
	}
	if got := installedByFile(t, s)["SomePlugin-1.0.jar"].Source; got != "local" {
		t.Errorf("source = %q, want local while unidentified", got)
	}

	// Being offline for one tick must not brand the file local for good.
	provider.hashErr = nil
	provider.byHash = map[string]models.ModVersion{
		hash: {ID: "ver1", ProjectID: "p1", VersionNumber: "1.0", FileName: "SomePlugin-1.0.jar"},
	}
	provider.projects = map[string]models.ModProject{"p1": {ID: "p1", Title: "Some Plugin"}}

	if err := s.Rescan(testServerID); err != nil {
		t.Fatalf("second Rescan: %v", err)
	}
	if got := installedByFile(t, s)["SomePlugin-1.0.jar"].Source; got != "modrinth" {
		t.Errorf("source after the retry = %q, want modrinth", got)
	}
}

func TestRescanAnnouncesAJarRemovedFromTheFolder(t *testing.T) {
	provider := &fakeModProvider{byHash: map[string]models.ModVersion{}}
	s, workDir := newModFixture(t, provider)
	pluginsDir := filepath.Join(workDir, "plugins")
	writePluginJar(t, pluginsDir, "Gone-1.0.jar", "Gone", "1.0")

	if err := s.Rescan(testServerID); err != nil {
		t.Fatalf("Rescan: %v", err)
	}

	changed := make(chan string, 4)
	s.bus.Subscribe(EventModChanged, func(data any) {
		if m, ok := data.(map[string]any); ok {
			id, _ := m["serverID"].(string)
			changed <- id
		}
	})

	if err := os.Remove(filepath.Join(pluginsDir, "Gone-1.0.jar")); err != nil {
		t.Fatalf("remove jar: %v", err)
	}
	if err := s.Rescan(testServerID); err != nil {
		t.Fatalf("Rescan after removal: %v", err)
	}

	select {
	case id := <-changed:
		if id != testServerID {
			t.Errorf("mod:changed serverID = %q, want %q", id, testServerID)
		}
	case <-time.After(2 * time.Second):
		t.Error("no mod:changed after a jar was deleted outside the app: the list keeps showing it")
	}
}

func TestRescanLeavesInstalledModsAlone(t *testing.T) {
	files := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := w.Write([]byte("jar-bytes-for" + r.URL.Path)); err != nil {
			t.Errorf("serve jar: %v", err)
		}
	}))
	defer files.Close()

	provider := &fakeModProvider{
		versions: map[string]models.ModVersion{
			"v1": {ID: "v1", ProjectID: "p1", VersionNumber: "1.0.0", FileName: "Installed.jar",
				FileURL: files.URL + "/one", SHA512: hashOf([]byte("jar-bytes-for/one"))},
		},
		projects: map[string]models.ModProject{"p1": {ID: "p1", Title: "Installed Plugin"}},
		byHash:   map[string]models.ModVersion{},
	}
	s, _ := newModFixture(t, provider)

	if err := s.Install(testServerID, []string{"v1"}); err != nil {
		t.Fatalf("Install: %v", err)
	}
	if err := s.Rescan(testServerID); err != nil {
		t.Fatalf("Rescan: %v", err)
	}

	// A row that came from an install is already accounted for: re-hashing every
	// jar in the folder on a timer is the cost this guard exists to avoid.
	if provider.hashCalls != 0 {
		t.Errorf("hash lookups = %d, want 0 for a folder Konnekt installed itself", provider.hashCalls)
	}
	if got := installedByFile(t, s)["Installed.jar"].Source; got != "modrinth" {
		t.Errorf("source = %q, want modrinth", got)
	}
}

func TestInstallLocalIdentifiesWhatItCopied(t *testing.T) {
	provider := &fakeModProvider{
		projects: map[string]models.ModProject{"p1": {ID: "p1", Title: "Picked Plugin", IconURL: "https://example.test/p.png"}},
	}
	s, _ := newModFixture(t, provider)

	srcDir := t.TempDir()
	hash := writePluginJar(t, srcDir, "Picked-1.0.jar", "Picked", "1.0")
	provider.byHash = map[string]models.ModVersion{
		hash: {ID: "ver1", ProjectID: "p1", VersionNumber: "1.0", FileName: "Picked-1.0.jar"},
	}

	if err := s.InstallLocal(testServerID, []string{filepath.Join(srcDir, "Picked-1.0.jar")}); err != nil {
		t.Fatalf("InstallLocal: %v", err)
	}

	mod := installedByFile(t, s)["Picked-1.0.jar"]
	if mod.Source != "modrinth" {
		t.Errorf("source = %q, want modrinth: picking a Modrinth jar from disk does not make it an unknown file", mod.Source)
	}
	if mod.ProjectID != "p1" || mod.IconURL == "" {
		t.Errorf("projectID/iconUrl = %q/%q, want p1 and an icon", mod.ProjectID, mod.IconURL)
	}
}

func TestFileSHA512CachedMatchesContentAndFollowsChanges(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "a.jar")
	if err := os.WriteFile(path, []byte("first"), 0644); err != nil {
		t.Fatalf("write: %v", err)
	}

	got, err := fileSHA512Cached(path)
	if err != nil {
		t.Fatalf("fileSHA512Cached: %v", err)
	}
	if want := hashOf([]byte("first")); got != want {
		t.Errorf("hash = %s, want %s", got, want)
	}

	// The cache is keyed by path+mtime+size, so replacing the file has to
	// invalidate it — a re-downloaded jar keeps its name.
	if err := os.WriteFile(path, []byte("second-and-longer"), 0644); err != nil {
		t.Fatalf("rewrite: %v", err)
	}
	if err := os.Chtimes(path, time.Now().Add(time.Second), time.Now().Add(time.Second)); err != nil {
		t.Fatalf("chtimes: %v", err)
	}
	got, err = fileSHA512Cached(path)
	if err != nil {
		t.Fatalf("fileSHA512Cached after rewrite: %v", err)
	}
	if want := hashOf([]byte("second-and-longer")); got != want {
		t.Errorf("hash after rewrite = %s, want %s", got, want)
	}
}
