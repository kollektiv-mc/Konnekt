package services

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"konnekt/backend/models"
)

// Modpack sync (#454, #456): a server's mods/ folder follows a pack.
//
// What a sync converges the folder to is the pack's entries that this server
// wants, plus everything the pack does not own. Ownership is the manifest's
// Pack field: a sync replaces and removes only files it installed or adopted,
// so a server-only mod dropped in by hand (a web map, a claims mod) is never
// touched, and a jar the pack used to own goes when the pack drops it.
//
// The work is split the way the person sees it. Plan resolves the pack,
// downloads every file the server lacks into a cache and checks its hash, and
// works out each row without touching mods/. Apply then only moves files that
// are already verified on disk, so the server's downtime is a few renames, and
// a plan that cannot be applied in full is not applied at all.

const (
	modSyncFolder = "modsync"
	// modSyncKeep is how many applied syncs keep their snapshot, and so how
	// many can be rolled back.
	modSyncKeep = 3
	// modSyncDownloadLimit bounds one downloaded jar. The largest mods are
	// tens of megabytes.
	modSyncDownloadLimit = 512 << 20
	// modSyncCacheAge is how long a staged file no plan has used is kept.
	modSyncCacheAge     = 7 * 24 * time.Hour
	modSyncStateVersion = 1
)

// modSyncHosts are where a pack's mods may be downloaded from, besides the
// pack's own host. Every file is checked against the pack's hash whatever its
// host, so the list is the second line of defence (#434), not the first: it
// is the CDNs packwiz itself writes URLs for.
var modSyncHosts = []string{
	"cdn.modrinth.com",
	"edge.forgecdn.net",
	"mediafilez.forgecdn.net",
	"github.com",
	"objects.githubusercontent.com",
	"release-assets.githubusercontent.com",
}

// modSyncState is <dataDir>/modsync/<serverID>.json.
type modSyncState struct {
	Version int                    `json:"version"`
	Source  *models.PackSource     `json:"source,omitempty"`
	History []models.ModSyncRecord `json:"history,omitempty"`
}

// modSyncJournal is what one applied sync did, written beside the files it
// moved aside, so a failed apply or a later rollback can put mods/ back.
type modSyncJournal struct {
	// Added are file names the sync wrote into mods/.
	Added []string `json:"added"`
	// Moved are file names the sync moved from mods/ into the snapshot.
	Moved []string `json:"moved"`
	// Renamed are [from, to] pairs inside mods/, the disables.
	Renamed [][2]string `json:"renamed"`
	// Manifest is the mod manifest as it was before the sync.
	Manifest json.RawMessage `json:"manifest"`
}

// syncOp is a plan row with what Apply needs to carry it out.
type syncOp struct {
	row    models.ModSyncRow
	entry  *packEntry
	staged string // verified file in the cache, for add and update
	local  string // the file on disk this row acts on (update's From, remove, disable, adopt, keep)
}

// --- Source binding ---

func (s *ModService) modSyncDir() string { return filepath.Join(s.dataDir, modSyncFolder) }

func (s *ModService) modSyncStatePath(serverID string) string {
	return filepath.Join(s.modSyncDir(), serverID+".json")
}

func (s *ModService) loadModSyncState(serverID string) (*modSyncState, error) {
	if err := validServerID(serverID); err != nil {
		return nil, err
	}
	data, err := os.ReadFile(s.modSyncStatePath(serverID))
	if os.IsNotExist(err) {
		return &modSyncState{Version: modSyncStateVersion}, nil
	}
	if err != nil {
		return nil, err
	}
	var st modSyncState
	if err := json.Unmarshal(data, &st); err != nil {
		return nil, fmt.Errorf("pack sync state: %w", err)
	}
	return &st, nil
}

func (s *ModService) saveModSyncState(serverID string, st *modSyncState) error {
	if err := validServerID(serverID); err != nil {
		return err
	}
	st.Version = modSyncStateVersion
	data, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(s.modSyncDir(), 0o755); err != nil {
		return err
	}
	return writeFileAtomic(s.modSyncStatePath(serverID), data, 0o644)
}

// ModSyncState returns the server's bound pack source and its sync history.
func (s *ModService) ModSyncState(serverID string) (models.ModSyncState, error) {
	st, err := s.loadModSyncState(serverID)
	if err != nil {
		return models.ModSyncState{}, err
	}
	out := models.ModSyncState{Source: st.Source, History: st.History}
	if out.History == nil {
		out.History = []models.ModSyncRecord{}
	}
	return out, nil
}

