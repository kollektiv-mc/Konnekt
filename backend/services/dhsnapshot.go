package services

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// This file is the read side of the Distant Horizons snapshot (#481): which
// databases a server has, what DH's config says about how clients map them, and
// which DH build wrote them. It reads DH's databases' *locations*, DH's config
// and the DH jar's name and manifest, and nothing else in the server. It opens
// no database: a snapshot copies the stopped file as bytes (dhsnapshot_index.go).
//
// Pure library. No bound method, no scheduler block, no network.

const (
	// dhDatabaseName is the file DH keeps in each dimension's data folder.
	dhDatabaseName = "DistantHorizons.sqlite"

	// dhConfigFile is DH's server config, relative to the server's working
	// directory.
	dhConfigFile = "config/DistantHorizons.toml"

	// dhIDMaxLen is DH's own length limit for a server key and a level key
	// (LevelInitMessage.MAX_LENGTH, core 3.3.3), with the charset in
	// reDHKeyChars. A client refuses a message outside them, so a folder name
	// outside them could never be reached by a player.
	dhIDMaxLen = 150
)

var (
	reDHKeyChars = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)
	reDHServerID = regexp.MustCompile(`^-?[0-9]+$`)
	// reDHLevelKey is "<prefix>@<namespace>:<path>", each part in DH's charset.
	reDHLevelKey = regexp.MustCompile(`^[A-Za-z0-9_-]+@[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$`)
)

// DHConfig is the part of config/DistantHorizons.toml the snapshot needs.
type DHConfig struct {
	// Found is false when the file does not exist: DH writes it on first start,
	// so a server that never ran DH has none.
	Found bool
	// ServerKey makes every client store the server's LODs under
	// "<serverId>_<serverKey>" instead of a folder named after its server list
	// entry. Empty when unset.
	ServerKey string
	// LevelKeyPrefix is the first half of the level folder name on the client.
	// Empty means DH derives it from a hash of the seed, which Konnekt cannot
	// recompute.
	LevelKeyPrefix string
}

// readDHConfig extracts serverKey and levelKeyPrefix from DH's TOML with a line
// scan. DH's file nests its settings in tables and the two keys are unique in
// it, so table headers are skipped rather than tracked. A missing file is not
// an error: it reads as every setting empty, which the refusals then name.
func readDHConfig(path string) (DHConfig, error) {
	f, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return DHConfig{}, nil
	}
	if err != nil {
		return DHConfig{}, fmt.Errorf("open %s: %w", path, err)
	}
	defer f.Close()

	cfg := DHConfig{Found: true}
	seen := map[string]bool{}
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	for sc.Scan() {
		key, value, ok := dhTomlAssignment(sc.Text())
		if !ok || seen[key] {
			continue
		}
		switch key {
		case "serverKey":
			cfg.ServerKey = value
		case "levelKeyPrefix":
			cfg.LevelKeyPrefix = value
		default:
			continue
		}
		seen[key] = true
	}
	if err := sc.Err(); err != nil {
		return DHConfig{}, fmt.Errorf("read %s: %w", path, err)
	}
	return cfg, nil
}

// dhTomlAssignment splits one line into key and string value. Comments, blank
// lines and table headers yield ok=false. A basic string ("...") honours \" and
// \\, a literal string ('...') takes everything to the closing quote, and a
// bare value runs to a '#'. Anything after a closing quote is a trailing
// comment and ignored.
func dhTomlAssignment(line string) (key, value string, ok bool) {
	line = strings.TrimSpace(line)
	if line == "" || line[0] == '#' || line[0] == '[' {
		return "", "", false
	}
	k, v, found := strings.Cut(line, "=")
	if !found {
		return "", "", false
	}
	key = strings.TrimSpace(k)
	v = strings.TrimSpace(v)
	if key == "" {
		return "", "", false
	}
	switch {
	case strings.HasPrefix(v, `"`):
		var b strings.Builder
		for i := 1; i < len(v); i++ {
			switch c := v[i]; {
			case c == '\\' && i+1 < len(v):
				i++
				b.WriteByte(v[i])
			case c == '"':
				return key, b.String(), true
			default:
				b.WriteByte(c)
			}
		}
		return key, b.String(), true // unterminated: take what is there
	case strings.HasPrefix(v, `'`):
		rest := v[1:]
		if end := strings.IndexByte(rest, '\''); end >= 0 {
			rest = rest[:end]
		}
		return key, rest, true
	default:
		if hash := strings.IndexByte(v, '#'); hash >= 0 {
			v = v[:hash]
		}
		return key, strings.TrimSpace(v), true
	}
}

