package services

import (
	"context"
	"crypto/sha512"
	"encoding/hex"
	"fmt"
	"hash/fnv"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"konnekt/backend/models"
)

// A jar Konnekt did not download itself is still a mod, and until it is
// identified it is a row with no icon, no project, no version and no update
// check — which is what "shows up as local" means (#52). Identity comes from
// the file's own bytes: Modrinth indexes every file it serves by SHA-512, so
// hashing a jar and asking is the one question that works for a file dropped
// into mods/ by hand, copied in through the file picker, or shipped as a
// secondary file of somebody else's version.

// jarHashCache mirrors jarMetaCache in modjar.go, and for the same reason:
// keyed by path+mtime+size, so replacing a jar invalidates its entry and
// nothing else has to remember to. Hashing is the expensive half of
// identification — a mods folder is tens to hundreds of megabytes — and a scan
// runs on a timer, so the cache is what keeps the timer cheap.
var jarHashCache sync.Map // jarCacheKey → string

func fileSHA512Cached(path string) (string, error) {
	info, err := os.Stat(path)
	if err != nil {
		return "", fmt.Errorf("stat %s: %w", path, err)
	}
	key := jarCacheKey{path: path, mtime: info.ModTime().UnixMilli(), size: info.Size()}
	if cached, ok := jarHashCache.Load(key); ok {
		return cached.(string), nil
	}

	f, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("open %s: %w", path, err)
	}
	defer f.Close()

	h := sha512.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", fmt.Errorf("hash %s: %w", path, err)
	}
	sum := hex.EncodeToString(h.Sum(nil))
	jarHashCache.Store(key, sum)
	return sum, nil
}

// jarFile is one mod/plugin file found on disk.
type jarFile struct {
	folder   string // "mods" | "plugins"
	name     string // on-disk name, .disabled suffix included
	path     string
	bareName string // name with .disabled trimmed
	enabled  bool
	size     int64
	modTime  time.Time
}

// scanJarFiles lists the jars in a server's mods/ and plugins/ directories. A
// folder that does not exist is not an error: a Paper server has no mods/.
func scanJarFiles(workDir string) []jarFile {
	var out []jarFile
	for _, folder := range []string{"mods", "plugins"} {
		dir := filepath.Join(workDir, folder)
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			name := e.Name()
			if !strings.HasSuffix(name, ".jar") && !strings.HasSuffix(name, ".jar.disabled") {
				continue
			}
			info, err := e.Info()
			if err != nil {
				continue
			}
			out = append(out, jarFile{
				folder:   folder,
				name:     name,
				path:     filepath.Join(dir, name),
				bareName: strings.TrimSuffix(name, ".disabled"),
				enabled:  strings.HasSuffix(name, ".jar"),
				size:     info.Size(),
				modTime:  info.ModTime(),
			})
		}
	}
	return out
}

// folderSignature fingerprints what is in mods/ and plugins/ without opening
// anything: names, sizes and mtimes. It is what the background scan compares
// between ticks, so a jar added, removed, renamed, disabled or re-downloaded
// changes it and nothing else costs a read.
func folderSignature(workDir string) uint64 {
	h := fnv.New64a()
	for _, jar := range scanJarFiles(workDir) {
		fmt.Fprintf(h, "%s/%s:%d:%d;", jar.folder, jar.name, jar.size, jar.modTime.UnixMilli())
	}
	return h.Sum64()
}