// SetPackSource binds a server to a pack, or changes its exclude and include
// lists. The address is checked here, so a graph that later syncs from it
// syncs from something a person accepted.
func (s *ModService) SetPackSource(src models.PackSource) error {
	if err := validServerID(src.ServerID); err != nil {
		return err
	}
	if _, err := s.cfg.GetServerConfig(src.ServerID); err != nil {
		return err
	}
	clean, err := normalizePackSource(src)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	st, err := s.loadModSyncState(src.ServerID)
	if err != nil {
		return err
	}
	st.Source = &clean
	if err := s.saveModSyncState(src.ServerID, st); err != nil {
		return err
	}
	s.bus.Emit(EventModSyncChanged, map[string]any{"serverID": src.ServerID})
	return nil
}

// ClearPackSource unbinds a server from its pack. The files the pack
// installed stay, and stay marked as the pack's, so binding the same pack
// again picks up where it left off.
func (s *ModService) ClearPackSource(serverID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	st, err := s.loadModSyncState(serverID)
	if err != nil {
		return err
	}
	st.Source = nil
	if err := s.saveModSyncState(serverID, st); err != nil {
		return err
	}
	s.bus.Emit(EventModSyncChanged, map[string]any{"serverID": serverID})
	return nil
}

// normalizePackSource checks a source and trims its lists.
func normalizePackSource(src models.PackSource) (models.PackSource, error) {
	if src.Format == "" {
		src.Format = "packwiz"
	}
	if src.Format != "packwiz" {
		return src, fmt.Errorf("pack format %q is not supported; packwiz is", src.Format)
	}
	src.Address = strings.TrimSpace(src.Address)
	switch src.Location {
	case "url":
		u, err := parsePackURL(src.Address)
		if err != nil {
			return src, err
		}
		src.Address = u.String()
	case "folder":
		if !filepath.IsAbs(src.Address) {
			return src, errors.New("the pack folder must be an absolute path")
		}
		src.Address = filepath.Clean(src.Address)
		if _, err := os.Stat(filepath.Join(src.Address, "pack.toml")); err != nil {
			return src, fmt.Errorf("no pack.toml in %s", src.Address)
		}
	default:
		return src, fmt.Errorf("unknown pack location %q", src.Location)
	}
	src.Exclude = cleanNameList(src.Exclude)
	src.Include = cleanNameList(src.Include)
	return src, nil
}

func cleanNameList(in []string) []string {
	out := []string{}
	for _, n := range in {
		n = strings.TrimSpace(n)
		if n != "" && !slices.Contains(out, n) {
			out = append(out, n)
		}
	}
	slices.Sort(out)
	return out
}

func (s *ModService) packReaderFor(src *models.PackSource) (packReader, string, error) {
	switch src.Location {
	case "url":
		r, err := newURLPackReader(src.Address, s.downloads.client)
		if err != nil {
			return nil, "", err
		}
		return r, r.base.Hostname(), nil
	case "folder":
		return folderPackReader{root: src.Address}, "", nil
	}
	return nil, "", fmt.Errorf("unknown pack location %q", src.Location)
}

// --- Plan ---

// PlanModSync works out what a sync would do, downloading what it needs into
// the cache but leaving mods/ as it is.
func (s *ModService) PlanModSync(serverID string) (models.ModSyncPlan, error) {
	return s.PlanModSyncContext(s.baseContext(), serverID)
}

// PlanModSyncContext is PlanModSync under the caller's context, so a
// scheduler run's timeout and cancel reach the downloads.
func (s *ModService) PlanModSyncContext(ctx context.Context, serverID string) (models.ModSyncPlan, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	plan, _, err := s.planModSyncLocked(ctx, serverID)
	return plan, err
}

// baseContext is the app's context, or Background before SetContext.
func (s *ModService) baseContext() context.Context {
	if s.ctx == nil {
		return context.Background()
	}
	return s.ctx
}

