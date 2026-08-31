package services

import (
	"archive/zip"
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	"konnekt/backend/models"
)

// jarCacheKey combines path, mtime and size so the cache self-invalidates on any change.
type jarCacheKey struct {
	path  string
	mtime int64
	size  int64
}

var jarMetaCache sync.Map // jarCacheKey → models.JarMeta

// parseJarMetaCached wraps parseJarMeta with a file-stat cache so repeated
// ListInstalled calls (polling every 10 s) don't re-open every zip.
func parseJarMetaCached(jarPath, loaderHint string) (models.JarMeta, error) {
	info, err := os.Stat(jarPath)
	if err != nil {
		return models.JarMeta{}, fmt.Errorf("stat %s: %w", jarPath, err)
	}
	key := jarCacheKey{path: jarPath, mtime: info.ModTime().UnixMilli(), size: info.Size()}
	if cached, ok := jarMetaCache.Load(key); ok {
		return cached.(models.JarMeta), nil
	}
	meta, parseErr := parseJarMeta(jarPath, loaderHint)
	if parseErr == nil {
		jarMetaCache.Store(key, meta)
	}
	return meta, parseErr
}

// parseJarMeta opens a .jar (which is a zip) and extracts mod/plugin identity
// by inspecting loader-specific manifest files. loaderHint (from ServerConfig)
// is tried first for speed; falls back to detecting all known formats.
func parseJarMeta(jarPath, loaderHint string) (models.JarMeta, error) {
	r, err := zip.OpenReader(jarPath)
	if err != nil {
		return filenameHeuristic(jarPath), nil // graceful degradation
	}
	defer r.Close()

	// Build a lookup from zip entry names for cheap access.
	entries := make(map[string]*zip.File, len(r.File))
	for _, f := range r.File {
		entries[f.Name] = f
	}

	// Try loaderHint first, then all loaders in order.
	var meta models.JarMeta
	var found bool

	tryOrder := detectOrder(loaderHint)
	for _, loader := range tryOrder {
		meta, found = tryLoader(loader, entries)
		if found {
			if meta.Loader == "" {
				meta.Loader = loader
			}
			return meta, nil
		}
	}

	// Last resort: MANIFEST.MF
	if mf, ok := entries["META-INF/MANIFEST.MF"]; ok {
		if name, ver := parseManifest(mf); name != "" || ver != "" {
			return models.JarMeta{Name: name, Version: ver}, nil
		}
	}

	return filenameHeuristic(jarPath), nil
}

// detectOrder returns the loader probe sequence with the hint first.
func detectOrder(hint string) []string {
	all := []string{"fabric", "quilt", "neoforge", "forge", "paper", "spigot"}
	if hint == "" {
		return all
	}
	out := []string{hint}
	for _, l := range all {
		if l != hint {
			out = append(out, l)
		}
	}
	return out
}

func tryLoader(loader string, entries map[string]*zip.File) (models.JarMeta, bool) {
	switch loader {
	case "fabric":
		if f, ok := entries["fabric.mod.json"]; ok {
			return parseFabricMod(f)
		}
	case "quilt":
		if f, ok := entries["quilt.mod.json"]; ok {
			return parseQuiltMod(f)
		}
	case "neoforge":
		if f, ok := entries["META-INF/neoforge.mods.toml"]; ok {
			return parseModsToml(f, "neoforge")
		}
		fallthrough // NeoForge jars may also have mods.toml
	case "forge":
		if f, ok := entries["META-INF/mods.toml"]; ok {
			return parseModsToml(f, "forge")
		}
	case "paper", "spigot", "bukkit":
		if f, ok := entries["paper-plugin.yml"]; ok {
			return parsePluginYml(f, "paper")
		}
		if f, ok := entries["plugin.yml"]; ok {
			return parsePluginYml(f, loader)
		}
	}
	return models.JarMeta{}, false
}

// --- Fabric ---

type fabricModJSON struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Version string `json:"version"`
}

func parseFabricMod(f *zip.File) (models.JarMeta, bool) {
	data, err := readZipEntry(f)
	if err != nil {
		return models.JarMeta{}, false
	}
	var m fabricModJSON
	if err := json.Unmarshal(data, &m); err != nil {
		return models.JarMeta{}, false
	}
	name := m.Name
	if name == "" {
		name = m.ID
	}
	return models.JarMeta{ID: m.ID, Name: name, Version: m.Version, Loader: "fabric"}, true
}

// --- Quilt ---