// identifyUnknownLocked asks the provider what every unaccounted-for jar is and
// writes the answers into the manifest. Reports whether the manifest changed.
//
// The caller must hold s.mu: this writes the manifest, so it serializes with
// installs the same way every other writer does.
//
// Only files the manifest cannot already account for are hashed. A row that
// came from an install is skipped outright, and a row already carrying
// HashChecked is skipped too — that flag is the memory of a negative answer,
// without which a hand-built jar would be re-hashed and re-queried on every
// tick for the life of the app.
func (s *ModService) identifyUnknownLocked(serverID string) (bool, error) {
	workDir, err := s.workingDir(serverID)
	if err != nil {
		return false, err
	}
	loader, _ := s.loaderForServer(serverID)

	manifest, err := s.loadManifest(serverID)
	if err != nil || manifest == nil {
		manifest = &modManifest{Version: modManifestVersion}
	}
	index := make(map[string]*modManifestItem, len(manifest.Items))
	for i := range manifest.Items {
		it := &manifest.Items[i]
		index[it.FileName] = it
	}

	// One-time re-identification of rows written by the version that decided
	// primary-ness by file name (see isPrimary below). Those rows are already
	// marked modrinth, which is exactly what the skip below looks for, so
	// nothing would ever look at them again — and the mods that lost their
	// version id are the ones a modpack renamed, which is most of a pack.
	recheck := make(map[string]bool)
	migrating := manifest.Version < modManifestVersion
	if migrating {
		for i := range manifest.Items {
			if it := &manifest.Items[i]; it.Source == "modrinth" && it.VersionID == "" {
				recheck[it.FileName] = true
			}
		}
		manifest.Version = modManifestVersion
	}

	type candidate struct {
		jar  jarFile
		hash string
	}
	var candidates []candidate
	byHash := make(map[string][]int) // hash → indexes into candidates

	for _, jar := range scanJarFiles(workDir) {
		if item, ok := index[jar.name]; ok && !recheck[jar.name] && (item.Source == "modrinth" || item.HashChecked) {
			continue
		}
		hash, herr := fileSHA512Cached(jar.path)
		if herr != nil {
			// An unreadable jar is the server's problem, not something to fail
			// a whole scan over. It stays local and gets another chance next time.
			slog.Warn("mods: hash for identification", "file", jar.name, "error", herr)
			continue
		}
		byHash[hash] = append(byHash[hash], len(candidates))
		candidates = append(candidates, candidate{jar: jar, hash: hash})
	}

	if len(candidates) == 0 {
		if migrating {
			// Nothing to look up, but the manifest still has to record that the
			// migration ran or every scan from here on repeats this pass.
			return false, s.saveManifest(serverID, manifest)
		}
		return false, nil
	}

	hashes := make([]string, 0, len(byHash))
	for h := range byHash {
		hashes = append(hashes, h)
	}

	// A failure here records nothing at all, deliberately: the app is offline
	// as often as it is online, and writing HashChecked on a network error
	// would brand every mod in the folder local forever.
	found, err := s.provider.GetVersionsByHashes(s.ctx, hashes)
	if err != nil {
		return false, fmt.Errorf("identify %d file(s): %w", len(candidates), err)
	}

	projectCache := make(map[string]models.ModProject)

	for _, c := range candidates {
		existing := index[c.jar.name]
		meta, _ := parseJarMetaCached(c.jar.path, loader)

		item := modManifestItem{
			FileName:     c.jar.name,
			DisplayName:  meta.Name,
			ModID:        meta.ID,
			Source:       "local",
			SHA512:       c.hash,
			HashChecked:  true,
			Loader:       meta.Loader,
			TargetFolder: c.jar.folder,
			Enabled:      c.jar.enabled,
			InstalledAt:  c.jar.modTime.UnixMilli(),
		}
		if item.Loader == "" {
			item.Loader = loader
		}
		if existing != nil {
			if existing.InstalledAt != 0 {
				item.InstalledAt = existing.InstalledAt
			}
			item.DependencyOf = existing.DependencyOf
		}

		if version, ok := found[c.hash]; ok {
			item.Source = "modrinth"
			item.Provider = s.provider.ID()
			item.ProjectID = version.ProjectID
			item.VersionNumber = version.VersionNumber

			// Only a version's *primary* file gets its VersionID. A secondary
			// file — EssentialsX ships EssentialsXChat and the rest of its
			// modules that way — belongs to the version without being it, and
			// claiming otherwise would offer an "update" that downloads the
			// primary jar over a module that is not the same plugin at all.
			// CheckUpdates already requires a VersionID, so leaving it empty is
			// what keeps that offer off the table. The project link, icon and
			// version number are all still true and all still shown.
			//
			// The question is asked of the *bytes*, not the file name.
			// mrVersionToModel carries the primary file's own hash, and this jar
			// was found by hashing it, so the two matching is what "this file is
			// that file" means. Comparing names instead is what shipped first,
			// and it answered "secondary" for every jar a launcher or modpack
			// had renamed on the way in: the row kept its project and its icon,
			// lost its version id, and with it the Switch button in the preview
			// dialog and every update check. The name comparison stays as the
			// fallback for a provider that reports no hash.
			isPrimary := strings.EqualFold(version.FileName, c.jar.bareName)
			if version.SHA512 != "" {
				isPrimary = strings.EqualFold(version.SHA512, c.hash)
			}
			if isPrimary {
				item.VersionID = version.ID
			}

			proj, cached := projectCache[version.ProjectID]
			if !cached && version.ProjectID != "" {
				p, perr := s.provider.GetProject(s.ctx, version.ProjectID)
				if perr != nil {
					// Cached anyway, as the zero value: a modpack folder can be
					// two hundred files from one project, and an unreachable
					// project must cost one request rather than two hundred.
					slog.Warn("mods: project for identified file", "project", version.ProjectID, "error", perr)
				}
				proj = p
				projectCache[version.ProjectID] = p
			}
			item.IconURL = proj.IconURL
			// The primary file takes the project's name, matching what an
			// install writes. A secondary file keeps the name its own manifest
			// gives it, so four EssentialsX modules do not render as four rows
			// all called EssentialsX.
			if proj.Title != "" && (isPrimary || item.DisplayName == "") {
				item.DisplayName = proj.Title
			}
		}

		manifest.upsert(item)
	}

	if err := s.saveManifest(serverID, manifest); err != nil {
		return false, err
	}
	s.clearUpdateCache(serverID)
	return true, nil
}

