package services

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
)

// Launch resolution.
//
// `java -jar <server.jar>` only describes vanilla, Fabric, Paper/Spigot and Forge
// up to 1.16. Since Forge 1.17 — and so for every NeoForge version, which starts at
// MC 1.20.2 — the installer emits no runnable server jar. It emits run.sh/run.bat,
// user_jvm_args.txt, and a JVM argfile under libraries/ that carries the module
// path, the --add-opens flags and the bootstrap main class:
//
//	java @user_jvm_args.txt @libraries/net/neoforged/neoforge/21.1.72/unix_args.txt "$@"
//
// We reconstruct that command rather than executing the script, so java stays a
// direct child of Konnekt: the stdin "stop" write, the gopsutil handle cached from
// cmd.Process.Pid, and killTree all keep addressing the JVM itself and not a shell
// wrapper around it.

// resolveLaunch returns the full argument vector following the `java` executable.
// jarPath may be empty (a script-based install), a server jar, or a run.sh/run.bat.
// Argfile tokens stay relative to workingDir — ServerService.Start sets cmd.Dir to
// it, and the paths inside the argfile are relative to that directory regardless.
func resolveLaunch(jarPath, workingDir string, jvmArgs []string) ([]string, error) {
	jarPath = strings.TrimSpace(jarPath)
	dir := strings.TrimSpace(workingDir)

	switch {
	case isLaunchScript(jarPath):
		// Pointed straight at run.sh/run.bat: its own directory is the install.
		if dir == "" {
			dir = filepath.Dir(jarPath)
		}
	case jarPath != "" && strings.EqualFold(filepath.Ext(jarPath), ".jar"):
		if _, err := os.Stat(jarPath); err == nil {
			// An installer jar runs the installer, not a server — refuse rather
			// than start something confusing. Reachable for a config saved
			// before Konnekt detected installers, or a hand-typed path.
			if info, _ := InspectInstaller(jarPath); info.IsInstaller {
				return nil, fmt.Errorf("%s is a %s installer, not a server — install it first (Konnekt offers this when you select it, or run it yourself with --installServer)", filepath.Base(jarPath), installerLabel(info))
			}
			args := make([]string, 0, len(jvmArgs)+3)
			args = append(args, jvmArgs...)
			args = append(args, "-jar", jarPath, "--nogui")
			return args, nil
		}
		// Jar configured but missing — fall through to script detection so a stale
		// path in an otherwise valid install still starts.
	}

	if dir == "" {
		return nil, fmt.Errorf("no server jar and no working directory configured — point Konnekt at the server jar, or at the NeoForge/Forge install directory")
	}

	args, err := scriptLaunchArgs(dir, jvmArgs)
	if err != nil {
		if jarPath != "" && !isLaunchScript(jarPath) {
			return nil, fmt.Errorf("server jar %s not found: %w", jarPath, err)
		}
		return nil, err
	}
	return args, nil
}

// installerLabel names an installer for an error message, degrading to the
// generic term when InspectInstaller could not read the profile.
func installerLabel(info InstallerInfo) string {
	switch info.Loader {
	case "neoforge":
		return "NeoForge"
	case "forge":
		return "Forge"
	}
	return "Forge/NeoForge"
}

// describeLaunch names the file a server actually starts from — the jar, the
// launcher script, or the argfile — for display. It walks the same resolution
// order as resolveLaunch so the two can never disagree. Returns "" when
// nothing runnable is found.
func describeLaunch(jarPath, workingDir string) string {
	jarPath = strings.TrimSpace(jarPath)
	dir := strings.TrimSpace(workingDir)

	if isLaunchScript(jarPath) {
		if dir == "" {
			dir = filepath.Dir(jarPath)
		}
	} else if jarPath != "" && strings.EqualFold(filepath.Ext(jarPath), ".jar") {
		if _, err := os.Stat(jarPath); err == nil {
			return baseName(jarPath)
		}
	}

	if dir == "" {
		return ""
	}
	for _, name := range launchScriptNames() {
		if _, err := os.Stat(filepath.Join(dir, name)); err == nil {
			return name
		}
	}
	if tokens := argfileTokens(dir); len(tokens) > 0 {
		return baseName(strings.TrimPrefix(tokens[len(tokens)-1], "@"))
	}
	return ""
}

