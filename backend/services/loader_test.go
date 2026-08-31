package services

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"konnekt/backend/models"
)

// --- fixtures ---

type fakeLoaderProvider struct {
	versions     []models.LoaderVersion
	installerURL string
	calls        int
	err          error
}

func (f *fakeLoaderProvider) ID() string { return "neoforge" }

func (f *fakeLoaderProvider) Versions(context.Context, string) ([]models.LoaderVersion, error) {
	f.calls++
	if f.err != nil {
		return nil, f.err
	}
	return f.versions, nil
}

func (f *fakeLoaderProvider) InstallerURL(string) string { return f.installerURL }

// fakeInstaller stands in for the real one, which shells out to java. Its whole
// job is to let a test choose what the install *did* to the directory, which is
// what the rollback and verification paths turn on.
type fakeInstaller struct {
	mu   sync.Mutex
	runs int
	fn   func(jarPath, targetDir string) error
}

func (f *fakeInstaller) runInstaller(jarPath, targetDir string) error {
	f.mu.Lock()
	f.runs++
	fn := f.fn
	f.mu.Unlock()
	if fn == nil {
		return nil
	}
	return fn(jarPath, targetDir)
}

func (f *fakeInstaller) setFn(fn func(jarPath, targetDir string) error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.fn = fn
}

// ran reports the run count under the lock, since the update runs in its own
// goroutine while the test reads this.
func (f *fakeInstaller) ran() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.runs
}

// installerJar writes a jar that InspectInstaller will read as a NeoForge
// installer for the given build.
func installerJar(t *testing.T, dir, version, mcVersion string) []byte {
	t.Helper()
	path := makeJar(t, filepath.Join(dir, "installer.jar"), map[string]string{
		"install_profile.json": fmt.Sprintf(
			`{"profile":"NeoForge","version":"neoforge-%s","minecraft":"%s"}`, version, mcVersion),
	})
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read installer jar: %v", err)
	}
	return data
}

type loaderFixture struct {
	svc       *LoaderService
	cfgSvc    *ConfigService
	provider  *fakeLoaderProvider
	installer *fakeInstaller
	bus       *EventBus
	srv       *ServerService
	workDir   string
	dataDir   string
	serverID  string
}

// newLoaderFixture builds a LoaderService over a real NeoForge install laid out
// in a temp directory, with the network and the installer faked.
func newLoaderFixture(t *testing.T, over ...func(*models.ServerConfig)) *loaderFixture {
	t.Helper()

	dataDir := t.TempDir()
	workDir := t.TempDir()
	neoForgeInstall(t, workDir, "21.1.72")

	cfgSvc := NewConfigService()
	cfgSvc.SetDataDir(dataDir)

	cfg := models.ServerConfig{
		ID:         "srv1",
		Name:       "smp",
		WorkingDir: workDir,
		Loader:     "neoforge",
		MCVersion:  "1.21.1",
		JvmArgs:    []string{"-Xmx4G"},
	}
	for _, f := range over {
		f(&cfg)
	}
	if err := cfgSvc.SaveServerConfig(cfg); err != nil {
		t.Fatalf("save config: %v", err)
	}

	srv := NewServerService()
	bus := NewEventBus()
	srv.SetBus(bus)

	backup := NewBackupService(cfgSvc, srv)
	backup.SetBus(bus)
	backup.SetDataDir(dataDir)

	installer := &fakeInstaller{}
	provider := &fakeLoaderProvider{}

	svc := NewLoaderService(cfgSvc, srv, backup, nil)
	svc.installer = installer
	svc.providers = map[string]LoaderProvider{provider.ID(): provider}
	svc.SetBus(bus)
	svc.SetDataDir(dataDir)

	return &loaderFixture{
		svc: svc, cfgSvc: cfgSvc, provider: provider, installer: installer,
		bus: bus, srv: srv, workDir: workDir, dataDir: dataDir, serverID: cfg.ID,
	}
}

// serveInstaller points the fake provider at an httptest server returning body.
func (f *loaderFixture) serveInstaller(t *testing.T, status int, body []byte) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(status)
		_, _ = w.Write(body) //nolint:errcheck // test server write
	}))
	t.Cleanup(srv.Close)
	f.provider.installerURL = srv.URL + "/neoforge-installer.jar"
}