func (s *ModService) planModSyncLocked(ctx context.Context, serverID string) (models.ModSyncPlan, []syncOp, error) {
	cfg, err := s.serverConfig(serverID)
	if err != nil {
		return models.ModSyncPlan{}, nil, err
	}
	mcVersion, loader := resolveTarget(cfg)
	if loaderTargetFolder(loader) != "mods" {
		return models.ModSyncPlan{}, nil, fmt.Errorf("pack sync is for mod loaders; this server runs %s", loader)
	}
	st, err := s.loadModSyncState(serverID)
	if err != nil {
		return models.ModSyncPlan{}, nil, err
	}
	if st.Source == nil {
		return models.ModSyncPlan{}, nil, errors.New("no pack is set for this server")
	}
	src := st.Source
	s.pruneModSyncCache()
	reader, host, err := s.packReaderFor(src)
	if err != nil {
		return models.ModSyncPlan{}, nil, err
	}
	pack, err := resolvePackwiz(ctx, reader)
	if err != nil {
		return models.ModSyncPlan{}, nil, fmt.Errorf("read the pack: %w", err)
	}
	pack.Host = host

	plan := models.ModSyncPlan{
		ServerID:      serverID,
		PackName:      pack.Name,
		PackVersion:   pack.Version,
		Minecraft:     pack.Minecraft,
		Loader:        pack.Loader,
		LoaderVersion: pack.LoaderVersion,
		Fingerprint:   pack.Fingerprint,
		Rows:          []models.ModSyncRow{},
		Blockers:      []string{},
		Warnings:      []string{},
	}
	if len(st.History) > 0 {
		last := st.History[0]
		plan.Last = &last
	}
	plan.Blockers = append(plan.Blockers, targetBlockers(pack, mcVersion, loader, cfg.LoaderVersion, &plan.Warnings)...)

	modsDir := filepath.Join(cfg.WorkingDir, "mods")
	manifest, err := s.loadManifest(serverID)
	if err != nil {
		return models.ModSyncPlan{}, nil, fmt.Errorf("mod manifest: %w", err)
	}
	ops, blockers, warnings := s.matchPack(ctx, pack, src, modsDir, manifest, loader)
	plan.Blockers = append(plan.Blockers, blockers...)
	plan.Warnings = append(plan.Warnings, warnings...)
	s.noteClientOnly(ctx, ops, &plan.Warnings)

	for _, op := range ops {
		plan.Rows = append(plan.Rows, op.row)
		switch op.row.Action {
		case "add":
			plan.Added++
		case "update":
			plan.Updated++
		case "remove":
			plan.Removed++
		case "disable":
			plan.Disabled++
		case "keep":
			plan.Kept++
		case "adopt":
			plan.Adopted++
		case "skip":
			plan.Skipped++
		}
	}
	plan.UpToDate = plan.Added+plan.Updated+plan.Removed+plan.Disabled == 0
	if !plan.UpToDate && s.srv != nil && s.srv.IsRunning(serverID) {
		plan.Blockers = append(plan.Blockers, "The server is running. Stop it to apply the sync.")
	}
	plan.PlanID = planFingerprint(plan)
	return plan, ops, nil
}

// targetBlockers compares the pack's Minecraft and loader with the server's.
// A different game or loader is a migration for a person, not a sync, and a
// different loader build is refused too: a pack that needs NeoForge 21.1.252
// can fail to load on 21.1.249.
func targetBlockers(pack resolvedPack, mcVersion, loader, loaderVersion string, warnings *[]string) []string {
	var out []string
	if pack.Minecraft != "" && mcVersion != "" && pack.Minecraft != mcVersion {
		out = append(out, fmt.Sprintf("The pack is for Minecraft %s and the server runs %s.", pack.Minecraft, mcVersion))
	}
	if pack.Loader != "" && loader != "" && pack.Loader != loader {
		out = append(out, fmt.Sprintf("The pack is for %s and the server runs %s.", pack.Loader, loader))
		return out
	}
	if pack.LoaderVersion != "" {
		switch {
		case loaderVersion == "":
			*warnings = append(*warnings, fmt.Sprintf("The pack expects %s %s. The server's loader version is not known, so it was not compared.", pack.Loader, pack.LoaderVersion))
		case loaderVersion != pack.LoaderVersion:
			out = append(out, fmt.Sprintf("The pack expects %s %s and the server runs %s. Update the server's loader first.", pack.Loader, pack.LoaderVersion, loaderVersion))
		}
	}
	return out
}

// localJar is one file in mods/.
type localJar struct {
	name    string // on-disk name, .disabled included
	bare    string // name without .disabled
	path    string
	enabled bool
	item    *modManifestItem
	hashes  map[string]string // format → hex, filled on demand
	used    bool
}

func (j *localJar) hash(format string) (string, error) {
	if h, ok := j.hashes[format]; ok {
		return h, nil
	}
	var h string
	var err error
	if format == "sha512" {
		h, err = fileSHA512Cached(j.path)
	} else {
		h, err = hashFileAs(j.path, format)
	}
	if err != nil {
		return "", err
	}
	j.hashes[format] = h
	return h, nil
}

func scanLocalJars(modsDir string, manifest *modManifest) ([]*localJar, error) {
	entries, err := os.ReadDir(modsDir)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	index := map[string]*modManifestItem{}
	if manifest != nil {
		for i := range manifest.Items {
			it := &manifest.Items[i]
			if it.TargetFolder == "" || it.TargetFolder == "mods" {
				index[it.FileName] = it
			}
		}
	}
	var out []*localJar
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !strings.HasSuffix(name, ".jar") && !strings.HasSuffix(name, ".jar.disabled") {
			continue
		}
		out = append(out, &localJar{
			name:    name,
			bare:    strings.TrimSuffix(name, ".disabled"),
			path:    filepath.Join(modsDir, name),
			enabled: strings.HasSuffix(name, ".jar"),
			item:    index[name],
			hashes:  map[string]string{},
		})
	}
	return out, nil
}