// checkDHConfig refuses a config a client could not map a snapshot with. Each
// message names the setting, because the fix is to add it to the file while the
// server is stopped (the level key is built when a level loads).
func checkDHConfig(cfg DHConfig) error {
	if !cfg.Found {
		return fmt.Errorf("%s was not found: start the server once with Distant Horizons installed, then set serverKey and levelKeyPrefix in it", dhConfigFile)
	}
	if cfg.ServerKey == "" {
		return fmt.Errorf("serverKey is empty in %s: set it so every client stores the snapshot under one folder", dhConfigFile)
	}
	if !reDHKeyChars.MatchString(cfg.ServerKey) || len(cfg.ServerKey) > dhIDMaxLen {
		return fmt.Errorf("serverKey in %s must be 1 to %d characters of letters, digits, '_' and '-'", dhConfigFile, dhIDMaxLen)
	}
	if cfg.LevelKeyPrefix == "" {
		return fmt.Errorf("levelKeyPrefix is empty in %s: set it to the current level key prefix so clients can map the folder", dhConfigFile)
	}
	if !reDHKeyChars.MatchString(cfg.LevelKeyPrefix) {
		return fmt.Errorf("levelKeyPrefix in %s must be letters, digits, '_' and '-'", dhConfigFile)
	}
	return nil
}

// dhServerFolder is the folder every client keeps the server's LODs in:
// "<serverId>_<serverKey>" (ServerPlayerState). serverId is DH's `serverId`
// setting, an int the server generates once; where Konnekt reads it from on a
// given server is the snapshot block's job (#481), so it comes in as a value.
func dhServerFolder(serverID, serverKey string) (string, error) {
	if !reDHServerID.MatchString(serverID) {
		return "", fmt.Errorf("serverId %q is not an integer", serverID)
	}
	folder := serverID + "_" + serverKey
	if !reDHKeyChars.MatchString(folder) || len(folder) > dhIDMaxLen {
		return "", fmt.Errorf("server folder %q must be 1 to %d characters of letters, digits, '_' and '-'", folder, dhIDMaxLen)
	}
	return folder, nil
}

// DHLevel is one dimension's database on the server.
type DHLevel struct {
	// Dimension is the vanilla id, "minecraft:overworld".
	Dimension string
	// Folder is the level folder on the client: "<levelKeyPrefix>@<dimension>"
	// with ':' turned into "@@" (ClientOnlySaveStructure.getSaveFolderByLevelId).
	Folder string
	// Path is the database file on the server.
	Path string
}

// dhLevelFolder builds the client folder name for a dimension, refusing one DH
// would not accept as a level key.
func dhLevelFolder(prefix, dimension string) (string, error) {
	key := prefix + "@" + dimension
	if !reDHLevelKey.MatchString(key) || len(key) > dhIDMaxLen {
		return "", fmt.Errorf("dimension %s cannot be a Distant Horizons level key: use letters, digits, '_' and '-' in its id, at most %d characters in all", dimension, dhIDMaxLen)
	}
	return strings.ReplaceAll(key, ":", "@@"), nil
}