type quiltModJSON struct {
	QuiltLoader struct {
		ID      string `json:"id"`
		Version string `json:"version"`
	} `json:"quilt_loader"`
	Metadata struct {
		Name string `json:"name"`
	} `json:"metadata"`
}

func parseQuiltMod(f *zip.File) (models.JarMeta, bool) {
	data, err := readZipEntry(f)
	if err != nil {
		return models.JarMeta{}, false
	}
	var m quiltModJSON
	if err := json.Unmarshal(data, &m); err != nil {
		return models.JarMeta{}, false
	}
	name := m.Metadata.Name
	if name == "" {
		name = m.QuiltLoader.ID
	}
	return models.JarMeta{ID: m.QuiltLoader.ID, Name: name, Version: m.QuiltLoader.Version, Loader: "quilt"}, true
}

// --- Forge / NeoForge (mods.toml) ---
// Minimal hand-rolled parser: reads the first [[mods]] section's modId/version/displayName.
// Handles ${file.jarVersion} by reading MANIFEST.MF Implementation-Version.

func parseModsToml(f *zip.File, loader string) (models.JarMeta, bool) {
	data, err := readZipEntry(f)
	if err != nil {
		return models.JarMeta{}, false
	}

	var modID, version, displayName string
	inMods := false

	sc := bufio.NewScanner(strings.NewReader(string(data)))
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "[[mods]]" {
			inMods = true
			continue
		}
		if strings.HasPrefix(line, "[[") && inMods {
			break // left [[mods]] section
		}
		if !inMods {
			continue
		}
		k, v := splitTomlKV(line)
		switch k {
		case "modId":
			modID = v
		case "version":
			version = v
		case "displayName":
			displayName = v
		}
	}

	if modID == "" {
		return models.JarMeta{}, false
	}

	// Resolve ${file.jarVersion} placeholder
	if strings.Contains(version, "${") {
		version = "" // will be filled below from MANIFEST.MF if available
	}

	name := displayName
	if name == "" {
		name = modID
	}
	return models.JarMeta{ID: modID, Name: name, Version: version, Loader: loader}, true
}

func splitTomlKV(line string) (key, value string) {
	idx := strings.IndexByte(line, '=')
	if idx < 0 {
		return "", ""
	}
	key = strings.TrimSpace(line[:idx])
	value = strings.Trim(strings.TrimSpace(line[idx+1:]), `"`)
	return
}

// --- Plugin YAML (Bukkit / Paper) ---
// Top-level line-based parser: only reads `name:`, `version:`, `main:`.

func parsePluginYml(f *zip.File, loader string) (models.JarMeta, bool) {
	data, err := readZipEntry(f)
	if err != nil {
		return models.JarMeta{}, false
	}

	var name, version string
	sc := bufio.NewScanner(strings.NewReader(string(data)))
	for sc.Scan() {
		line := sc.Text()
		if strings.HasPrefix(line, " ") || strings.HasPrefix(line, "\t") {
			continue // skip nested keys
		}
		k, v := splitYAMLKV(line)
		switch k {
		case "name":
			name = v
		case "version":
			version = v
		}
	}

	if name == "" {
		return models.JarMeta{}, false
	}
	return models.JarMeta{ID: strings.ToLower(name), Name: name, Version: version, Loader: loader}, true
}

func splitYAMLKV(line string) (key, value string) {
	idx := strings.IndexByte(line, ':')
	if idx < 0 {
		return "", ""
	}
	key = strings.TrimSpace(line[:idx])
	value = strings.TrimSpace(line[idx+1:])
	// Strip inline YAML quotes
	value = strings.Trim(value, `"'`)
	return
}

// --- MANIFEST.MF ---

func parseManifest(f *zip.File) (name, version string) {
	data, err := readZipEntry(f)
	if err != nil {
		return
	}
	sc := bufio.NewScanner(strings.NewReader(string(data)))
	for sc.Scan() {
		k, v := splitManifestKV(sc.Text())
		switch k {
		case "Implementation-Title":
			name = v
		case "Implementation-Version":
			version = v
		}
	}
	return
}

func splitManifestKV(line string) (key, value string) {
	idx := strings.IndexByte(line, ':')
	if idx < 0 {
		return "", ""
	}
	key = strings.TrimSpace(line[:idx])
	value = strings.TrimSpace(line[idx+1:])
	return
}

// --- Filename heuristic ---