// modScanInterval is the "while the window is open" cadence for noticing a jar
// that arrived from outside Konnekt. It matches the Kommands poll and is slack
// for the same reason: the responsive path is Rescan, which the frontend calls
// on window focus, and this only has to catch a file dropped into mods/ while
// Konnekt already has focus.
const modScanInterval = 30 * time.Second

// Rescan looks at a server's mod folders now rather than waiting for the timer,
// identifies anything new, and announces the result. Called on window focus and
// when the mods tile mounts.
func (s *ModService) Rescan(serverID string) error {
	changed, err := s.rescanServer(serverID)
	if changed {
		s.bus.Emit(EventModChanged, map[string]any{"serverID": serverID})
	}
	return err
}

// rescanServer reports whether anything the UI should re-read has changed.
//
// The folder signature is the gate: unchanged folders cost one ReadDir and stop
// there, so neither hashing nor the network is touched on a quiet tick. A file
// appearing, vanishing or being replaced is a change whether or not it can be
// identified — a jar deleted in Finder has to leave the list too.
func (s *ModService) rescanServer(serverID string) (bool, error) {
	workDir, err := s.workingDir(serverID)
	if err != nil {
		return false, err
	}
	if workDir == "" {
		// A server configured without a working directory has no folders to
		// look at, and joining "" with "mods" would resolve against Konnekt's
		// own working directory instead.
		return false, nil
	}
	sig := folderSignature(workDir)

	s.sigMu.Lock()
	prev, seen := s.lastSig[serverID]
	s.lastSig[serverID] = sig
	s.sigMu.Unlock()

	folderChanged := seen && prev != sig
	if seen && !folderChanged {
		return false, nil
	}

	s.mu.Lock()
	identified, ierr := s.identifyUnknownLocked(serverID)
	s.mu.Unlock()

	if ierr != nil {
		// Forget the signature so the next tick tries again. Identification is
		// the half of this that needs the network, and an app that is offline
		// for a minute must not leave the folder marked "already looked at".
		s.sigMu.Lock()
		delete(s.lastSig, serverID)
		s.sigMu.Unlock()
	}
	return folderChanged || identified, ierr
}

// Start watches every configured server's mod folders until ctx is cancelled or
// Stop is called. The first pass runs immediately, which is the "somebody
// dropped a jar in while Konnekt was closed" case.
func (s *ModService) Start(ctx context.Context) {
	go func() {
		s.scanAllServers()
		ticker := time.NewTicker(modScanInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-s.stop:
				return
			case <-ticker.C:
				s.scanAllServers()
			}
		}
	}()
}

// Stop ends the scan. Idempotent, so beforeClose and a test may both call it.
func (s *ModService) Stop() {
	s.stopOnce.Do(func() { close(s.stop) })
}

func (s *ModService) scanAllServers() {
	configs, err := s.cfg.GetServerConfigs()
	if err != nil {
		slog.Warn("mods: read server configs for scan", "error", err)
		return
	}
	for _, cfg := range configs {
		if cfg.WorkingDir == "" {
			continue
		}
		changed, err := s.rescanServer(cfg.ID)
		if err != nil {
			slog.Warn("mods: scan", "server", cfg.ID, "error", err)
		}
		if changed {
			s.bus.Emit(EventModChanged, map[string]any{"serverID": cfg.ID})
		}
	}
}
