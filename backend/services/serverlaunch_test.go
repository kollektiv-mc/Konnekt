package services

import (
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"
)

// argfileName is the argfile the resolver looks for on this platform; fixtures
// write both so the tests behave the same on Linux, macOS and Windows.
func argfileName() string {
	if runtime.GOOS == "windows" {
		return "win_args.txt"
	}
	return "unix_args.txt"
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, []byte(content), 0o755); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

// neoForgeInstall lays out a NeoForge server install: run.sh/run.bat naming the
// argfiles, user_jvm_args.txt, and the argfile itself under libraries/.
func neoForgeInstall(t *testing.T, dir, version string) {
	t.Helper()
	rel := filepath.Join("libraries", "net", "neoforged", "neoforge", version)
	writeFile(t, filepath.Join(dir, rel, "unix_args.txt"), "-p\nlibraries/x.jar\nnet.neoforged.fml.startup.Server\n")
	writeFile(t, filepath.Join(dir, rel, "win_args.txt"), "-p\nlibraries/x.jar\nnet.neoforged.fml.startup.Server\n")
	writeFile(t, filepath.Join(dir, "user_jvm_args.txt"), "# JVM arguments\n-Xmx4G\n")
	writeFile(t, filepath.Join(dir, "run.sh"), "#!/usr/bin/env sh\n"+
		"# java is mentioned in this comment on purpose\n"+
		"java @user_jvm_args.txt @libraries/net/neoforged/neoforge/"+version+"/unix_args.txt \"$@\"\n")
	writeFile(t, filepath.Join(dir, "run.bat"), "@echo off\r\n"+
		"java @user_jvm_args.txt @libraries\\net\\neoforged\\neoforge\\"+version+"\\win_args.txt %*\r\n"+
		"pause\r\n")
}

func TestResolveLaunchClassicJar(t *testing.T) {
	dir := t.TempDir()
	jar := filepath.Join(dir, "server.jar")
	writeFile(t, jar, "")

	got, err := resolveLaunch(jar, dir, []string{"-Xms512M", "-Xmx2G"})
	if err != nil {
		t.Fatalf("resolveLaunch: %v", err)
	}
	want := []string{"-Xms512M", "-Xmx2G", "-jar", jar, "--nogui"}
	if !slices.Equal(got, want) {
		t.Errorf("resolveLaunch = %v, want %v", got, want)
	}
}

// A jar sitting inside a NeoForge install still wins — an explicit path is a
// deliberate choice, not something to second-guess.
func TestResolveLaunchJarWinsOverScript(t *testing.T) {
	dir := t.TempDir()
	neoForgeInstall(t, dir, "21.1.72")
	jar := filepath.Join(dir, "server.jar")
	writeFile(t, jar, "")

	got, err := resolveLaunch(jar, dir, nil)
	if err != nil {
		t.Fatalf("resolveLaunch: %v", err)
	}
	if !slices.Contains(got, "-jar") {
		t.Errorf("resolveLaunch = %v, want the -jar form", got)
	}
}

func TestResolveLaunchNeoForge(t *testing.T) {
	dir := t.TempDir()
	neoForgeInstall(t, dir, "21.1.72")

	for _, tc := range []struct {
		name    string
		jarPath string
	}{
		{"empty jar path", ""},
		{"jar path pointing at the launcher", filepath.Join(dir, "run.sh")},
		{"stale jar path", filepath.Join(dir, "gone.jar")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := resolveLaunch(tc.jarPath, dir, []string{"-Xmx6G"})
			if err != nil {
				t.Fatalf("resolveLaunch: %v", err)
			}

			user := slices.Index(got, "@user_jvm_args.txt")
			xmx := slices.Index(got, "-Xmx6G")
			args := slices.IndexFunc(got, func(a string) bool {
				return strings.HasPrefix(a, "@") && strings.HasSuffix(a, argfileName())
			})
			if user < 0 || xmx < 0 || args < 0 {
				t.Fatalf("resolveLaunch = %v, want @user_jvm_args.txt, -Xmx6G and the argfile", got)
			}
			// Konnekt's -Xmx must sit after user_jvm_args.txt (so it wins) and
			// before the argfile (so it lands in JVM position, not as a
			// program argument to the server).
			if !(user < xmx && xmx < args) {
				t.Errorf("resolveLaunch = %v, want order @user_jvm_args.txt < -Xmx6G < argfile", got)
			}
			if got[len(got)-1] != "--nogui" {
				t.Errorf("resolveLaunch = %v, want --nogui last", got)
			}
			if slices.Contains(got, "-jar") {
				t.Errorf("resolveLaunch = %v, want no -jar for an argfile install", got)
			}
		})
	}
}