// wantsEntry decides whether this server installs a pack entry, and why not
// when it does not. The server's own lists win over the pack's side.
func wantsEntry(e packEntry, src *models.PackSource) (bool, string) {
	named := func(list []string) bool {
		return slices.Contains(list, e.Key) || slices.Contains(list, e.FileName)
	}
	if named(src.Exclude) {
		return false, "excluded on this server"
	}
	if e.Side == "client" {
		if named(src.Include) {
			return true, ""
		}
		return false, "client only in the pack"
	}
	return true, ""
}

// matchPack sets each pack entry against what is in mods/.
func (s *ModService) matchPack(ctx context.Context, pack resolvedPack, src *models.PackSource, modsDir string, manifest *modManifest, loader string) ([]syncOp, []string, []string) {
	var blockers, warnings []string
	locals, err := scanLocalJars(modsDir, manifest)
	if err != nil {
		return nil, []string{fmt.Sprintf("Could not read the mods folder: %v", err)}, nil
	}

	// findByHash returns the local file holding exactly the entry's bytes,
	// trying the file of the same name first so the common case hashes once.
	findByHash := func(e packEntry) *localJar {
		if e.Hash == "" {
			return nil
		}
		try := func(j *localJar) bool {
			if j.used {
				return false
			}
			h, err := j.hash(e.HashFormat)
			return err == nil && strings.EqualFold(h, e.Hash)
		}
		for _, j := range locals {
			if j.bare == e.FileName && try(j) {
				return j
			}
		}
		for _, j := range locals {
			if j.bare != e.FileName && try(j) {
				return j
			}
		}
		return nil
	}

	var ops []syncOp
	// First pass: every entry whose exact bytes are already on disk, so the
	// second pass never mistakes a file the pack keeps for one it replaces.
	pending := []int{}
	for i := range pack.Entries {
		e := &pack.Entries[i]
		want, why := wantsEntry(*e, src)
		row := models.ModSyncRow{FileName: e.FileName, Name: e.Name, Key: e.Key, Side: e.Side}
		if j := findByHash(*e); j != nil {
			j.used = true
			row.From = ""
			switch {
			case !want && j.enabled:
				row.Action, row.Reason = "disable", why
			case !want:
				row.Action, row.Reason = "skip", why+"; already disabled here"
			case j.item != nil && j.item.Pack != "":
				row.Action, row.Reason = "keep", "up to date"
			default:
				row.Action, row.Reason = "adopt", "already on the server; the sync takes it over"
			}
			if want && !j.enabled {
				row.Note = "disabled on this server, and stays disabled"
			}
			if j.name != e.FileName && j.bare != e.FileName {
				row.From = j.name
			}
			ops = append(ops, syncOp{row: row, entry: e, local: j.name})
			continue
		}
		if !want {
			row.Action, row.Reason = "skip", why
			ops = append(ops, syncOp{row: row, entry: e})
			continue
		}
		pending = append(pending, i)
	}

	// Second pass: what has to be fetched, and what each fetched file replaces.
	for _, i := range pending {
		e := &pack.Entries[i]
		row := models.ModSyncRow{FileName: e.FileName, Name: e.Name, Key: e.Key, Side: e.Side}
		staged, reason := s.stageEntry(ctx, *e, pack.Host)
		if reason != "" {
			row.Action, row.Reason = "blocked", reason
			blockers = append(blockers, fmt.Sprintf("%s: %s", e.FileName, reason))
			ops = append(ops, syncOp{row: row, entry: e})
			continue
		}
		var newModID string
		if meta, err := parseJarMeta(staged, loader); err == nil {
			newModID = meta.ID
		}
		old := supersededBy(*e, newModID, locals, loader)
		op := syncOp{row: row, entry: e, staged: staged}
		if old != nil {
			old.used = true
			op.local = old.name
			op.row.Action, op.row.From = "update", old.name
			switch {
			case old.item != nil && old.item.Pack != "":
				op.row.Reason = "new version in the pack"
			default:
				op.row.Reason = "the pack's version replaces the server's own copy"
			}
			if !old.enabled {
				op.row.Note = "the copy it replaces is disabled, so this one will be too"
			}
		} else {
			op.row.Action, op.row.Reason = "add", "not on the server"
		}
		ops = append(ops, op)
	}

	// Last: files the pack installed that it no longer lists.
	for _, j := range locals {
		if j.used || j.item == nil || j.item.Pack == "" {
			continue
		}
		ops = append(ops, syncOp{
			row: models.ModSyncRow{
				Action: "remove", FileName: j.name, Name: bestDisplayName(j.item, "", j.name),
				Key: j.item.Pack, Reason: "no longer in the pack",
			},
			local: j.name,
		})
	}
	slices.SortStableFunc(ops, func(a, b syncOp) int {
		if c := strings.Compare(actionOrder(a.row.Action), actionOrder(b.row.Action)); c != 0 {
			return c
		}
		return strings.Compare(strings.ToLower(a.row.FileName), strings.ToLower(b.row.FileName))
	})
	return ops, blockers, warnings
}