// updateOutcome waits for the update to settle and reports what happened.
type updateOutcome struct {
	finished   bool
	err        string
	rolledBack bool
}

func (f *loaderFixture) awaitUpdate(t *testing.T, req models.LoaderUpdateRequest) updateOutcome {
	t.Helper()

	var mu sync.Mutex
	var got updateOutcome
	done := make(chan struct{})
	var once sync.Once

	f.bus.Subscribe(EventLoaderUpdateFinished, func(any) {
		mu.Lock()
		got.finished = true
		mu.Unlock()
		once.Do(func() { close(done) })
	})
	f.bus.Subscribe(EventLoaderUpdateFailed, func(data any) {
		mu.Lock()
		if m, ok := data.(map[string]any); ok {
			got.err, _ = m["error"].(string)
			got.rolledBack, _ = m["rolledBack"].(bool)
		}
		mu.Unlock()
		once.Do(func() { close(done) })
	})

	if err := f.svc.Update(req); err != nil {
		t.Fatalf("Update returned a synchronous error: %v", err)
	}

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("the update never settled")
	}
	mu.Lock()
	defer mu.Unlock()
	return got
}

func (f *loaderFixture) runScript(t *testing.T) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(f.workDir, "run.sh"))
	if err != nil {
		t.Fatalf("read run.sh: %v", err)
	}
	return string(data)
}

// --- Status ---

func TestLoaderStatus(t *testing.T) {
	t.Run("a NeoForge install is managed", func(t *testing.T) {
		f := newLoaderFixture(t)
		got, err := f.svc.Status(f.serverID)
		if err != nil {
			t.Fatalf("Status: %v", err)
		}
		if got.InstalledVersion != "21.1.72" || got.Source != "script" {
			t.Errorf("Status = %+v, want 21.1.72 from the script", got)
		}
		if !got.Managed || got.Reason != "" {
			t.Errorf("Status.Managed = %v (%q), want true with no reason", got.Managed, got.Reason)
		}
	})

	// Every unmanaged case has to say why, because the UI shows the reason in
	// place of the update control.
	for _, tc := range []struct {
		name   string
		mutate func(*models.ServerConfig)
		want   string
	}{
		{
			name:   "a loader with no provider",
			mutate: func(c *models.ServerConfig) { c.Loader = "paper" },
			want:   "Konnekt cannot update paper servers yet.",
		},
		{
			name:   "an undetected loader",
			mutate: func(c *models.ServerConfig) { c.Loader = "" },
			want:   "Konnekt has not detected which loader this server uses.",
		},
		{
			name:   "a directory with no install in it",
			mutate: func(c *models.ServerConfig) { c.WorkingDir = "" },
			want:   "No NeoForge install was found in this server's directory.",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newLoaderFixture(t, tc.mutate)
			got, err := f.svc.Status(f.serverID)
			if err != nil {
				t.Fatalf("Status: %v", err)
			}
			if got.Managed {
				t.Error("Status.Managed = true, want false")
			}
			if got.Reason != tc.want {
				t.Errorf("Status.Reason = %q, want %q", got.Reason, tc.want)
			}
		})
	}

	// A server pointed at a runnable jar launches with -jar and never reads the
	// loader argfile, so there is nothing here to update in place.
	t.Run("a jar launch is not managed", func(t *testing.T) {
		f := newLoaderFixture(t)
		jar := filepath.Join(f.workDir, "server.jar")
		writeFile(t, jar, "")
		cfg, _ := f.cfgSvc.GetServerConfig(f.serverID)
		cfg.JarPath = jar
		if err := f.cfgSvc.SaveServerConfig(*cfg); err != nil {
			t.Fatalf("save config: %v", err)
		}

		got, err := f.svc.Status(f.serverID)
		if err != nil {
			t.Fatalf("Status: %v", err)
		}
		if got.Managed {
			t.Errorf("Status.Managed = true for a -jar launch, want false (%+v)", got)
		}
	})
}

// --- AvailableVersions ---

