package services

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// DHPartSize is the size of one snapshot part. 8 MiB is a PROVISIONAL value,
// pending dh_churn.py on two real Frangfurd backups (plan.md, "Measure"): it is
// the smallest size that stays above R2's 5 MiB minimum for UploadPartCopy, so
// the bucket can assemble whole files from the parts, and a synthetic test
// changed 33% of 8 MiB parts against 100% of 64 MiB ones. Real churn is
// unmeasured. This is the one place the number lives, and the snapshot block
// must not merge before the measurement is in.
//
// Changing it changes every part hash, so the first snapshot after a change
// uploads everything again. The index does not record it: a part's own size is
// listed, and a client concatenates parts in order.
const DHPartSize = 8 << 20

// dhIndexFormat is the index's `format`. A client refuses one it does not know.
const dhIndexFormat = 1

// DHPart is one part of a database: the SHA-256 that names it in the bucket
// (parts/<sha256>) and its length. Every part is DHPartSize long except a
// level's last, which is whatever remains.
type DHPart struct {
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

// DHIndexLevel is one database in the snapshot.
type DHIndexLevel struct {
	// Folder is the client's level folder, "<levelKeyPrefix>@<ns>@@<path>".
	Folder string `json:"folder"`
	Size   int64  `json:"size"`
	// SHA256 is the whole file's hash, so a client can check an assembled
	// database without trusting the parts one by one.
	SHA256 string   `json:"sha256"`
	Parts  []DHPart `json:"parts"`
}

// DHIndex is index.json (format 1), the contract Kapital Launcher reads
// (Kapital-Launcher#136).
type DHIndex struct {
	Format int `json:"format"`
	// CreatedAt is RFC 3339 in UTC and names the snapshot's folder.
	CreatedAt string `json:"createdAt"`
	// PartsBase is the parts folder's path relative to this index, so the index
	// can sit at any depth (the private-link layout is one deeper). A client
	// resolves it against the index's own URL and refuses an absolute URL or a
	// scheme in it.
	PartsBase string `json:"partsBase"`
	// DHVersion is the server's Distant Horizons version, so a client can refuse
	// a database newer than its own DH.
	DHVersion string `json:"dhVersion"`
	// ServerFolder is "<serverId>_<serverKey>": where a client puts the levels.
	ServerFolder string         `json:"serverFolder"`
	Levels       []DHIndexLevel `json:"levels"`
}

// Marshal renders the index as the JSON that is uploaded.
func (ix DHIndex) Marshal() ([]byte, error) {
	data, err := json.MarshalIndent(ix, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("encode index: %w", err)
	}
	return append(data, '\n'), nil
}

// parseDHIndex decodes an index.json, refusing a format it does not know. The
// previous snapshot's index comes through here.
func parseDHIndex(data []byte) (DHIndex, error) {
	var ix DHIndex
	if err := json.Unmarshal(data, &ix); err != nil {
		return DHIndex{}, fmt.Errorf("parse index: %w", err)
	}
	if ix.Format != dhIndexFormat {
		return DHIndex{}, fmt.Errorf("index format %d is not supported (want %d)", ix.Format, dhIndexFormat)
	}
	return ix, nil
}

// formatDHCreatedAt is the one rendering of a snapshot's time, in the index and
// in the object keys, so the two cannot disagree.
func formatDHCreatedAt(t time.Time) string {
	return t.UTC().Format(time.RFC3339)
}

// partSet is every part hash an index names, across all levels.
func (ix DHIndex) partSet() map[string]struct{} {
	set := map[string]struct{}{}
	for _, l := range ix.Levels {
		for _, p := range l.Parts {
			set[p.SHA256] = struct{}{}
		}
	}
	return set
}

// dhStage is where parts absent from the previous snapshot are copied to. An
// empty Dir hashes without copying.
type dhStage struct {
	Dir      string
	PartSize int64
}

// indexDHDatabase reads one database once, front to back, in parts. It hashes
// every part and the whole file in that single pass, and copies each part whose
// hash is not in known (and not already staged this run) to <Dir>/parts/<hash>.
// absent lists those parts in file order, each once.
//
// The file is read as bytes and never opened as a database, so it must be a
// stopped one: DH writes it while the server runs.
func (st dhStage) indexDHDatabase(dbPath, folder string, known map[string]struct{}, staged map[string]struct{}) (level DHIndexLevel, absent []DHPart, err error) {
	if st.PartSize <= 0 {
		return DHIndexLevel{}, nil, errors.New("part size must be positive")
	}
	f, err := os.Open(dbPath)
	if err != nil {
		return DHIndexLevel{}, nil, fmt.Errorf("open %s: %w", dbPath, err)
	}
	defer f.Close()

	level = DHIndexLevel{Folder: folder, Parts: []DHPart{}}
	whole := sha256.New()
	buf := make([]byte, st.PartSize)
	for {
		n, readErr := io.ReadFull(f, buf)
		if n > 0 {
			chunk := buf[:n]
			sum := sha256.Sum256(chunk)
			part := DHPart{SHA256: hex.EncodeToString(sum[:]), Size: int64(n)}
			level.Parts = append(level.Parts, part)
			level.Size += int64(n)
			whole.Write(chunk) // hash.Hash.Write never returns an error
			_, inPrev := known[part.SHA256]
			_, inRun := staged[part.SHA256]
			if !inPrev && !inRun {
				staged[part.SHA256] = struct{}{}
				absent = append(absent, part)
				if err := st.writePart(part.SHA256, chunk); err != nil {
					return DHIndexLevel{}, nil, err
				}
			}
		}
		if readErr == io.EOF || readErr == io.ErrUnexpectedEOF {
			break
		}
		if readErr != nil {
			return DHIndexLevel{}, nil, fmt.Errorf("read %s: %w", dbPath, readErr)
		}
	}
	level.SHA256 = hex.EncodeToString(whole.Sum(nil))
	return level, absent, nil
}

func (st dhStage) writePart(hash string, data []byte) error {
	if st.Dir == "" {
		return nil
	}
	dir := filepath.Join(st.Dir, "parts")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("create %s: %w", dir, err)
	}
	return writeFileAtomic(filepath.Join(dir, hash), data, 0644)
}

