package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"
	"time"
	"unicode"

	"konnekt/backend/models"
)

var configExtensions = map[string]string{
	".properties": "properties",
	".yml":        "yaml",
	".yaml":       "yaml",
	".toml":       "toml",
	".json":       "json",
	".json5":      "json5",
	".conf":       "text",
	".cfg":        "text",
}

// serverRootNames lists config files expected directly in the server working directory.
var serverRootNames = map[string]bool{
	"server.properties":        true,
	"spigot.yml":               true,
	"bukkit.yml":               true,
	"paper.yml":                true,
	"paper-global.yml":         true,
	"paper-world-defaults.yml": true,
	"pufferfish.yml":           true,
	"purpur.yml":               true,
	"commands.yml":             true,
	"help.yml":                 true,
	"permissions.yml":          true,
}

const backupKeep = 3

type ConfigEditorService struct {
	appConfig *ConfigService
	dataDir   string
}

func NewConfigEditorService(appConfig *ConfigService) *ConfigEditorService {
	return &ConfigEditorService{appConfig: appConfig}
}

func (s *ConfigEditorService) SetDataDir(dir string) {
	s.dataDir = dir
}

// configLocation is where the editor files one config file: the category and
// plugin or mod folder it shows under, and the format its editor uses.
type configLocation struct {
	category, source, format string
}

// classifyConfigPath is the single answer to "is this a config file the editor
// offers, and as what". ListConfigFiles asks it of every directory entry and
// the read and write gates ask it of the caller's path, so what is listed and
// what is reachable cannot drift apart (#431). It is a predicate over the path
// alone, not over the disk, because the write path is legitimately reached for
// a file that is not there yet (server.properties on a fresh server). rel is
// slash-separated and already canonical, see listedConfigPath.
//
// Names are matched case-sensitively, as the listing always has: a name the
// listing would not have produced is not one it offers, whatever the host
// filesystem thinks of case.
func classifyConfigPath(rel string) (configLocation, bool) {
	parts := strings.Split(rel, "/")
	name := parts[len(parts)-1]
	format := extFormat(name)
	if format == "" {
		return configLocation{}, false
	}
	switch len(parts) {
	case 1:
		// Server root: a fixed set of names, never "any config-looking file".
		if serverRootNames[name] {
			return configLocation{"server", "", format}, true
		}
	case 2:
		switch parts[0] {
		case "plugins":
			return configLocation{"plugins", "", format}, true
		case "config":
			// Paper and Purpur keep their configs here, everything else is a mod's.
			if strings.HasPrefix(name, "paper-") || strings.HasPrefix(name, "purpur-") {
				return configLocation{"server", "", format}, true
			}
			return configLocation{"mods", "", format}, true
		}
	case 3:
		folder := parts[1]
		if folder == "" || strings.HasPrefix(folder, ".") {
			return configLocation{}, false
		}
		switch parts[0] {
		case "plugins":
			if !strings.EqualFold(folder, "update") {
				return configLocation{"plugins", folder, format}, true
			}
		case "config":
			return configLocation{"mods", folder, format}, true
		}
	}
	return configLocation{}, false
}

// errNotListedConfig is the refusal for a path the config editor does not
// offer. It is distinct from errOutsideWorkDir: the path may be perfectly
// inside the working directory, it is just not a config file (run.sh, a jar,
// user_jvm_args.txt), and a remote session must not read or replace those.
var errNotListedConfig = errors.New("not a config file the editor lists")

// listedConfigPath refuses any relPath classifyConfigPath would not list. It
// runs before sandbox, which stays as the second layer. Separators are
// normalised so a Windows path with backslashes names the same file the
// listing's slash form does, and anything not already canonical after that
// ("./a", "a//b", "plugins/../run.sh", a leading slash) is refused instead of
// cleaned, because the listing only ever produces canonical paths and so does
// every legitimate caller.
func listedConfigPath(relPath string) error {
	rel := filepath.ToSlash(relPath)
	if rel == "" || path.Clean(rel) != rel {
		return errNotListedConfig
	}
	// Segments Windows resolves to a different name than the one classified,
	// refused on every platform so the accepted names stay portable: ":" is an
	// NTFS alternate data stream ("evil.jar:x.yml" classifies as yaml but
	// addresses a stream on evil.jar), a trailing dot or space is stripped
	// ("update./x.yml" reaches the excluded update folder), and control
	// characters have no business in a config path.
	for _, seg := range strings.Split(rel, "/") {
		if strings.ContainsRune(seg, ':') || strings.HasSuffix(seg, ".") || strings.HasSuffix(seg, " ") ||
			strings.IndexFunc(seg, unicode.IsControl) >= 0 {
			return errNotListedConfig
		}
	}
	if _, ok := classifyConfigPath(rel); !ok {
		return errNotListedConfig
	}
	return nil
}