func TestLoaderAvailableVersions(t *testing.T) {
	f := newLoaderFixture(t)
	f.provider.versions = []models.LoaderVersion{
		{Version: "21.2.1-beta", MCVersion: "1.21.2"},
		{Version: "21.1.209", MCVersion: "1.21.1", Stable: true, Latest: true},
		{Version: "21.1.72", MCVersion: "1.21.1", Stable: true},
		{Version: "20.4.237", MCVersion: "1.20.4", Stable: true},
	}

	got, err := f.svc.AvailableVersions(f.serverID)
	if err != nil {
		t.Fatalf("AvailableVersions: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("AvailableVersions returned %d, want the 2 targeting 1.21.1", len(got))
	}
	for _, v := range got {
		if v.MCVersion != "1.21.1" {
			t.Errorf("AvailableVersions included %s for %s", v.Version, v.MCVersion)
		}
	}

	// Cached: the filter is the only per-server part, so a second call must not
	// go back to the network.
	if _, err := f.svc.AvailableVersions(f.serverID); err != nil {
		t.Fatalf("AvailableVersions (second call): %v", err)
	}
	if f.provider.calls != 1 {
		t.Errorf("provider fetched %d times, want 1", f.provider.calls)
	}
}

// An undetected Minecraft version shows everything rather than nothing, which
// would look like the fetch had failed.
func TestLoaderAvailableVersionsWithoutMCVersion(t *testing.T) {
	f := newLoaderFixture(t, func(c *models.ServerConfig) { c.MCVersion = "" })
	f.provider.versions = []models.LoaderVersion{
		{Version: "21.1.209", MCVersion: "1.21.1"},
		{Version: "20.4.237", MCVersion: "1.20.4"},
	}

	got, err := f.svc.AvailableVersions(f.serverID)
	if err != nil {
		t.Fatalf("AvailableVersions: %v", err)
	}
	if len(got) != 2 {
		t.Errorf("AvailableVersions returned %d, want all 2", len(got))
	}
}

func TestLoaderAvailableVersionsUnsupportedLoader(t *testing.T) {
	f := newLoaderFixture(t, func(c *models.ServerConfig) { c.Loader = "paper" })
	if _, err := f.svc.AvailableVersions(f.serverID); err == nil {
		t.Error("AvailableVersions(paper) = nil error, want a refusal")
	}
}

// --- Update refusals ---

// Everything judgeable up front comes back as a synchronous error, so the UI
// can refuse the click rather than opening a progress dialog that immediately
// fails.
func TestLoaderUpdateRefusals(t *testing.T) {
	t.Run("while the server is running", func(t *testing.T) {
		f := newLoaderFixture(t)
		// The instance's id is its map key now, so the fixture claims the real
		// instance for this server rather than writing an id onto whichever one
		// happened to be current (#232).
		in := f.srv.instanceFor(f.serverID)
		f.srv.setCurrent(in)
		in.mu.Lock()
		in.running = true
		in.mu.Unlock()

		err := f.svc.Update(models.LoaderUpdateRequest{ServerID: f.serverID, Version: "21.1.209"})
		if err == nil {
			t.Fatal("Update = nil error while running, want a refusal")
		}
		if f.installer.ran() != 0 {
			t.Error("the installer ran despite the refusal")
		}
	})

	t.Run("when already on that build", func(t *testing.T) {
		f := newLoaderFixture(t)
		if err := f.svc.Update(models.LoaderUpdateRequest{ServerID: f.serverID, Version: "21.1.72"}); err == nil {
			t.Error("Update to the installed version = nil error, want a refusal")
		}
	})

	t.Run("with no version", func(t *testing.T) {
		f := newLoaderFixture(t)
		if err := f.svc.Update(models.LoaderUpdateRequest{ServerID: f.serverID}); err == nil {
			t.Error("Update with no version = nil error, want a refusal")
		}
	})

	t.Run("for an unknown server", func(t *testing.T) {
		f := newLoaderFixture(t)
		if err := f.svc.Update(models.LoaderUpdateRequest{ServerID: "nope", Version: "21.1.209"}); err == nil {
			t.Error("Update for an unknown server = nil error, want a refusal")
		}
	})

	t.Run("for an unmanaged loader", func(t *testing.T) {
		f := newLoaderFixture(t, func(c *models.ServerConfig) { c.Loader = "paper" })
		if err := f.svc.Update(models.LoaderUpdateRequest{ServerID: f.serverID, Version: "21.1.209"}); err == nil {
			t.Error("Update for a Paper server = nil error, want a refusal")
		}
	})
}

// --- Update, end to end ---

func TestLoaderUpdateSucceeds(t *testing.T) {
	f := newLoaderFixture(t)
	f.serveInstaller(t, http.StatusOK, installerJar(t, t.TempDir(), "21.1.209", "1.21.1"))
	// A real install rewrites run.sh to name the new argfile.
	f.installer.setFn(func(_, targetDir string) error {
		neoForgeInstall(t, targetDir, "21.1.209")
		return nil
	})

	got := f.awaitUpdate(t, models.LoaderUpdateRequest{ServerID: f.serverID, Version: "21.1.209"})
	if !got.finished {
		t.Fatalf("update did not finish: %+v", got)
	}

	cfg, err := f.cfgSvc.GetServerConfig(f.serverID)
	if err != nil {
		t.Fatalf("reload config: %v", err)
	}
	if cfg.LoaderVersion != "21.1.209" {
		t.Errorf("stored loaderVersion = %q, want 21.1.209", cfg.LoaderVersion)
	}

	// The snapshot is kept, not cleaned up: it is what a later revert reads.
	snapshots, err := os.ReadDir(filepath.Join(f.dataDir, "loader-snapshots", f.serverID))
	if err != nil || len(snapshots) != 1 {
		t.Fatalf("snapshots = %v (err %v), want exactly one", snapshots, err)
	}
	marker := filepath.Join(f.dataDir, "loader-snapshots", f.serverID, snapshots[0].Name(), "run.sh")
	if _, err := os.Stat(marker); err != nil {
		t.Errorf("snapshot is missing run.sh: %v", err)
	}
}

// The installer failing is the case the snapshot exists for.
func TestLoaderUpdateRollsBackAFailedInstall(t *testing.T) {
	f := newLoaderFixture(t)
	f.serveInstaller(t, http.StatusOK, installerJar(t, t.TempDir(), "21.1.209", "1.21.1"))

	before := f.runScript(t)
	f.installer.setFn(func(_, targetDir string) error {
		// Get far enough to have damaged the launch files, then fail.
		writeFile(t, filepath.Join(targetDir, "run.sh"), "half-written garbage\n")
		return fmt.Errorf("exit status 1")
	})

	got := f.awaitUpdate(t, models.LoaderUpdateRequest{ServerID: f.serverID, Version: "21.1.209"})
	if got.finished {
		t.Fatal("a failed install reported success")
	}
	if !got.rolledBack {
		t.Error("the failure did not report a rollback")
	}
	if after := f.runScript(t); after != before {
		t.Errorf("run.sh was not restored:\n got %q\nwant %q", after, before)
	}

	cfg, _ := f.cfgSvc.GetServerConfig(f.serverID)
	if cfg.LoaderVersion != "" {
		t.Errorf("a failed update recorded loaderVersion = %q", cfg.LoaderVersion)
	}
}

// An installer can exit 0 having changed nothing. Without the post-install
// check the server would keep launching the old build while the UI claimed the
// new one — the silent failure this whole step exists for.
func TestLoaderUpdateRejectsAnInstallThatDidNotMove(t *testing.T) {
	f := newLoaderFixture(t)
	f.serveInstaller(t, http.StatusOK, installerJar(t, t.TempDir(), "21.1.209", "1.21.1"))

	before := f.runScript(t)
	f.installer.setFn(func(string, string) error { return nil }) // exits 0, does nothing

	got := f.awaitUpdate(t, models.LoaderUpdateRequest{ServerID: f.serverID, Version: "21.1.209"})
	if got.finished {
		t.Fatal("an install that did not move the server reported success")
	}
	if got.err == "" || !strings.Contains(got.err, "21.1.72") {
		t.Errorf("error = %q, want it to name the version still installed", got.err)
	}
	if after := f.runScript(t); after != before {
		t.Error("run.sh was not restored")
	}

	cfg, _ := f.cfgSvc.GetServerConfig(f.serverID)
	if cfg.LoaderVersion != "" {
		t.Errorf("a rejected update recorded loaderVersion = %q", cfg.LoaderVersion)
	}
}

// The download is checked before java is handed it, so a bad one costs nothing.
func TestLoaderUpdateRejectsABadDownload(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		body   func(t *testing.T) []byte
		want   string
	}{
		{
			name:   "a captive portal's login page",
			status: http.StatusOK,
			body:   func(*testing.T) []byte { return []byte("<html>sign in</html>") },
			want:   "not a NeoForge installer",
		},
		{
			name:   "a server error",
			status: http.StatusInternalServerError,
			body:   func(*testing.T) []byte { return nil },
			want:   "HTTP 500",
		},
		{
			// The wrong build is the dangerous one: it *is* a valid installer,
			// so only the version check catches it.
			name:   "an installer for a different build",
			status: http.StatusOK,
			body:   func(t *testing.T) []byte { return installerJar(t, t.TempDir(), "21.1.100", "1.21.1") },
			want:   "installs 21.1.100",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newLoaderFixture(t)
			f.serveInstaller(t, tc.status, tc.body(t))
			before := f.runScript(t)

			got := f.awaitUpdate(t, models.LoaderUpdateRequest{ServerID: f.serverID, Version: "21.1.209"})
			if got.finished {
				t.Fatal("a bad download reported success")
			}
			if !strings.Contains(got.err, tc.want) {
				t.Errorf("error = %q, want it to mention %q", got.err, tc.want)
			}
			if f.installer.ran() != 0 {
				t.Error("the installer ran on a download that failed verification")
			}
			// Nothing was touched, so there is nothing to roll back.
			if got.rolledBack {
				t.Error("reported a rollback for a failure that changed nothing")
			}
			if after := f.runScript(t); after != before {
				t.Error("run.sh changed despite the download failing")
			}
		})
	}
}