// actionOrder sorts rows so what changes the folder comes first.
func actionOrder(a string) string {
	switch a {
	case "blocked":
		return "0"
	case "update":
		return "1"
	case "add":
		return "2"
	case "remove":
		return "3"
	case "disable":
		return "4"
	case "adopt":
		return "5"
	case "skip":
		return "6"
	}
	return "7"
}

// supersededBy finds the file in mods/ that a fetched entry replaces: the
// file the pack installed for the same entry, a file of the same Modrinth
// project or the same mod id, or a file of the same name. Two copies of one
// mod stop a Forge or Fabric server at load, so a match here is replaced
// rather than left beside the new file.
func supersededBy(e packEntry, newModID string, locals []*localJar, loader string) *localJar {
	match := func(pred func(j *localJar) bool) *localJar {
		for _, j := range locals {
			if !j.used && pred(j) {
				return j
			}
		}
		return nil
	}
	if j := match(func(j *localJar) bool { return j.item != nil && j.item.Pack == e.Key }); j != nil {
		return j
	}
	if e.ProjectID != "" {
		if j := match(func(j *localJar) bool { return j.item != nil && j.item.ProjectID == e.ProjectID }); j != nil {
			return j
		}
	}
	if newModID != "" {
		if j := match(func(j *localJar) bool {
			meta, err := parseJarMetaCached(j.path, loader)
			return err == nil && meta.ID == newModID
		}); j != nil {
			return j
		}
	}
	return match(func(j *localJar) bool { return j.bare == e.FileName })
}

// stageEntry makes sure the entry's file is in the cache, verified, and
// returns its path, or the reason it cannot be.
func (s *ModService) stageEntry(ctx context.Context, e packEntry, packHost string) (string, string) {
	if e.CurseForge {
		return "", "a CurseForge file the pack does not link directly; Konnekt cannot download it, so put it in mods/ by hand and check again"
	}
	if e.Hash == "" {
		return "", "the pack gives no hash for it"
	}
	if !packHashStrong(e.HashFormat) {
		return "", fmt.Sprintf("the pack names it only by %s, which is too weak to trust a download with", e.HashFormat)
	}
	cacheDir := filepath.Join(s.modSyncDir(), "cache")
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		return "", err.Error()
	}
	dest := filepath.Join(cacheDir, e.HashFormat+"-"+e.Hash+".jar")
	if h, err := hashFileAs(dest, e.HashFormat); err == nil && strings.EqualFold(h, e.Hash) {
		now := time.Now()
		_ = os.Chtimes(dest, now, now) //nolint:errcheck // only the cache's age; a stale time costs one re-download
		return dest, ""
	}
	if e.LocalPath != "" {
		if err := copyVerified(e.LocalPath, dest, e.HashFormat, e.Hash); err != nil {
			return "", err.Error()
		}
		return dest, ""
	}
	// s.downloads.hosts is the Modrinth policy's own list, which a test
	// points at its file server.
	hosts := append(slices.Clone(modSyncHosts), s.downloads.hosts...)
	if packHost != "" {
		hosts = append(hosts, packHost)
	}
	policy := downloadPolicy{hosts: hosts, client: s.downloads.client}
	if err := downloadToVerified(ctx, policy, e.URL, dest, e.HashFormat, e.Hash); err != nil {
		return "", err.Error()
	}
	return dest, ""
}

// downloadToVerified downloads rawURL to dest, which exists afterwards only
// if its bytes match the hash.
func downloadToVerified(ctx context.Context, policy downloadPolicy, rawURL, dest, format, want string) error {
	u, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("bad download address: %w", err)
	}
	if err := policy.check(u); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, downloadTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", modrinthUserAgent)
	resp, err := policy.httpClient().Do(req)
	if err != nil {
		return fmt.Errorf("download: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download: HTTP %d", resp.StatusCode)
	}
	return writeVerified(resp.Body, dest, format, want)
}

func copyVerified(src, dest, format, want string) error {
	f, err := os.Open(src)
	if err != nil {
		return err
	}
	defer f.Close()
	return writeVerified(f, dest, format, want)
}

// writeVerified streams r into dest through a temp file, keeping it only when
// the hash matches.
func writeVerified(r io.Reader, dest, format, want string) error {
	h, err := newPackHasher(format)
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(dest), ".dl-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	n, err := io.Copy(io.MultiWriter(tmp, h), io.LimitReader(r, modSyncDownloadLimit+1))
	cerr := tmp.Close()
	if err == nil {
		err = cerr
	}
	if err == nil && n > modSyncDownloadLimit {
		err = fmt.Errorf("larger than %d MB", modSyncDownloadLimit>>20)
	}
	if err == nil {
		if got := hex.EncodeToString(h.Sum(nil)); !strings.EqualFold(got, want) {
			err = fmt.Errorf("%s does not match the pack", format)
		}
	}
	if err == nil {
		err = os.Rename(tmpPath, dest)
	}
	if err != nil {
		os.Remove(tmpPath)
	}
	return err
}

