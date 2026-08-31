package services

import (
	"archive/zip"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"konnekt/backend/models"
)

// --- fixtures -----------------------------------------------------------------

// writeJar builds a .jar (a zip) from a name→body map.
func writeJar(t *testing.T, path string, entries map[string]string) string {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()

	zw := zip.NewWriter(f)
	for name, body := range entries {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return path
}

// neoForgeInstallerJar reproduces the layout of a real NeoForge server
// installer: install_profile.json, a version.json whose "id" is the loader
// *profile* name rather than a Minecraft version, and none of the loader
// markers a server jar carries.
func neoForgeInstallerJar(t *testing.T, dir string) string {
	t.Helper()
	return writeJar(t, filepath.Join(dir, "neoforge-21.1.233-installer.jar"), map[string]string{
		"version.json":         `{"id":"neoforge-21.1.233","type":"release"}`,
		"install_profile.json": `{"profile":"NeoForge","version":"neoforge-21.1.233","minecraft":"1.21.1"}`,
		"META-INF/MANIFEST.MF": "Manifest-Version: 1.0\r\nMain-Class: net.minecraftforge.installer.SimpleInstaller\r\n",
	})
}

// writeServerLog writes logs/latest.log with `preamble` lines of mod-scanning
// noise between ModLauncher's argument line and vanilla's version line — the
// shape of a large modpack's startup, where the two are thousands of lines apart.
func writeServerLog(t *testing.T, dir string, preamble int, argLine bool) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(dir, "logs"), 0755); err != nil {
		t.Fatal(err)
	}
	var b strings.Builder
	if argLine {
		b.WriteString("[10:00:00] [main/INFO] [cp.mo.mo.Launcher/MODLAUNCHER]: ModLauncher running: args " +
			"[--launchTarget, forgeserver, --fml.neoForgeVersion, 21.1.233, --fml.fmlVersion, 4.0.41, " +
			"--fml.mcVersion, 1.21.1, --fml.neoFormVersion, 20240808.144430]\n")
	} else {
		b.WriteString("[10:00:00] [main/INFO] [cp.mo.mo.Launcher/MODLAUNCHER]: NeoForge starting\n")
	}
	for i := range preamble {
		fmt.Fprintf(&b, "[10:00:01] [main/WARN] [mixin/]: Reference map 'mod%d.refmap.json' could not be read\n", i)
	}
	b.WriteString("[10:00:30] [Server thread/INFO] [minecraft/MinecraftServer]: Starting minecraft server version 1.21.1\n")

	if err := os.WriteFile(filepath.Join(dir, "logs", "latest.log"), []byte(b.String()), 0644); err != nil {
		t.Fatal(err)
	}
}

// --- isMCVersion --------------------------------------------------------------

func TestIsMCVersion(t *testing.T) {
	valid := []string{"1.21", "1.21.1", "1.8", "1.20.4", "1.21.2-pre1", "1.21-rc1", "24w40a"}
	for _, v := range valid {
		if !isMCVersion(v) {
			t.Errorf("isMCVersion(%q) = false, want true", v)
		}
	}
	// "neoforge-21.1.233" is the one that mattered: it reached Modrinth as a
	// game-version filter and silently matched nothing.
	invalid := []string{"", "neoforge-21.1.233", "21.1.233", "1.20.1-forge-47.2.0", "forge", "abc", "1"}
	for _, v := range invalid {
		if isMCVersion(v) {
			t.Errorf("isMCVersion(%q) = true, want false", v)
		}
	}
}

// --- detectFromJar ------------------------------------------------------------

func TestDetectFromJarInstallerIsNotAVanillaServer(t *testing.T) {
	jar := neoForgeInstallerJar(t, t.TempDir())

	mc, loader := detectFromJar(jar)
	if mc != "1.21.1" || loader != "neoforge" {
		t.Errorf("detectFromJar(installer) = (%q, %q), want (\"1.21.1\", \"neoforge\")", mc, loader)
	}
}

func TestDetectFromJarVanillaServer(t *testing.T) {
	jar := writeJar(t, filepath.Join(t.TempDir(), "server.jar"), map[string]string{
		"version.json":         `{"id":"1.21.1"}`,
		"META-INF/MANIFEST.MF": "Manifest-Version: 1.0\r\nMain-Class: net.minecraft.bundler.Main\r\n",
	})

	mc, loader := detectFromJar(jar)
	if mc != "1.21.1" || loader != "vanilla" {
		t.Errorf("detectFromJar(vanilla) = (%q, %q), want (\"1.21.1\", \"vanilla\")", mc, loader)
	}
}