func TestLoaderUpdateTakesAFullBackupWhenAsked(t *testing.T) {
	f := newLoaderFixture(t)
	f.serveInstaller(t, http.StatusOK, installerJar(t, t.TempDir(), "21.1.209", "1.21.1"))
	f.installer.setFn(func(_, targetDir string) error {
		neoForgeInstall(t, targetDir, "21.1.209")
		return nil
	})

	got := f.awaitUpdate(t, models.LoaderUpdateRequest{
		ServerID: f.serverID, Version: "21.1.209", FullBackup: true,
	})
	if !got.finished {
		t.Fatalf("update did not finish: %+v", got)
	}

	backups := NewBackupService(f.cfgSvc, f.srv)
	backups.SetDataDir(f.dataDir)
	list, err := backups.ListBackups(f.serverID)
	if err != nil {
		t.Fatalf("ListBackups: %v", err)
	}
	if len(list) == 0 {
		t.Error("FullBackup was requested but no backup was taken")
	}
}

// A second update while one is running has to be refused rather than queued:
// two installers writing the same directory is how an install gets corrupted.
func TestLoaderUpdateRefusesAConcurrentRun(t *testing.T) {
	f := newLoaderFixture(t)
	f.serveInstaller(t, http.StatusOK, installerJar(t, t.TempDir(), "21.1.209", "1.21.1"))

	// Settled has to be watched from before the first Update: the test cannot
	// return while the update goroutine is still writing, or t.TempDir's cleanup
	// races it and the whole test flakes on an unrelated "directory not empty".
	settled := make(chan struct{})
	var once sync.Once
	closeSettled := func(any) { once.Do(func() { close(settled) }) }
	f.bus.Subscribe(EventLoaderUpdateFinished, closeSettled)
	f.bus.Subscribe(EventLoaderUpdateFailed, closeSettled)

	release := make(chan struct{})
	f.installer.setFn(func(_, targetDir string) error {
		<-release
		neoForgeInstall(t, targetDir, "21.1.209")
		return nil
	})

	if err := f.svc.Update(models.LoaderUpdateRequest{ServerID: f.serverID, Version: "21.1.209"}); err != nil {
		t.Fatalf("first Update: %v", err)
	}
	waitFor(t, func() bool { return f.installer.ran() == 1 })

	if err := f.svc.Update(models.LoaderUpdateRequest{ServerID: f.serverID, Version: "21.1.209"}); err == nil {
		t.Error("a second concurrent Update = nil error, want a refusal")
	}

	close(release)
	select {
	case <-settled:
	case <-time.After(5 * time.Second):
		t.Fatal("the first update never settled")
	}
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("condition never became true")
}