// noteClientOnly asks Modrinth about the files the server will run, and notes
// the ones whose version Modrinth marks client only. A note, never a change:
// the pack's side decides, and a person turns a note into an exclude (#455).
func (s *ModService) noteClientOnly(ctx context.Context, ops []syncOp, warnings *[]string) {
	if s.provider == nil {
		return
	}
	byHash := map[string][]int{}
	for i, op := range ops {
		if op.entry == nil || op.entry.HashFormat != "sha512" || op.entry.Side == "client" {
			continue
		}
		switch op.row.Action {
		case "add", "update", "keep", "adopt":
			byHash[op.entry.Hash] = append(byHash[op.entry.Hash], i)
		}
	}
	if len(byHash) == 0 {
		return
	}
	hashes := make([]string, 0, len(byHash))
	for h := range byHash {
		hashes = append(hashes, h)
	}
	found, err := s.provider.GetVersionsByHashes(ctx, hashes)
	if err != nil {
		*warnings = append(*warnings, "Modrinth could not be asked which mods are client only, so none are noted.")
		return
	}
	for h, idx := range byHash {
		if v, ok := found[h]; ok && v.ClientOnly {
			for _, i := range idx {
				if ops[i].row.Note == "" {
					ops[i].row.Note = "Modrinth marks this version client only; exclude it if the server does not need it"
				}
			}
		}
	}
}

// planFingerprint hashes what the person reads in a plan.
func planFingerprint(p models.ModSyncPlan) string {
	h := sha256.New()
	fmt.Fprintf(h, "%s\n", p.Fingerprint)
	for _, r := range p.Rows {
		fmt.Fprintf(h, "%s\x00%s\x00%s\x00%s\n", r.Action, r.FileName, r.From, r.Key)
	}
	for _, b := range p.Blockers {
		fmt.Fprintf(h, "b\x00%s\n", b)
	}
	return hex.EncodeToString(h.Sum(nil))[:16]
}

// --- Apply ---

// ApplyModSync carries out a plan. planID is the PlanID the person was shown;
// if the pack or the folder has changed since, the fresh plan differs and
// nothing is applied. An empty planID applies whatever the fresh plan is,
// which is what an unattended scheduler run does once it has checked the plan
// has nothing to ask about.
func (s *ModService) ApplyModSync(serverID, planID string) (models.ModSyncPlan, error) {
	return s.ApplyModSyncContext(s.baseContext(), serverID, planID)
}

// ApplyModSyncContext is ApplyModSync under the caller's context.
func (s *ModService) ApplyModSyncContext(ctx context.Context, serverID, planID string) (models.ModSyncPlan, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	plan, ops, err := s.planModSyncLocked(ctx, serverID)
	if err != nil {
		return plan, err
	}
	if planID != "" && plan.PlanID != planID {
		return plan, errors.New("the pack or the mods folder changed since this plan was made; check again")
	}
	if len(plan.Blockers) > 0 {
		return plan, fmt.Errorf("the sync cannot be applied: %s", strings.Join(plan.Blockers, " "))
	}
	if plan.UpToDate && plan.Adopted == 0 {
		return plan, nil
	}
	cfg, err := s.serverConfig(serverID)
	if err != nil {
		return plan, err
	}
	rec, err := s.applyOpsLocked(serverID, cfg, plan, ops)
	if err != nil {
		return plan, err
	}
	plan.Last = &rec
	s.clearUpdateCache(serverID)
	s.bus.Emit(EventModChanged, map[string]any{"serverID": serverID})
	s.bus.Emit(EventModSyncChanged, map[string]any{"serverID": serverID})
	return plan, nil
}