// ListConfigFiles scans the server's working directory and returns discoverable
// config files grouped into Server / Plugins / Mods categories.
func (s *ConfigEditorService) ListConfigFiles(serverID string) ([]models.ConfigFile, error) {
	workDir, err := s.workingDir(serverID)
	if err != nil {
		return nil, err
	}

	var files []models.ConfigFile

	// scan lists the plain files directly in dir (relDir is its slash-form path
	// under workDir) that classifyConfigPath accepts and files under one of
	// cats. The category filter is what keeps the passes below in their
	// original order: server, then plugins, then mods.
	scan := func(entries []os.DirEntry, dir, relDir string, cats ...string) {
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			loc, ok := classifyConfigPath(path.Join(relDir, e.Name()))
			if !ok || !slices.Contains(cats, loc.category) {
				continue
			}
			// Info fails only when the entry vanished between ReadDir and here, and
			// makeConfigFile dereferences it, so a file deleted mid-listing used to
			// be a nil-pointer panic. Skipping it is the truthful listing.
			info, err := e.Info()
			if err != nil {
				continue
			}
			files = append(files, makeConfigFile(workDir, filepath.Join(dir, e.Name()), info, loc.category, loc.source, loc.format))
		}
	}
	// scanSub does the same one folder down, for the directory entries. The
	// classifier decides which folders count (not "update", nothing dotted).
	scanSub := func(entries []os.DirEntry, dir, relDir string) {
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			subDir := filepath.Join(dir, e.Name())
			subEntries, err := os.ReadDir(subDir)
			if err != nil {
				slog.Debug("config: subdirectory unreadable", "dir", subDir, "error", err)
			}
			scan(subEntries, subDir, path.Join(relDir, e.Name()), "plugins", "mods")
		}
	}

	// --- Server root files ---
	// An unreadable working directory lists as empty rather than failing the
	// tile: a server that has not been installed yet has no directory at all,
	// and the optional subdirectories below already degrade the same way.
	rootEntries, err := os.ReadDir(workDir)
	if err != nil {
		slog.Debug("config: working directory unreadable", "dir", workDir, "error", err)
	}
	scan(rootEntries, workDir, "", "server")

	// Paper-specific configs in config/ subdir (paper-*.yml, purpur-*.yml)
	configDir := filepath.Join(workDir, "config")
	cfgEntries, cfgErr := os.ReadDir(configDir)
	if cfgErr == nil {
		scan(cfgEntries, configDir, "config", "server")
	}

	// --- Plugins (depth 2 under plugins/) ---
	pluginsDir := filepath.Join(workDir, "plugins")
	if _, err := os.Stat(pluginsDir); err == nil {
		pEntries, err := os.ReadDir(pluginsDir)
		if err != nil {
			slog.Debug("config: plugins directory unreadable", "dir", pluginsDir, "error", err)
		}
		// Files directly in plugins/, then one level of plugin subdirectories.
		scan(pEntries, pluginsDir, "plugins", "plugins")
		scanSub(pEntries, pluginsDir, "plugins")
	}

	// --- Mods: config/ (excluding paper/purpur prefixed files) ---
	if cfgErr == nil {
		scan(cfgEntries, configDir, "config", "mods")
		scanSub(cfgEntries, configDir, "config")
	}

	return files, nil
}