var reJarVersion = regexp.MustCompile(`^(.+?)-(\d[\w.\-]*)\.jar$`)

func filenameHeuristic(jarPath string) models.JarMeta {
	base := filepath.Base(jarPath)
	// Strip .disabled suffix if present
	base = strings.TrimSuffix(base, ".disabled")
	if m := reJarVersion.FindStringSubmatch(strings.ToLower(base)); m != nil {
		return models.JarMeta{Name: m[1], Version: m[2]}
	}
	name := strings.TrimSuffix(base, ".jar")
	return models.JarMeta{Name: name}
}

// --- Server loader detection ---

// reMCVersion is the shape of a Minecraft version: "1.21", "1.21.1", and the
// pre-release/snapshot forms Mojang ships ("1.21.2-pre1", "24w40a").
//
// It exists because a version string has to be *validated*, not merely found.
// Every value detection produces here ends up as a Modrinth `versions:` facet
// and a `game_versions` filter, and Modrinth answers a game version it has
// never heard of with an empty list and HTTP 200 — no error to surface, no way
// for the UI to tell "this mod has no build for you" apart from "Konnekt asked
// a nonsense question". So a value that cannot be a Minecraft version must not
// be reported as one. See detectFromJar's version.json handling for the case
// that made this necessary.
var (
	reMCRelease  = regexp.MustCompile(`^1\.[0-9]+(\.[0-9]+)?(-(pre|rc)[0-9]+)?$`)
	reMCSnapshot = regexp.MustCompile(`^[0-9]{2}w[0-9]{2}[a-z]$`)
)

func isMCVersion(v string) bool {
	return reMCRelease.MatchString(v) || reMCSnapshot.MatchString(v)
}

// sanitizeTarget drops a stored (MCVersion, Loader) pair that cannot be right.
//
// A stored Minecraft version that is not a Minecraft version condemns the
// loader recorded beside it: the two are always written together, by a single
// detection run, so a provably wrong version means that run's other answer is
// worth no more than its first. Discarding both lets detection re-derive them.
//
// This is the exact shape a Forge/NeoForge installer used to leave behind —
// MCVersion "neoforge-21.1.233" and Loader "vanilla", from an installer's
// version.json read as a server's — and it has to be repaired on read, because
// nothing re-derives a config once it has been written.
func sanitizeTarget(mcVersion, loader string) (string, string) {
	if mcVersion != "" && !isMCVersion(mcVersion) {
		return "", ""
	}
	return mcVersion, loader
}

// detectServerLoader inspects a server's install and (as fallback) its latest
// log to suggest an MCVersion and Loader for ServerConfig. Returns the
// suggested values; the caller should treat them as pre-filled defaults, not
// authoritative.
//
// The order is deliberate, cheapest and most certain first:
//
//  1. The configured jar, which answers outright for a vanilla or Fabric server
//     and identifies a Forge/NeoForge *installer* rather than misreading it.
//  2. The loader build under libraries/, which NeoForge and Forge encode in the
//     argfile path. This needs no log and no prior start, so it is the answer
//     for a modern NeoForge install — which has no runnable jar at all — the
//     moment it is added.
//  3. The latest log, which is the only source for a server Konnekt can read
//     nothing else about, and the least reliable of the three.
func detectServerLoader(cfg struct{ JarPath, WorkingDir string }) (mcVersion, loader string) {
	mcVersion, loader = detectFromJar(cfg.JarPath)

	if mcVersion == "" || loader == "" {
		mv, ld := detectFromInstallDir(cfg.JarPath, cfg.WorkingDir)
		if mcVersion == "" {
			mcVersion = mv
		}
		if loader == "" {
			loader = ld
		}
	}

	if mcVersion == "" || loader == "" {
		mv, ld := detectFromLog(cfg.WorkingDir)
		if mcVersion == "" {
			mcVersion = mv
		}
		if loader == "" {
			loader = ld
		}
	}
	return
}