func (s *ModService) applyOpsLocked(serverID string, cfg models.ServerConfig, plan models.ModSyncPlan, ops []syncOp) (models.ModSyncRecord, error) {
	modsDir := filepath.Join(cfg.WorkingDir, "mods")
	if err := os.MkdirAll(modsDir, 0o755); err != nil {
		return models.ModSyncRecord{}, err
	}
	manifest, err := s.loadManifest(serverID)
	if err != nil {
		return models.ModSyncRecord{}, err
	}
	before, err := json.Marshal(manifest)
	if err != nil {
		return models.ModSyncRecord{}, err
	}
	rec := models.ModSyncRecord{
		ID:          strconv.FormatInt(time.Now().UnixMilli(), 10),
		AppliedAt:   time.Now().UnixMilli(),
		PackName:    plan.PackName,
		PackVersion: plan.PackVersion,
		Fingerprint: plan.Fingerprint,
		Added:       plan.Added,
		Updated:     plan.Updated,
		Removed:     plan.Removed,
		Disabled:    plan.Disabled,
	}
	snapDir := filepath.Join(s.modSyncDir(), serverID, rec.ID)
	if err := os.MkdirAll(snapDir, 0o755); err != nil {
		return rec, err
	}
	j := &modSyncJournal{Manifest: before}
	fail := func(err error) (models.ModSyncRecord, error) {
		if uerr := undoJournal(modsDir, snapDir, j); uerr != nil {
			slog.Error("mods: undo a failed pack sync", "server", serverID, "error", uerr)
			return rec, fmt.Errorf("%w; putting the folder back also failed: %v (the moved files are in %s)", err, uerr, snapDir)
		}
		if rerr := os.RemoveAll(snapDir); rerr != nil {
			slog.Warn("mods: remove an unused sync snapshot", "dir", snapDir, "error", rerr)
		}
		return rec, err
	}

	for _, op := range ops {
		switch op.row.Action {
		case "remove", "update":
			if err := moveFile(filepath.Join(modsDir, op.local), filepath.Join(snapDir, op.local)); err != nil {
				return fail(fmt.Errorf("move %s aside: %w", op.local, err))
			}
			j.Moved = append(j.Moved, op.local)
			manifest.removeByBase(strings.TrimSuffix(op.local, ".disabled"))
		case "disable":
			to := op.local + ".disabled"
			if err := os.Rename(filepath.Join(modsDir, op.local), filepath.Join(modsDir, to)); err != nil {
				return fail(fmt.Errorf("disable %s: %w", op.local, err))
			}
			j.Renamed = append(j.Renamed, [2]string{op.local, to})
			for i := range manifest.Items {
				if manifest.Items[i].FileName == op.local {
					manifest.Items[i].FileName = to
					manifest.Items[i].Enabled = false
				}
			}
		}
	}
	for _, op := range ops {
		switch op.row.Action {
		case "add", "update":
			name := op.entry.FileName
			disabled := op.row.Action == "update" && strings.HasSuffix(op.local, ".disabled")
			if disabled {
				name += ".disabled"
			}
			dest := filepath.Join(modsDir, name)
			if err := sandboxCheck(modsDir, dest); err != nil {
				return fail(err)
			}
			if _, err := os.Stat(dest); err == nil {
				return fail(fmt.Errorf("%s is already in mods/", name))
			}
			if err := atomicCopyFile(op.staged, dest); err != nil {
				return fail(fmt.Errorf("write %s: %w", name, err))
			}
			j.Added = append(j.Added, name)
			manifest.upsert(packManifestItem(op.entry, name, !disabled))
		case "adopt", "keep":
			s.markOwned(manifest, op)
		}
	}

	journal, err := json.Marshal(j)
	if err != nil {
		return fail(err)
	}
	if err := writeFileAtomic(filepath.Join(snapDir, "journal.json"), journal, 0o644); err != nil {
		return fail(err)
	}
	if err := s.saveManifest(serverID, manifest); err != nil {
		return fail(err)
	}
	st, err := s.loadModSyncState(serverID)
	if err != nil {
		return fail(err)
	}
	st.History = append([]models.ModSyncRecord{rec}, st.History...)
	if err := s.saveModSyncState(serverID, s.pruneSnapshots(serverID, st)); err != nil {
		slog.Error("mods: record a pack sync", "server", serverID, "error", err)
	}
	return rec, nil
}

// markOwned records a kept or adopted file as the pack's.
func (s *ModService) markOwned(m *modManifest, op syncOp) {
	for i := range m.Items {
		if m.Items[i].FileName == op.local {
			m.Items[i].Pack = op.entry.Key
			if m.Items[i].ProjectID == "" && op.entry.ProjectID != "" {
				m.Items[i].ProjectID, m.Items[i].VersionID = op.entry.ProjectID, op.entry.VersionID
				m.Items[i].Source, m.Items[i].Provider = "modrinth", "modrinth"
			}
			return
		}
	}
	it := packManifestItem(op.entry, op.local, strings.HasSuffix(op.local, ".jar"))
	m.Items = append(m.Items, it)
}

// packManifestItem is the manifest row for a file a sync put in place.
func packManifestItem(e *packEntry, fileName string, enabled bool) modManifestItem {
	it := modManifestItem{
		FileName:     fileName,
		DisplayName:  e.Name,
		Source:       "local",
		Loader:       "",
		TargetFolder: "mods",
		Enabled:      enabled,
		InstalledAt:  time.Now().UnixMilli(),
		Pack:         e.Key,
	}
	if e.HashFormat == "sha512" {
		it.SHA512 = e.Hash
	}
	if e.ProjectID != "" {
		it.Source, it.Provider = "modrinth", "modrinth"
		it.ProjectID, it.VersionID = e.ProjectID, e.VersionID
		it.HashChecked = it.SHA512 != ""
	}
	return it
}