func TestResolveLaunchForge(t *testing.T) {
	dir := t.TempDir()
	rel := filepath.Join("libraries", "net", "minecraftforge", "forge", "1.20.1-47.2.0")
	writeFile(t, filepath.Join(dir, rel, argfileName()), "net.minecraftforge.bootstrap.ForgeBootstrap\n")
	writeFile(t, filepath.Join(dir, "user_jvm_args.txt"), "-Xmx4G\n")
	writeFile(t, filepath.Join(dir, "run.sh"), "#!/usr/bin/env sh\n"+
		"java @user_jvm_args.txt @libraries/net/minecraftforge/forge/1.20.1-47.2.0/unix_args.txt \"$@\"\n")
	writeFile(t, filepath.Join(dir, "run.bat"), "java @user_jvm_args.txt @libraries\\net\\minecraftforge\\forge\\1.20.1-47.2.0\\win_args.txt %*\r\n")

	got, err := resolveLaunch("", dir, nil)
	if err != nil {
		t.Fatalf("resolveLaunch: %v", err)
	}
	if !slices.ContainsFunc(got, func(a string) bool { return strings.Contains(a, "minecraftforge") }) {
		t.Errorf("resolveLaunch = %v, want the forge argfile", got)
	}
	if slices.Contains(got, "$@") || slices.Contains(got, "%*") {
		t.Errorf("resolveLaunch = %v, want the shell passthrough token dropped", got)
	}
}

// Flags the installer put on the java line are carried over, not just @argfiles.
func TestResolveLaunchKeepsScriptFlags(t *testing.T) {
	dir := t.TempDir()
	neoForgeInstall(t, dir, "21.1.72")
	script := "run.sh"
	line := "java -Dfile.encoding=UTF-8 @user_jvm_args.txt @libraries/net/neoforged/neoforge/21.1.72/unix_args.txt \"$@\"\n"
	if runtime.GOOS == "windows" {
		script = "run.bat"
		line = "java -Dfile.encoding=UTF-8 @user_jvm_args.txt @libraries\\net\\neoforged\\neoforge\\21.1.72\\win_args.txt %*\r\n"
	}
	writeFile(t, filepath.Join(dir, script), line)

	got, err := resolveLaunch("", dir, []string{"-Xmx2G"})
	if err != nil {
		t.Fatalf("resolveLaunch: %v", err)
	}
	enc := slices.Index(got, "-Dfile.encoding=UTF-8")
	if enc != 0 {
		t.Errorf("resolveLaunch = %v, want -Dfile.encoding=UTF-8 first, in script order", got)
	}
}

// With no parseable launcher, the argfile is located under libraries/ instead.
func TestResolveLaunchArgfileFallback(t *testing.T) {
	dir := t.TempDir()
	neoForgeInstall(t, dir, "21.1.72")
	for _, name := range []string{"run.sh", "run.bat"} {
		if err := os.Remove(filepath.Join(dir, name)); err != nil {
			t.Fatalf("remove %s: %v", name, err)
		}
	}

	got, err := resolveLaunch("", dir, []string{"-Xmx2G"})
	if err != nil {
		t.Fatalf("resolveLaunch: %v", err)
	}
	want := []string{
		"@user_jvm_args.txt",
		"-Xmx2G",
		"@" + filepath.Join("libraries", "net", "neoforged", "neoforge", "21.1.72", argfileName()),
		"--nogui",
	}
	if !slices.Equal(got, want) {
		t.Errorf("resolveLaunch = %v, want %v", got, want)
	}
}