// scriptLaunchArgs builds the java arguments for a script-based install in dir,
// preferring the launcher script (which names its argfiles exactly) and falling
// back to locating the argfile under libraries/ ourselves.
func scriptLaunchArgs(dir string, jvmArgs []string) ([]string, error) {
	for _, name := range launchScriptNames() {
		tokens, err := parseLaunchScript(filepath.Join(dir, name))
		if err != nil || len(tokens) == 0 {
			continue
		}
		return spliceJVMArgs(tokens, jvmArgs), nil
	}

	if tokens := argfileTokens(dir); len(tokens) > 0 {
		return spliceJVMArgs(tokens, jvmArgs), nil
	}

	return nil, fmt.Errorf("no runnable server found in %s — expected a server jar, a run.sh/run.bat, or a NeoForge/Forge argfile under libraries/", dir)
}

// launchScriptNames lists the installer-generated launchers, native one first.
func launchScriptNames() []string {
	if runtime.GOOS == "windows" {
		return []string{"run.bat", "run.sh"}
	}
	return []string{"run.sh", "run.bat"}
}

func isLaunchScript(path string) bool {
	if path == "" {
		return false
	}
	base := strings.ToLower(baseName(path))
	return base == "run.sh" || base == "run.bat" || base == "run.cmd"
}

// parseLaunchScript returns the tokens of the script's java invocation, minus the
// `java` token itself and the "$@"/%* passthrough. Everything else is kept in
// order — the @argfiles and any -D/-X flag the installer put on that line.
func parseLaunchScript(path string) ([]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || isScriptComment(line) {
			continue
		}

		tokens := strings.Fields(line)
		idx := javaTokenIndex(tokens)
		if idx < 0 {
			continue
		}

		out := make([]string, 0, len(tokens))
		for _, t := range tokens[idx+1:] {
			t = unquote(t)
			if t == "" || isPassthroughToken(t) {
				continue
			}
			out = append(out, t)
		}
		if len(out) > 0 {
			return out, nil
		}
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	return nil, fmt.Errorf("%s: no java invocation found", path)
}

func isScriptComment(line string) bool {
	if strings.HasPrefix(line, "#") || strings.HasPrefix(line, "::") {
		return true
	}
	lower := strings.ToLower(line)
	return lower == "rem" || strings.HasPrefix(lower, "rem ")
}

// javaTokenIndex finds the token invoking java — bare, quoted, or a full path such
// as %JAVA_HOME%\bin\java.exe. Returns -1 when the line invokes something else.
func javaTokenIndex(tokens []string) int {
	for i, t := range tokens {
		base := strings.ToLower(baseName(unquote(t)))
		if base == "java" || base == "java.exe" {
			return i
		}
	}
	return -1
}

func isPassthroughToken(t string) bool {
	switch t {
	case "$@", "$*", "%*":
		return true
	}
	return false
}

func unquote(t string) string {
	if len(t) >= 2 {
		if (t[0] == '"' && t[len(t)-1] == '"') || (t[0] == '\'' && t[len(t)-1] == '\'') {
			return t[1 : len(t)-1]
		}
	}
	return t
}

// baseName is filepath.Base that also splits on backslashes, so a Windows-style
// path in run.bat is handled when Konnekt itself runs on Linux.
func baseName(path string) string {
	path = strings.ReplaceAll(path, "\\", "/")
	return filepath.Base(path)
}

// spliceJVMArgs inserts Konnekt's JVM args immediately before the last @argfile —
// the one carrying the main class, after which everything is a program argument.
// Landing after @user_jvm_args.txt is what makes Konnekt's -Xmx win: HotSpot
// honours the last one it sees.
func spliceJVMArgs(tokens []string, jvmArgs []string) []string {
	insert := len(tokens)
	for i := len(tokens) - 1; i >= 0; i-- {
		if strings.HasPrefix(tokens[i], "@") {
			insert = i
			break
		}
	}

	out := make([]string, 0, len(tokens)+len(jvmArgs)+1)
	out = append(out, tokens[:insert]...)
	out = append(out, jvmArgs...)
	out = append(out, tokens[insert:]...)

	if !hasNoGui(out) {
		out = append(out, "--nogui")
	}
	return out
}

func hasNoGui(args []string) bool {
	for _, a := range args {
		if a == "nogui" || a == "--nogui" {
			return true
		}
	}
	return false
}