// moveFile renames, falling back to copy and delete across filesystems: the
// app data folder and a server folder are often on different drives.
func moveFile(from, to string) error {
	if err := os.Rename(from, to); err == nil {
		return nil
	}
	if err := atomicCopyFile(from, to); err != nil {
		return err
	}
	return os.Remove(from)
}

// undoJournal reverses what a journal records, last step first.
func undoJournal(modsDir, snapDir string, j *modSyncJournal) error {
	var errs []error
	for i := len(j.Added) - 1; i >= 0; i-- {
		if err := os.Remove(filepath.Join(modsDir, j.Added[i])); err != nil && !os.IsNotExist(err) {
			errs = append(errs, err)
		}
	}
	for i := len(j.Renamed) - 1; i >= 0; i-- {
		r := j.Renamed[i]
		if err := os.Rename(filepath.Join(modsDir, r[1]), filepath.Join(modsDir, r[0])); err != nil {
			errs = append(errs, err)
		}
	}
	for i := len(j.Moved) - 1; i >= 0; i-- {
		if err := moveFile(filepath.Join(snapDir, j.Moved[i]), filepath.Join(modsDir, j.Moved[i])); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

// pruneSnapshots keeps the snapshots of the newest modSyncKeep syncs that can
// still be rolled back, and the history with them.
func (s *ModService) pruneSnapshots(serverID string, st *modSyncState) *modSyncState {
	if len(st.History) <= modSyncKeep {
		return st
	}
	for _, r := range st.History[modSyncKeep:] {
		if err := os.RemoveAll(filepath.Join(s.modSyncDir(), serverID, r.ID)); err != nil {
			slog.Warn("mods: remove an old sync snapshot", "server", serverID, "id", r.ID, "error", err)
		}
	}
	st.History = st.History[:modSyncKeep]
	return st
}

// --- Rollback ---

// RollbackModSync undoes the newest sync not yet undone: the files it added
// are deleted, the files it replaced or removed come back, and the mod
// manifest is what it was before.
func (s *ModService) RollbackModSync(serverID string) (models.ModSyncRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.srv != nil && s.srv.IsRunning(serverID) {
		return models.ModSyncRecord{}, errors.New("the server is running; stop it to roll back")
	}
	cfg, err := s.serverConfig(serverID)
	if err != nil {
		return models.ModSyncRecord{}, err
	}
	st, err := s.loadModSyncState(serverID)
	if err != nil {
		return models.ModSyncRecord{}, err
	}
	// History is newest first, so this is the newest sync still in effect.
	// Undoing them one at a time in that order walks the folder back through
	// the states it actually passed through.
	idx := slices.IndexFunc(st.History, func(r models.ModSyncRecord) bool { return !r.RolledBack })
	if idx < 0 {
		return models.ModSyncRecord{}, errors.New("there is no sync to roll back")
	}
	rec := st.History[idx]
	snapDir := filepath.Join(s.modSyncDir(), serverID, rec.ID)
	raw, err := os.ReadFile(filepath.Join(snapDir, "journal.json"))
	if err != nil {
		return rec, fmt.Errorf("the snapshot of that sync is gone: %w", err)
	}
	var j modSyncJournal
	if err := json.Unmarshal(raw, &j); err != nil {
		return rec, fmt.Errorf("the snapshot of that sync is unreadable: %w", err)
	}
	modsDir := filepath.Join(cfg.WorkingDir, "mods")
	if err := undoJournal(modsDir, snapDir, &j); err != nil {
		return rec, fmt.Errorf("roll back: %w", err)
	}
	var m modManifest
	if err := json.Unmarshal(j.Manifest, &m); err != nil {
		return rec, fmt.Errorf("the manifest in that snapshot is unreadable: %w", err)
	}
	if err := s.saveManifest(serverID, &m); err != nil {
		return rec, err
	}
	st.History[idx].RolledBack = true
	rec = st.History[idx]
	if err := s.saveModSyncState(serverID, st); err != nil {
		return rec, err
	}
	if err := os.RemoveAll(snapDir); err != nil {
		slog.Warn("mods: remove a rolled-back snapshot", "dir", snapDir, "error", err)
	}
	s.clearUpdateCache(serverID)
	s.bus.Emit(EventModChanged, map[string]any{"serverID": serverID})
	s.bus.Emit(EventModSyncChanged, map[string]any{"serverID": serverID})
	return rec, nil
}

// pruneModSyncCache deletes staged files no plan has touched in a week.
func (s *ModService) pruneModSyncCache() {
	dir := filepath.Join(s.modSyncDir(), "cache")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		info, err := e.Info()
		if err != nil || time.Since(info.ModTime()) < modSyncCacheAge {
			continue
		}
		if err := os.Remove(filepath.Join(dir, e.Name())); err != nil {
			slog.Debug("mods: prune sync cache", "file", e.Name(), "error", err)
		}
	}
}