// ReadConfigFile reads a config file the editor lists for the server, then
// sandbox-checks it against the working dir.
func (s *ConfigEditorService) ReadConfigFile(serverID, relPath string) (string, error) {
	workDir, err := s.workingDir(serverID)
	if err != nil {
		return "", err
	}
	if err := listedConfigPath(relPath); err != nil {
		return "", err
	}
	abs, err := s.sandbox(workDir, relPath)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// WriteConfigFile refuses a path the editor does not list, validates (JSON only
// for now), backs up, then writes a config file.
func (s *ConfigEditorService) WriteConfigFile(serverID, relPath, content string) error {
	workDir, err := s.workingDir(serverID)
	if err != nil {
		return err
	}
	if err := listedConfigPath(relPath); err != nil {
		return err
	}
	abs, err := s.sandbox(workDir, relPath)
	if err != nil {
		return err
	}

	// Validate JSON before writing
	if strings.HasSuffix(strings.ToLower(relPath), ".json") {
		var v any
		if err := json.Unmarshal([]byte(content), &v); err != nil {
			return fmt.Errorf("invalid JSON: %w", err)
		}
	}

	if err := s.backup(serverID, abs, relPath); err != nil {
		return fmt.Errorf("backup failed: %w", err)
	}

	return writeFileAtomic(abs, []byte(content), 0644)
}

// workingDir resolves a server's working directory and refuses an empty one.
// filepath.Join("", rel) is the relative path rel, so an unconfigured server
// would otherwise read and write files in whatever directory Konnekt was
// launched from, the same case datadir.go guards for the app data dir. The
// sandbox happened to reject the empty case too, but as "path outside working
// directory", which names the wrong problem.
func (s *ConfigEditorService) workingDir(serverID string) (string, error) {
	cfg, err := s.appConfig.GetServerConfig(serverID)
	if err != nil {
		return "", err
	}
	if cfg.WorkingDir == "" {
		return "", fmt.Errorf("server %q has no working directory", serverID)
	}
	return cfg.WorkingDir, nil
}

// eulaContent is what AcceptEula writes. The server reads only the eula=true
// line; the comment records who wrote it.
const eulaContent = "# EULA accepted via Konnekt\neula=true\n"

// AcceptEula writes eula.txt into the server's working directory, atomically.
// The file is what the server checks before it will boot, and a raw
// os.WriteFile could leave a half-written one for a crash between open and
// close (#259, the shape #116 closed everywhere else). Deliberately not
// WriteConfigFile: that path snapshots the previous file into config_backups
// and prunes, right for a file the user edits and noise for a one-line flag.
// The working directory is not created here: an unconfigured or deleted
// server directory is a failure to report, not one to paper over.
func (s *ConfigEditorService) AcceptEula(serverID string) error {
	wd, err := s.workingDir(serverID)
	if err != nil {
		return err
	}
	return writeFileAtomic(filepath.Join(wd, "eula.txt"), []byte(eulaContent), 0644)
}

// errOutsideWorkDir is what every escape looks like from the caller's side,
// whichever of sandbox's two tests caught it.
var errOutsideWorkDir = errors.New("path outside working directory")

// sandbox resolves relPath against workDir and refuses anything that lands
// outside it. Two tests, because a path string and a filesystem can disagree.
// The lexical one, filepath.Clean plus a prefix test, catches "..". It cannot
// see a symlink: a link inside the working directory pointing outside it
// passes the string test and then resolves outside (#283). So the second test
// resolves what is on disk with filepath.EvalSymlinks and compares again. The
// target itself may not exist yet, since this runs on the write path for new
// files, so its nearest existing ancestor stands in for it: the components
// below that do not exist cannot be links. When the working directory itself
// is not on disk there is nothing to resolve through and the lexical answer
// stands; the read or write that follows reports the missing directory.
// Returns the lexical path rather than the resolved one, so the caller's I/O
// still goes through a link that points inside (a symlinked world folder is
// a real layout, and refusing it would be the wrong lesson from #283).
func (s *ConfigEditorService) sandbox(workDir, relPath string) (string, error) {
	clean := filepath.Clean(filepath.Join(workDir, relPath))
	wd := filepath.Clean(workDir)
	if !withinDir(clean, wd) {
		return "", errOutsideWorkDir
	}
	realWd, err := filepath.EvalSymlinks(wd)
	if errors.Is(err, fs.ErrNotExist) {
		return clean, nil
	}
	if err != nil {
		return "", err
	}
	real, err := evalNearestExisting(clean)
	if err != nil {
		return "", err
	}
	if !withinDir(real, realWd) {
		return "", errOutsideWorkDir
	}
	return clean, nil
}

// withinDir reports whether path is dir itself or beneath it. Both arguments
// are already cleaned, and for the physical test both already resolved.
func withinDir(path, dir string) bool {
	return path == dir || strings.HasPrefix(path, dir+string(filepath.Separator))
}

// evalNearestExisting resolves symlinks in path, or, when path itself is not
// on disk, in its nearest ancestor that is.
func evalNearestExisting(path string) (string, error) {
	for {
		real, err := filepath.EvalSymlinks(path)
		if err == nil {
			return real, nil
		}
		if !errors.Is(err, fs.ErrNotExist) {
			return "", err
		}
		parent := filepath.Dir(path)
		if parent == path {
			return "", err
		}
		path = parent
	}
}

func (s *ConfigEditorService) backup(serverID, abs, relPath string) error {
	if err := validServerID(serverID); err != nil {
		return err
	}
	if _, err := os.Stat(abs); os.IsNotExist(err) {
		return nil // nothing to back up for new files
	}

	escaped := strings.ReplaceAll(filepath.ToSlash(relPath), "/", "__")
	backupDir := filepath.Join(s.dataDir, "config_backups", serverID)
	// A backup of server.properties carries the RCON password, so the
	// directory is owner-only. MkdirAll leaves an existing directory as it
	// found it, and older versions made this one 0755, so narrow it
	// explicitly; that also hides any 0644 .bak files already inside.
	if err := os.MkdirAll(backupDir, 0700); err != nil {
		return err
	}
	if err := os.Chmod(backupDir, 0700); err != nil {
		return err
	}

	dst, err := createConfigBackupFile(backupDir, escaped)
	if err != nil {
		return err
	}
	defer dst.Close()

	src, err := os.Open(abs)
	if err != nil {
		return err
	}
	defer src.Close()
	if _, err := io.Copy(dst, src); err != nil {
		return err
	}

	s.pruneBackups(backupDir, escaped)
	return nil
}

// createConfigBackupFile creates the .bak copy under a name nothing else holds.
//
// The stamp used to be second resolution and the create used to be os.Create,
// which truncates: two saves inside the same second collapsed onto one filename
// and left one backup where there should have been two. Harmless while a human is
// hand-editing, wrong the moment anything writes config programmatically.
//
// Milliseconds plus O_EXCL fix it from both ends. The milliseconds are joined with
// an underscore rather than a dot on purpose: pruneBackups deletes the
// lexicographically first name, relying on this stamp sorting in chronological
// order, and '.' (0x2E) sorts before '_' (0x5F). So a legacy
// "…150405.bak" still sorts before a new "…150405_123.bak" from the same second,
// and the older file is still the one pruned first. With ".123" it would have
// sorted after, and pruning would have started deleting the newest backups.
//
// The millisecond field is appended by hand because Go's fractional-second layout
// is spelled ".000" or ",000": a "_000" in the layout string is not a directive at
// all, and formats as the literal text 000.
func createConfigBackupFile(backupDir, escaped string) (*os.File, error) {
	for attempt := 0; attempt < 100; attempt++ {
		now := time.Now()
		ts := now.Format("20060102_150405") + fmt.Sprintf("_%03d", now.Nanosecond()/int(time.Millisecond))
		path := filepath.Join(backupDir, escaped+"."+ts+".bak")
		f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err == nil {
			return f, nil
		}
		if !os.IsExist(err) {
			return nil, err
		}
		// Same millisecond as an existing backup. Wait for the clock rather than
		// spinning on it; on Windows the tick is coarse enough to matter.
		time.Sleep(time.Millisecond)
	}
	return nil, errors.New("no free config backup filename after 100 attempts")
}

func (s *ConfigEditorService) pruneBackups(dir, prefix string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	var matching []string
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), prefix+".") && strings.HasSuffix(e.Name(), ".bak") {
			matching = append(matching, e.Name())
		}
	}
	for i := 0; i < len(matching)-backupKeep; i++ {
		_ = os.Remove(filepath.Join(dir, matching[i])) //nolint:errcheck // best-effort retention pruning; a leftover .bak file is harmless
	}
}

func makeConfigFile(workDir, abs string, info os.FileInfo, category, source, format string) models.ConfigFile {
	// Every caller builds abs by joining workDir, so the relative path exists by
	// construction; the only way Rel fails is a different volume, which a Join
	// of the same root cannot produce.
	rel, _ := filepath.Rel(workDir, abs) //nolint:errcheck // abs is under workDir by construction (see above)
	return models.ConfigFile{
		RelPath:   filepath.ToSlash(rel),
		Name:      info.Name(),
		Category:  category,
		Source:    source,
		Format:    format,
		SizeBytes: info.Size(),
		Modified:  info.ModTime().UnixMilli(),
	}
}

func extFormat(name string) string {
	ext := strings.ToLower(filepath.Ext(name))
	return configExtensions[ext]
}