// argfileTokens locates a NeoForge/Forge argfile under libraries/ for installs
// whose launcher script is missing or unparseable.
func argfileTokens(dir string) []string {
	suffix := "unix_args.txt"
	if runtime.GOOS == "windows" {
		suffix = "win_args.txt"
	}

	patterns := []string{
		filepath.Join(dir, "libraries", "net", "neoforged", "neoforge", "*", suffix),
		filepath.Join(dir, "libraries", "net", "minecraftforge", "forge", "*", suffix),
	}

	var found string
	for _, pattern := range patterns {
		matches, err := filepath.Glob(pattern)
		if err != nil || len(matches) == 0 {
			continue
		}
		// Several loader versions can sit side by side; the newest file is the one
		// the most recent installer run wrote. Version strings sort badly here
		// ("21.1.9" > "21.1.72" lexically), so use mtime.
		found = matches[0]
		newest, _ := os.Stat(found)
		for _, m := range matches[1:] {
			info, err := os.Stat(m)
			if err != nil || newest == nil {
				continue
			}
			if info.ModTime().After(newest.ModTime()) {
				found, newest = m, info
			}
		}
		break
	}
	if found == "" {
		return nil
	}

	rel, err := filepath.Rel(dir, found)
	if err != nil {
		rel = found
	}

	var tokens []string
	if _, err := os.Stat(filepath.Join(dir, "user_jvm_args.txt")); err == nil {
		tokens = append(tokens, "@user_jvm_args.txt")
	}
	return append(tokens, "@"+rel)
}

// userJVMArgs reads the tokens of <dir>/user_jvm_args.txt, where a NeoForge/Forge
// install keeps its -Xmx. Returns nil when the file is absent or unreadable.
func userJVMArgs(dir string) []string {
	if dir == "" {
		return nil
	}
	f, err := os.Open(filepath.Join(dir, "user_jvm_args.txt"))
	if err != nil {
		return nil
	}
	defer f.Close()

	var out []string
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		out = append(out, strings.Fields(line)...)
	}
	return out
}

// --- Loader version detection ---

// reLoaderArgfile pulls the loader build out of an argfile path. Both projects
// lay their argfile down under a directory named for the exact version being
// launched, so the path is the record: no file has to be opened and no log has
// to have been written yet.
//
//	libraries/net/neoforged/neoforge/21.1.72/unix_args.txt   -> "21.1.72"
//	libraries/net/minecraftforge/forge/1.20.1-47.2.0/win_args.txt -> "1.20.1-47.2.0"
var reLoaderArgfile = regexp.MustCompile(`(?:net/neoforged/neoforge|net/minecraftforge/forge)/([^/]+)/[^/]*args\.txt$`)

// detectLoaderVersion reports the loader build a server will launch with, and
// where that answer came from ("script", "libraries", or "" when unknown).
//
// It walks resolveLaunch's order rather than a convenient one, so the version
// reported is always the version that will actually be used. That matters most
// in the case it deliberately declines: a configured server *jar* wins over a
// launcher script in resolveLaunch, and a `-jar` launch involves no loader
// argfile at all, so reporting a build found under libraries/ would name a
// version the next start is not going to use.
//
// Forge builds are returned in the form Forge itself names them
// ("1.20.1-47.2.0"), not reduced the way installer.go's loaderVersion reduces
// install_profile.json, because here the directory name is the identifier the
// install is keyed by.
func detectLoaderVersion(jarPath, workingDir string) (version, source string) {
	jarPath = strings.TrimSpace(jarPath)
	dir := strings.TrimSpace(workingDir)

	if isLaunchScript(jarPath) {
		if dir == "" {
			dir = filepath.Dir(jarPath)
		}
	} else if jarPath != "" && strings.EqualFold(filepath.Ext(jarPath), ".jar") {
		if _, err := os.Stat(jarPath); err == nil {
			return "", "" // launches with -jar; no loader argfile involved
		}
		// Missing jar: resolveLaunch falls through to the script, so we do too.
	}

	if dir == "" {
		return "", ""
	}

	for _, name := range launchScriptNames() {
		tokens, err := parseLaunchScript(filepath.Join(dir, name))
		if err != nil || len(tokens) == 0 {
			continue
		}
		if v := loaderVersionFromTokens(tokens); v != "" {
			return v, "script"
		}
	}

	if v := loaderVersionFromTokens(argfileTokens(dir)); v != "" {
		return v, "libraries"
	}
	return "", ""
}

// loaderVersionFromTokens finds the first argfile token naming a loader build.
// Backslashes are normalised first so a Windows-style path in run.bat is read
// correctly even when Konnekt itself is running on Linux, matching baseName.
func loaderVersionFromTokens(tokens []string) string {
	for _, t := range tokens {
		normalised := strings.ReplaceAll(strings.TrimPrefix(t, "@"), "\\", "/")
		if m := reLoaderArgfile.FindStringSubmatch(normalised); m != nil {
			return m[1]
		}
	}
	return ""
}