// stageDHSnapshot reads every level of src once and returns the new index and
// the parts the previous snapshot did not have. prev may be nil (the first
// snapshot: every part is absent). With a stage directory it also copies those
// parts to <stageDir>/parts/<hash>, which mirrors the bucket layout, so staging
// holds what changed and nothing else.
//
// keys supplies the index's partsBase and createdAt. A level's parts that match
// the previous index by hash are not copied again, wherever in the previous
// index they were.
func stageDHSnapshot(src DHSnapshotSource, prev *DHIndex, stageDir string, keys SnapshotKeys, partSize int64) (DHIndex, []DHPart, error) {
	known := map[string]struct{}{}
	if prev != nil {
		known = prev.partSet()
	}
	st := dhStage{Dir: stageDir, PartSize: partSize}
	staged := map[string]struct{}{}

	ix := DHIndex{
		Format:       dhIndexFormat,
		CreatedAt:    keys.CreatedAt,
		PartsBase:    keys.PartsBase,
		DHVersion:    src.DHVersion,
		ServerFolder: src.ServerFolder,
		Levels:       []DHIndexLevel{},
	}
	var absent []DHPart
	for _, l := range src.Levels {
		level, levelAbsent, err := st.indexDHDatabase(l.Path, l.Folder, known, staged)
		if err != nil {
			return DHIndex{}, nil, err
		}
		ix.Levels = append(ix.Levels, level)
		absent = append(absent, levelAbsent...)
	}
	return ix, absent, nil
}

// SnapshotKeys are the object keys of one snapshot in the bucket.
//
// Public layout, token empty:
//
//	<prefix>/parts/<sha256>
//	<prefix>/latest.json
//	<prefix>/snapshots/<createdAt>/index.json
//	<prefix>/snapshots/<createdAt>/index.html
//	<prefix>/snapshots/<createdAt>/<level folder>/DistantHorizons.sqlite
//
// Private layout: everything but parts/ moves under <prefix>/<token>/. The parts
// stay put because a part's name is the hash of 8 MiB of data, which nobody can
// guess without the index. Nothing that writes these keys needs to know which
// layout it is in.
type SnapshotKeys struct {
	// CreatedAt is the snapshot's time as the index writes it.
	CreatedAt string
	// Latest, Index and Page are full object keys.
	Latest string
	Index  string
	Page   string
	// PartsPrefix is the parts folder's key, with a trailing slash; a part's key
	// is PartsPrefix + hash.
	PartsPrefix string
	// PartsBase is PartsPrefix relative to Index, as index.json states it.
	PartsBase string

	snapshotDir string
}

// PartKey is the object key of a part.
func (k SnapshotKeys) PartKey(sha256 string) string { return k.PartsPrefix + sha256 }

// AssembledKey is the object key of a level's whole database, assembled from
// its parts in the bucket.
func (k SnapshotKeys) AssembledKey(levelFolder string) string {
	return path.Join(k.snapshotDir, levelFolder, dhDatabaseName)
}

var reDHToken = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// snapshotKeys lays out one snapshot under prefix. An empty token is the public
// layout; a non-empty one places everything but parts/ under <prefix>/<token>/
// (see SnapshotKeys). The token must be a single safe path segment.
func snapshotKeys(prefix, token string, createdAt time.Time) (SnapshotKeys, error) {
	if token != "" && !reDHToken.MatchString(token) {
		return SnapshotKeys{}, errors.New("link token must be letters, digits, '_' and '-'")
	}
	root := strings.Trim(prefix, "/")
	base := root
	depth := 2 // snapshots/<createdAt>/ above index.json
	if token != "" {
		base = path.Join(root, token)
		depth = 3
	}
	stamp := formatDHCreatedAt(createdAt)
	dir := path.Join(base, "snapshots", stamp)
	partsPrefix := path.Join(root, "parts") + "/"
	if root == "" {
		partsPrefix = "parts/"
	}
	return SnapshotKeys{
		CreatedAt:   stamp,
		Latest:      path.Join(base, "latest.json"),
		Index:       path.Join(dir, "index.json"),
		Page:        path.Join(dir, "index.html"),
		PartsPrefix: partsPrefix,
		PartsBase:   strings.Repeat("../", depth) + "parts/",
		snapshotDir: dir,
	}, nil
}
