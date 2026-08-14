package services

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"
)

// makeJar writes a zip at path with the given entries.
func makeJar(t *testing.T, path string, entries map[string]string) string {
	t.Helper()
	f, err := os.Create(path)
	if err != nil {
		t.Fatalf("create %s: %v", path, err)
	}
	defer f.Close()

	w := zip.NewWriter(f)
	for name, content := range entries {
		e, err := w.Create(name)
		if err != nil {
			t.Fatalf("create entry %s: %v", name, err)
		}
		if _, err := e.Write([]byte(content)); err != nil {
			t.Fatalf("write entry %s: %v", name, err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}
	return path
}

func TestInspectInstaller(t *testing.T) {
	dir := t.TempDir()

	neo := makeJar(t, filepath.Join(dir, "neoforge-21.1.72-installer.jar"), map[string]string{
		"install_profile.json": `{"profile":"NeoForge","version":"neoforge-21.1.72","minecraft":"1.21.1"}`,
		"version.json":         `{"id":"neoforge-21.1.72"}`,
	})
	forge := makeJar(t, filepath.Join(dir, "forge-1.20.1-47.2.0-installer.jar"), map[string]string{
		"install_profile.json": `{"profile":"forge","version":"1.20.1-forge-47.2.0","minecraft":"1.20.1"}`,
	})
	// The marker with unreadable metadata is still an installer — we just
	// describe it less precisely, falling back to the filename.
	garbage := makeJar(t, filepath.Join(dir, "neoforge-20.4.100-installer.jar"), map[string]string{
		"install_profile.json": `{not json at all`,
	})
	server := makeJar(t, filepath.Join(dir, "server.jar"), map[string]string{
		"version.json":          `{"id":"1.21.1"}`,
		"META-INF/MANIFEST.MF":  "Main-Class: net.minecraft.server.Main\n",
		"net/minecraft/foo.txt": "x",
	})

	notZip := filepath.Join(dir, "notes.jar")
	if err := os.WriteFile(notZip, []byte("plain text, not a zip"), 0o644); err != nil {
		t.Fatalf("write %s: %v", notZip, err)
	}

	for _, tc := range []struct {
		name string
		path string
		want InstallerInfo
	}{
		{"neoforge installer", neo, InstallerInfo{true, "neoforge", "21.1.72", "1.21.1"}},
		{"forge installer", forge, InstallerInfo{true, "forge", "47.2.0", "1.20.1"}},
		{"marker with garbage json", garbage, InstallerInfo{true, "neoforge", "20.4.100", ""}},
		{"plain server jar", server, InstallerInfo{}},
		{"not a zip", notZip, InstallerInfo{}},
		{"empty path", "", InstallerInfo{}},
		{"missing file", filepath.Join(dir, "nope.jar"), InstallerInfo{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := InspectInstaller(tc.path)
			if err != nil {
				t.Fatalf("InspectInstaller: %v", err)
			}
			if got != tc.want {
				t.Errorf("InspectInstaller = %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestLoaderVersion(t *testing.T) {
	for _, tc := range []struct {
		version, mcVersion, want string
	}{
		{"neoforge-21.1.72", "1.21.1", "21.1.72"},
		{"1.20.1-forge-47.2.0", "1.20.1", "47.2.0"},
		{"1.20.4-20.4.100", "1.20.4", "20.4.100"},
		{"", "1.21.1", ""},
	} {
		if got := loaderVersion(tc.version, tc.mcVersion); got != tc.want {
			t.Errorf("loaderVersion(%q, %q) = %q, want %q", tc.version, tc.mcVersion, got, tc.want)
		}
	}
}

// Aborting mid-download leaves a truncated vanilla server jar that the
// installer's next run accepts without re-downloading, so the retry dies in
// BUNDLER_EXTRACT with "zip END header not found". The next attempt has to
// clear it first.
func TestRepairPartialInstall(t *testing.T) {
	dir := t.TempDir()
	serverDir := filepath.Join(dir, "libraries", "net", "minecraft", "server", "1.21.4")
	if err := os.MkdirAll(serverDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}

	truncated := filepath.Join(serverDir, "server-1.21.4.jar")
	if err := os.WriteFile(truncated, []byte("PK\x03\x04 partial download"), 0o644); err != nil {
		t.Fatalf("write truncated jar: %v", err)
	}

	removed := repairPartialInstall(dir)
	if len(removed) != 1 {
		t.Fatalf("repairPartialInstall = %v, want one removal", removed)
	}
	if _, err := os.Stat(truncated); !os.IsNotExist(err) {
		t.Errorf("truncated jar still present: %v", err)
	}
}

func TestRepairPartialInstallKeepsValidJars(t *testing.T) {
	dir := t.TempDir()
	serverDir := filepath.Join(dir, "libraries", "net", "minecraft", "server", "1.21.4")
	if err := os.MkdirAll(serverDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	intact := makeJar(t, filepath.Join(serverDir, "server-1.21.4.jar"), map[string]string{
		"META-INF/MANIFEST.MF": "Manifest-Version: 1.0\n",
	})

	if removed := repairPartialInstall(dir); len(removed) != 0 {
		t.Errorf("repairPartialInstall = %v, want nothing removed for a readable jar", removed)
	}
	if _, err := os.Stat(intact); err != nil {
		t.Errorf("intact jar was removed: %v", err)
	}

	// A directory with no install in it at all is not an error.
	if removed := repairPartialInstall(t.TempDir()); len(removed) != 0 {
		t.Errorf("repairPartialInstall(empty dir) = %v, want nothing", removed)
	}
}

func TestInstallServerRejectsNonInstaller(t *testing.T) {
	dir := t.TempDir()
	jar := makeJar(t, filepath.Join(dir, "server.jar"), map[string]string{"version.json": `{"id":"1.21.1"}`})

	s := NewInstallerService()
	if err := s.InstallServer(jar, filepath.Join(dir, "target")); err == nil {
		t.Error("InstallServer(server jar) = nil error, want a refusal")
	}
	if err := s.InstallServer(jar, ""); err == nil {
		t.Error("InstallServer(no target) = nil error, want a refusal")
	}
}