// discoverDHLevels finds the databases under a world folder, one per dimension
// that has generated LODs. The four shapes, where DH's save structure puts the
// vanilla data folder:
//
//	<world>/data/                        minecraft:overworld
//	<world>/DIM-1/data/                  minecraft:the_nether
//	<world>/DIM1/data/                   minecraft:the_end
//	<world>/dimensions/<ns>/<path>/data/ <ns>:<path>
//
// A dimension folder without a database is skipped. A <path> with slashes in it
// is not looked for, since DH's level key cannot hold one. The result is sorted
// by dimension id.
func discoverDHLevels(worldDir, levelKeyPrefix string) ([]DHLevel, error) {
	type candidate struct{ dimension, dataDir string }
	candidates := []candidate{
		{"minecraft:overworld", filepath.Join(worldDir, "data")},
		{"minecraft:the_nether", filepath.Join(worldDir, "DIM-1", "data")},
		{"minecraft:the_end", filepath.Join(worldDir, "DIM1", "data")},
	}

	root := filepath.Join(worldDir, "dimensions")
	namespaces, err := os.ReadDir(root)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("read %s: %w", root, err)
	}
	for _, ns := range namespaces {
		if !ns.IsDir() {
			continue
		}
		nsDir := filepath.Join(root, ns.Name())
		paths, err := os.ReadDir(nsDir)
		if err != nil {
			return nil, fmt.Errorf("read %s: %w", nsDir, err)
		}
		for _, p := range paths {
			if p.IsDir() {
				candidates = append(candidates, candidate{
					dimension: ns.Name() + ":" + p.Name(),
					dataDir:   filepath.Join(nsDir, p.Name(), "data"),
				})
			}
		}
	}

	var levels []DHLevel
	for _, c := range candidates {
		dbPath := filepath.Join(c.dataDir, dhDatabaseName)
		info, err := os.Stat(dbPath)
		if errors.Is(err, os.ErrNotExist) || (err == nil && !info.Mode().IsRegular()) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("stat %s: %w", dbPath, err)
		}
		folder, err := dhLevelFolder(levelKeyPrefix, c.dimension)
		if err != nil {
			return nil, err
		}
		levels = append(levels, DHLevel{Dimension: c.dimension, Folder: folder, Path: dbPath})
	}
	sort.Slice(levels, func(i, j int) bool { return levels[i].Dimension < levels[j].Dimension })
	return levels, nil
}

// dhJarVersion reads the Distant Horizons version from the DH jar in mods/. The
// jar is found by its file name, then identified and versioned from its own
// manifest through the same helpers the Mods tile uses, with the file name as
// the fallback when the manifest carries no version.
func dhJarVersion(workingDir string) (string, error) {
	modsDir := filepath.Join(workingDir, "mods")
	entries, err := os.ReadDir(modsDir)
	if err != nil {
		return "", fmt.Errorf("read %s: %w (Distant Horizons runs as a mod, so the server needs mods/)", modsDir, err)
	}
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasSuffix(strings.ToLower(name), ".jar") || !isDHName(name) {
			continue
		}
		jarPath := filepath.Join(modsDir, name)
		meta, err := parseJarMetaCached(jarPath, "")
		if err != nil {
			return "", err
		}
		if meta.ID != "" && !isDHName(meta.ID) {
			continue // a different mod whose file name mentions DH
		}
		if meta.Version != "" {
			return meta.Version, nil
		}
		if v := filenameHeuristic(jarPath).Version; v != "" {
			return v, nil
		}
		return "", fmt.Errorf("cannot read a version from %s", name)
	}
	return "", fmt.Errorf("no Distant Horizons jar found in %s: the snapshot reads the version from it", modsDir)
}

// isDHName reports whether a file name or mod id spells Distant Horizons,
// ignoring case and separators ("DistantHorizons-...", "distant-horizons").
func isDHName(s string) bool {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if r >= 'a' && r <= 'z' {
			b.WriteRune(r)
		}
	}
	return strings.Contains(b.String(), "distanthorizons")
}

// DHSnapshotSource is everything the index needs to know about a server before
// any database is read.
type DHSnapshotSource struct {
	DHVersion    string
	ServerFolder string
	Levels       []DHLevel
}

// resolveDHSnapshotSource gathers and checks the inputs: the config first,
// because a refusal there names a setting the person can fix, then the jar,
// then the databases. It reads no database and changes nothing, so it can run
// with the server still up. workingDir is the server's folder, worldDir its
// world (BackupService.worldPath) and serverID DH's `serverId` setting.
func resolveDHSnapshotSource(workingDir, worldDir, serverID string) (DHSnapshotSource, error) {
	cfg, err := readDHConfig(filepath.Join(workingDir, filepath.FromSlash(dhConfigFile)))
	if err != nil {
		return DHSnapshotSource{}, err
	}
	if err := checkDHConfig(cfg); err != nil {
		return DHSnapshotSource{}, err
	}
	serverFolder, err := dhServerFolder(serverID, cfg.ServerKey)
	if err != nil {
		return DHSnapshotSource{}, err
	}
	version, err := dhJarVersion(workingDir)
	if err != nil {
		return DHSnapshotSource{}, err
	}
	levels, err := discoverDHLevels(worldDir, cfg.LevelKeyPrefix)
	if err != nil {
		return DHSnapshotSource{}, err
	}
	if len(levels) == 0 {
		return DHSnapshotSource{}, fmt.Errorf("no %s found under %s", dhDatabaseName, worldDir)
	}
	return DHSnapshotSource{DHVersion: version, ServerFolder: serverFolder, Levels: levels}, nil
}