// resolveTarget is the (Minecraft version, loader) pair every Modrinth query is
// filtered by, with the same detection fallback ServerService.Summary has used
// all along.
//
// Reading the stored pair alone is how a server that was described wrongly once
// stays described wrongly forever: nothing re-derives it, and the two fields are
// invisible in the UI, so a stale or malformed value silently filters every
// search and version list down to nothing. Modrinth answers an unknown game
// version with an empty list and HTTP 200, so the failure arrives looking like
// "there is nothing for your server" rather than like a bug.
//
// A stored value still wins when it is plausible: the user can override both
// fields in the server editor, and an override is the whole point of having one.
func resolveTarget(cfg models.ServerConfig) (mcVersion, loader string) {
	mcVersion, loader = sanitizeTarget(cfg.MCVersion, cfg.Loader)
	if mcVersion != "" && loader != "" {
		return mcVersion, loader
	}

	detectedMC, detectedLoader := detectServerLoader(struct{ JarPath, WorkingDir string }{
		JarPath:    cfg.JarPath,
		WorkingDir: cfg.WorkingDir,
	})
	if mcVersion == "" {
		mcVersion = detectedMC
	}
	if loader == "" {
		loader = detectedLoader
	}
	return mcVersion, loader
}

// detectFromInstallDir reads the loader build a Forge/NeoForge install launches
// with, and derives the Minecraft version and loader from it.
//
// Both projects name the argfile directory after the exact build, and
// detectLoaderVersion already parses that out of the launcher script. Forge
// writes the Minecraft version into the build string itself ("1.20.1-47.2.0");
// NeoForge encodes it as <mcMinor>.<mcPatch>.<build>, which mcVersionForNeoForge
// already converts ("21.1.233" -> "1.21.1"). This is the join between those two
// existing pieces, and it is what lets a modern NeoForge server — which has no
// runnable jar at all — describe itself correctly before it is ever started.
func detectFromInstallDir(jarPath, workingDir string) (mcVersion, loader string) {
	version, source := detectLoaderVersion(jarPath, workingDir)
	if version == "" || source == "" {
		return "", ""
	}

	// Forge writes "<mc>-<build>"; NeoForge writes "<mcMinor>.<mcPatch>.<build>".
	if mc, _, ok := strings.Cut(version, "-"); ok && isMCVersion(mc) {
		return mc, "forge"
	}
	if mc := mcVersionForNeoForge(version); mc != "" {
		return mc, "neoforge"
	}
	return "", ""
}

func detectFromJar(jarPath string) (mcVersion, loader string) {
	if jarPath == "" {
		return
	}

	// A Forge/NeoForge installer is not a server, and reading it as one is
	// actively harmful rather than merely useless: its version.json carries the
	// loader *profile* name ("neoforge-21.1.233") in the same "id" field a
	// vanilla server jar uses for the Minecraft version, and it carries none of
	// the loader markers below. Read naively it yields
	// mcVersion="neoforge-21.1.233", loader="vanilla" — two wrong answers that
	// look confident, get persisted, and then filter every Modrinth query down
	// to nothing. InspectInstaller reads install_profile.json and answers
	// correctly, so ask it first.
	if info, err := InspectInstaller(jarPath); err == nil && info.IsInstaller {
		return info.MCVersion, info.Loader
	}

	r, err := zip.OpenReader(jarPath)
	if err != nil {
		return
	}
	defer r.Close()

	entries := make(map[string]*zip.File, len(r.File))
	for _, f := range r.File {
		entries[f.Name] = f
	}

	// Vanilla / Fabric server jars embed version.json with {"id":"1.20.1"}.
	// Validated rather than trusted: "id" is whatever profile the jar belongs
	// to, and only a vanilla-lineage jar makes that a Minecraft version.
	if f, ok := entries["version.json"]; ok {
		if v := readVersionJSON(f); isMCVersion(v) {
			mcVersion = v
		}
	}

	// Fabric server installs have a fabric-installer marker or net/fabricmc path
	for name := range entries {
		if strings.HasPrefix(name, "net/fabricmc/") {
			loader = "fabric"
			return
		}
	}

	// Forge/NeoForge: META-INF/mods.toml or neoforge.mods.toml
	if _, ok := entries["META-INF/neoforge.mods.toml"]; ok {
		loader = "neoforge"
		return
	}
	if _, ok := entries["META-INF/mods.toml"]; ok {
		loader = "forge"
		return
	}

	// Bukkit/Paper/Spigot: META-INF/services with Bukkit marker
	if f, ok := entries["META-INF/MANIFEST.MF"]; ok {
		data, _ := readZipEntry(f)
		content := string(data)
		if strings.Contains(content, "papermc") || strings.Contains(content, "io.papermc") {
			loader = "paper"
			return
		}
		if strings.Contains(content, "org.bukkit") {
			loader = "bukkit"
			return
		}
		if strings.Contains(content, "org.spigotmc") {
			loader = "spigot"
			return
		}
	}

	// A jar carrying a real Minecraft version and none of the loader markers is
	// a vanilla server jar. This is a positive finding, not a fallback: it used
	// to fire on *any* jar that yielded a version-shaped string, which is how an
	// installer came to be labelled vanilla. isMCVersion above is what makes the
	// inference sound.
	if loader == "" && mcVersion != "" {
		loader = "vanilla"
	}
	return
}