func TestResolveLaunchErrors(t *testing.T) {
	empty := t.TempDir()

	for _, tc := range []struct {
		name       string
		jarPath    string
		workingDir string
		wantSubstr string
	}{
		{"nothing configured", "", "", "no working directory"},
		{"empty directory", "", empty, "no runnable server found"},
		{"missing jar, empty directory", filepath.Join(empty, "server.jar"), empty, "not found"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := resolveLaunch(tc.jarPath, tc.workingDir, nil)
			if err == nil {
				t.Fatalf("resolveLaunch(%q, %q) = nil error, want one", tc.jarPath, tc.workingDir)
			}
			if !strings.Contains(err.Error(), tc.wantSubstr) {
				t.Errorf("error = %q, want it to mention %q", err, tc.wantSubstr)
			}
		})
	}
}

// An installer jar must be refused, not run — `java -jar installer.jar` starts
// the installer, which looks like a broken server to the user.
func TestResolveLaunchRejectsInstaller(t *testing.T) {
	dir := t.TempDir()
	jar := makeJar(t, filepath.Join(dir, "neoforge-21.1.72-installer.jar"), map[string]string{
		"install_profile.json": `{"profile":"NeoForge","version":"neoforge-21.1.72","minecraft":"1.21.1"}`,
	})

	_, err := resolveLaunch(jar, dir, nil)
	if err == nil {
		t.Fatal("resolveLaunch(installer) = nil error, want a refusal")
	}
	for _, want := range []string{"NeoForge", "--installServer"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error = %q, want it to mention %q", err, want)
		}
	}
}

func TestDescribeLaunch(t *testing.T) {
	jarDir := t.TempDir()
	jar := filepath.Join(jarDir, "paper-1.20.1.jar")
	writeFile(t, jar, "")

	scriptDir := t.TempDir()
	neoForgeInstall(t, scriptDir, "21.1.72")

	argfileDir := t.TempDir()
	neoForgeInstall(t, argfileDir, "21.1.72")
	for _, name := range []string{"run.sh", "run.bat"} {
		if err := os.Remove(filepath.Join(argfileDir, name)); err != nil {
			t.Fatalf("remove %s: %v", name, err)
		}
	}

	wantScript := "run.sh"
	if runtime.GOOS == "windows" {
		wantScript = "run.bat"
	}

	for _, tc := range []struct {
		name       string
		jarPath    string
		workingDir string
		want       string
	}{
		{"classic jar", jar, jarDir, "paper-1.20.1.jar"},
		{"launcher script", "", scriptDir, wantScript},
		{"argfile only", "", argfileDir, argfileName()},
		{"nothing", "", t.TempDir(), ""},
		{"no directory", "", "", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := describeLaunch(tc.jarPath, tc.workingDir); got != tc.want {
				t.Errorf("describeLaunch = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestUserJVMArgs(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "user_jvm_args.txt"),
		"# Xmx and Xms set the maximum and minimum RAM usage\n"+
			"\n"+
			"-Xmx6G\n"+
			"-XX:+UseG1GC -XX:MaxGCPauseMillis=200\n")

	got := userJVMArgs(dir)
	want := []string{"-Xmx6G", "-XX:+UseG1GC", "-XX:MaxGCPauseMillis=200"}
	if !slices.Equal(got, want) {
		t.Errorf("userJVMArgs = %v, want %v", got, want)
	}

	if n := parseXmx(got); n != 6144 {
		t.Errorf("parseXmx(userJVMArgs) = %d, want 6144", n)
	}
	// Konnekt's own args are scanned first, so the UI setting wins — matching
	// which -Xmx the JVM itself honours.
	if n := parseXmx(append([]string{"-Xmx2G"}, got...)); n != 2048 {
		t.Errorf("parseXmx(konnekt args first) = %d, want 2048", n)
	}
	if got := userJVMArgs(t.TempDir()); got != nil {
		t.Errorf("userJVMArgs(no file) = %v, want nil", got)
	}
}