// A jar whose version.json carries something that is not a Minecraft version
// must report no version at all — and therefore must not be called vanilla,
// since that label was only ever inferred from having found a version.
func TestDetectFromJarRejectsNonVersionID(t *testing.T) {
	jar := writeJar(t, filepath.Join(t.TempDir(), "mystery.jar"), map[string]string{
		"version.json": `{"id":"some-profile-name"}`,
	})

	mc, loader := detectFromJar(jar)
	if mc != "" || loader != "" {
		t.Errorf("detectFromJar(bogus id) = (%q, %q), want empty", mc, loader)
	}
}

func TestDetectFromJarLoaderMarkers(t *testing.T) {
	tests := []struct {
		name    string
		entries map[string]string
		want    string
	}{
		{"neoforge", map[string]string{"META-INF/neoforge.mods.toml": ""}, "neoforge"},
		{"forge", map[string]string{"META-INF/mods.toml": ""}, "forge"},
		{"fabric", map[string]string{"net/fabricmc/loader/Main.class": ""}, "fabric"},
		{"paper", map[string]string{"META-INF/MANIFEST.MF": "Main-Class: io.papermc.paperclip.Main\r\n"}, "paper"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			jar := writeJar(t, filepath.Join(t.TempDir(), "server.jar"), tc.entries)
			if _, loader := detectFromJar(jar); loader != tc.want {
				t.Errorf("loader = %q, want %q", loader, tc.want)
			}
		})
	}
}

func TestDetectFromJarMissingOrUnreadable(t *testing.T) {
	for _, path := range []string{"", filepath.Join(t.TempDir(), "gone.jar")} {
		if mc, loader := detectFromJar(path); mc != "" || loader != "" {
			t.Errorf("detectFromJar(%q) = (%q, %q), want empty", path, mc, loader)
		}
	}
}

// --- detectFromInstallDir -----------------------------------------------------

// The case the whole fix turns on: a modern NeoForge install has no runnable
// jar and may never have been started, so the argfile path under libraries/ is
// the only thing that can identify it — and it is enough.
func TestDetectFromInstallDirNeoForge(t *testing.T) {
	dir := t.TempDir()
	neoForgeInstall(t, dir, "21.1.233")

	mc, loader := detectFromInstallDir("", dir)
	if mc != "1.21.1" || loader != "neoforge" {
		t.Errorf("detectFromInstallDir = (%q, %q), want (\"1.21.1\", \"neoforge\")", mc, loader)
	}
}

// forgeInstall (serverlaunch_test.go) writes both unix_args.txt and
// win_args.txt, which matters: argfileTokens picks its filename by GOOS, so a
// fixture carrying only one of them finds nothing on the other platform. The
// hand-rolled unix-only fixture this replaced passed locally and failed on the
// Windows runner for exactly that reason.
func TestDetectFromInstallDirForge(t *testing.T) {
	dir := t.TempDir()
	forgeInstall(t, dir, "1.20.1-47.2.0")

	mc, loader := detectFromInstallDir("", dir)
	if mc != "1.20.1" || loader != "forge" {
		t.Errorf("detectFromInstallDir = (%q, %q), want (\"1.20.1\", \"forge\")", mc, loader)
	}
}

func TestDetectFromInstallDirEmpty(t *testing.T) {
	if mc, loader := detectFromInstallDir("", t.TempDir()); mc != "" || loader != "" {
		t.Errorf("detectFromInstallDir(bare dir) = (%q, %q), want empty", mc, loader)
	}
}

// --- detectFromLog ------------------------------------------------------------

// The version line on a big modpack sits thousands of lines past the loader
// line. Reading only the first 500 lines detected the loader and never the
// version, which is the asymmetry that left servers half-described.
func TestDetectFromLogPastTheOldLineCap(t *testing.T) {
	dir := t.TempDir()
	writeServerLog(t, dir, 1200, false)

	mc, loader := detectFromLog(dir)
	if mc != "1.21.1" || loader != "neoforge" {
		t.Errorf("detectFromLog = (%q, %q), want (\"1.21.1\", \"neoforge\")", mc, loader)
	}
}

// FML puts the version on line one, so a log whose vanilla line is beyond even
// the raised cap still answers.
func TestDetectFromLogReadsFMLArgs(t *testing.T) {
	dir := t.TempDir()
	writeServerLog(t, dir, logScanLines+100, true)

	mc, loader := detectFromLog(dir)
	if mc != "1.21.1" || loader != "neoforge" {
		t.Errorf("detectFromLog = (%q, %q), want (\"1.21.1\", \"neoforge\")", mc, loader)
	}
}

func TestDetectFromLogMissing(t *testing.T) {
	if mc, loader := detectFromLog(t.TempDir()); mc != "" || loader != "" {
		t.Errorf("detectFromLog(no logs) = (%q, %q), want empty", mc, loader)
	}
}

// --- detectServerLoader -------------------------------------------------------