type versionJSON struct {
	ID string `json:"id"`
}

func readVersionJSON(f *zip.File) string {
	data, err := readZipEntry(f)
	if err != nil {
		return ""
	}
	var v versionJSON
	if err := json.Unmarshal(data, &v); err != nil {
		return ""
	}
	return v.ID
}

var (
	reLogMCVersion  = regexp.MustCompile(`\(MC:\s*([0-9]+\.[0-9]+(?:\.[0-9]+)?)\)`)
	reLogFabric     = regexp.MustCompile(`(?i)fabric\s+loader`)
	reLogPaper      = regexp.MustCompile(`(?i)This server is running (Paper|Spigot|Purpur|CraftBukkit)`)
	reLogForge      = regexp.MustCompile(`(?i)Forge\s+mod\s+loader`)
	reLogNeoForge   = regexp.MustCompile(`(?i)NeoForge`)
	reLogMCVersion2 = regexp.MustCompile(`(?i)Starting minecraft server version ([0-9]+\.[0-9]+(?:\.[0-9]+)?)`)
	reLogLoadingMC  = regexp.MustCompile(`(?i)Loading Minecraft\s+([0-9]+\.[0-9]+(?:\.[0-9]+)?)`)

	// FML puts the Minecraft version on ModLauncher's argument line, which is
	// the *first* line of a Forge/NeoForge log. Every other pattern here waits
	// for vanilla's "Starting minecraft server version", which on a large
	// modpack lands thousands of lines later, after all the mod scanning.
	// Matching the args line means the version and the loader are both settled
	// on line one, instead of the loader matching immediately and the version
	// never arriving.
	reLogFMLMCVersion = regexp.MustCompile(`--fml\.mcVersion[,\s]+([0-9]+\.[0-9]+(?:\.[0-9]+)?)`)
)

// logScanLines bounds detectFromLog. The version line on a heavily modded
// NeoForge server sits well past a thousand lines of mixin and mod-scan output,
// and the old 500-line cap stopped short of it — which left the loader detected
// (it matches on line one) and the Minecraft version empty. Reading is cheap
// and bounded either way; the scan stops as soon as both answers are in hand.
const logScanLines = 5000

func detectFromLog(workingDir string) (mcVersion, loader string) {
	logPath := filepath.Join(workingDir, "logs", "latest.log")
	f, err := os.Open(logPath)
	if err != nil {
		return
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1024*1024), 1024*1024)

	lineCount := 0
	for sc.Scan() && lineCount < logScanLines {
		line := sc.Text()
		lineCount++

		if mcVersion == "" {
			if m := reLogFMLMCVersion.FindStringSubmatch(line); m != nil {
				mcVersion = m[1]
			} else if m := reLogMCVersion.FindStringSubmatch(line); m != nil {
				mcVersion = m[1]
			} else if m := reLogMCVersion2.FindStringSubmatch(line); m != nil {
				mcVersion = m[1]
			} else if m := reLogLoadingMC.FindStringSubmatch(line); m != nil {
				mcVersion = m[1]
			}
			// Every pattern above is version-shaped, but a log is the least
			// trustworthy source here and the cost of a wrong answer is an
			// empty mods tile, so hold them to the same bar as the jar.
			if mcVersion != "" && !isMCVersion(mcVersion) {
				mcVersion = ""
			}
		}

		if loader == "" {
			switch {
			case reLogNeoForge.MatchString(line):
				loader = "neoforge"
			case reLogForge.MatchString(line):
				loader = "forge"
			case reLogFabric.MatchString(line):
				loader = "fabric"
			default:
				if m := reLogPaper.FindStringSubmatch(line); m != nil {
					loader = strings.ToLower(m[1])
					if loader == "craftbukkit" {
						loader = "bukkit"
					}
				}
			}
		}

		if mcVersion != "" && loader != "" {
			return
		}
	}
	return
}

// --- Utility ---

const maxJarEntrySize = 4 * 1024 * 1024 // 4 MB cap to avoid zip-bomb reads

func readZipEntry(f *zip.File) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return io.ReadAll(io.LimitReader(rc, maxJarEntrySize))
}