func TestDetectServerLoader(t *testing.T) {
	t.Run("neoforge install, never started", func(t *testing.T) {
		dir := t.TempDir()
		neoForgeInstall(t, dir, "21.1.233")

		mc, loader := detectServerLoader(struct{ JarPath, WorkingDir string }{WorkingDir: dir})
		if mc != "1.21.1" || loader != "neoforge" {
			t.Errorf("= (%q, %q), want (\"1.21.1\", \"neoforge\")", mc, loader)
		}
	})

	// The reported bug, end to end: the installer jar left in the config used to
	// yield ("neoforge-21.1.233", "vanilla") — a game version Modrinth has never
	// heard of, and a loader that suppresses the loader filter entirely.
	t.Run("installer jar left in the config", func(t *testing.T) {
		dir := t.TempDir()
		neoForgeInstall(t, dir, "21.1.233")
		jar := neoForgeInstallerJar(t, dir)

		mc, loader := detectServerLoader(struct{ JarPath, WorkingDir string }{JarPath: jar, WorkingDir: dir})
		if mc != "1.21.1" || loader != "neoforge" {
			t.Errorf("= (%q, %q), want (\"1.21.1\", \"neoforge\")", mc, loader)
		}
	})

	t.Run("nothing to go on", func(t *testing.T) {
		mc, loader := detectServerLoader(struct{ JarPath, WorkingDir string }{WorkingDir: t.TempDir()})
		if mc != "" || loader != "" {
			t.Errorf("= (%q, %q), want empty", mc, loader)
		}
	})
}

// --- sanitizeTarget / resolveTarget -------------------------------------------

func TestSanitizeTarget(t *testing.T) {
	tests := []struct {
		mcVersion, loader     string
		wantVersion, wantLoad string
	}{
		{"1.21.1", "neoforge", "1.21.1", "neoforge"},
		{"1.21.1", "vanilla", "1.21.1", "vanilla"},
		{"", "neoforge", "", "neoforge"},
		// A version that is not one discredits the loader written beside it.
		{"neoforge-21.1.233", "vanilla", "", ""},
		{"21.1.233", "neoforge", "", ""},
	}
	for _, tc := range tests {
		gotV, gotL := sanitizeTarget(tc.mcVersion, tc.loader)
		if gotV != tc.wantVersion || gotL != tc.wantLoad {
			t.Errorf("sanitizeTarget(%q, %q) = (%q, %q), want (%q, %q)",
				tc.mcVersion, tc.loader, gotV, gotL, tc.wantVersion, tc.wantLoad)
		}
	}
}

// A config poisoned by the installer misread repairs itself on read, without
// the user editing anything: this is what unbreaks an existing install.
func TestResolveTargetRepairsAPoisonedConfig(t *testing.T) {
	dir := t.TempDir()
	neoForgeInstall(t, dir, "21.1.233")
	cfg := models.ServerConfig{
		WorkingDir: dir,
		MCVersion:  "neoforge-21.1.233",
		Loader:     "vanilla",
	}

	mc, loader := resolveTarget(cfg)
	if mc != "1.21.1" || loader != "neoforge" {
		t.Errorf("resolveTarget = (%q, %q), want (\"1.21.1\", \"neoforge\")", mc, loader)
	}
}

// A plausible stored pair is an override and must survive untouched, even when
// the install on disk would say something else.
func TestResolveTargetKeepsAPlausibleOverride(t *testing.T) {
	dir := t.TempDir()
	neoForgeInstall(t, dir, "21.1.233")
	cfg := models.ServerConfig{WorkingDir: dir, MCVersion: "1.20.1", Loader: "forge"}

	mc, loader := resolveTarget(cfg)
	if mc != "1.20.1" || loader != "forge" {
		t.Errorf("resolveTarget = (%q, %q), want the stored override", mc, loader)
	}
}

func TestResolveTargetFillsAGap(t *testing.T) {
	dir := t.TempDir()
	neoForgeInstall(t, dir, "21.1.233")
	cfg := models.ServerConfig{WorkingDir: dir, Loader: "neoforge"}

	if mc, loader := resolveTarget(cfg); mc != "1.21.1" || loader != "neoforge" {
		t.Errorf("resolveTarget = (%q, %q), want (\"1.21.1\", \"neoforge\")", mc, loader)
	}
}

// --- the query these values feed ----------------------------------------------

// The end the whole chain serves: a repaired pair produces a facet set that can
// match something, where the poisoned one filtered every result away while
// still returning HTTP 200.
func TestBuildFacetsFromResolvedTarget(t *testing.T) {
	dir := t.TempDir()
	neoForgeInstall(t, dir, "21.1.233")
	poisoned := models.ServerConfig{WorkingDir: dir, MCVersion: "neoforge-21.1.233", Loader: "vanilla"}

	mc, loader := resolveTarget(poisoned)
	got := buildFacets(mc, loader, nil)
	want := `[["project_type:mod"],["categories:neoforge"],["versions:1.21.1"]]`
	if got != want {
		t.Errorf("buildFacets = %s, want %s", got, want)
	}
}
