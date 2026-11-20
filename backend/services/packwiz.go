package services

import (
	"context"
	"crypto/md5"  //nolint:gosec // md5 only compares a file already on disk with a pack's md5; it never vouches for a download (packHashStrong)
	"crypto/sha1" //nolint:gosec // sha1 is a packwiz hash format; see packHashStrong
	"crypto/sha256"
	"crypto/sha512"
	"encoding/hex"
	"errors"
	"fmt"
	"hash"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/BurntSushi/toml"
)

// A packwiz pack (#456) is a pack.toml, an index.toml it names by hash, and
// one metafile (*.pw.toml) per mod, each naming its download by hash. Read in
// that order, every byte below pack.toml is checked against a hash the file
// above it gave, so a pack is exactly as trustworthy as its pack.toml.
//
// The format is packwiz's own: https://packwiz.infra.link/reference/pack-format/.
// What a dedicated server does with it follows packwiz-installer (v0.5.14,
// read 2026-11-20): a metafile's side defaults to "both" (target/Side.kt), and
// a plain index entry carries no side at all (DownloadTask.correctSide), so
// first-party jars a pack ships as plain files go to every side.

const (
	// packMetaLimit bounds pack.toml and one metafile. A real one is a few
	// hundred bytes.
	packMetaLimit = 256 << 10
	// packIndexLimit bounds index.toml. Frangfurd's, 1,500 files, is 120 KB.
	packIndexLimit = 16 << 20
	// packFetchTimeout bounds one metadata request.
	packFetchTimeout = 30 * time.Second
	// packFetchParallel is how many metafiles are read at once.
	packFetchParallel = 8
)

// packwizPackFile is pack.toml.
type packwizPackFile struct {
	Name     string            `toml:"name"`
	Version  string            `toml:"version"`
	Versions map[string]string `toml:"versions"`
	Index    struct {
		File       string `toml:"file"`
		HashFormat string `toml:"hash-format"`
		Hash       string `toml:"hash"`
	} `toml:"index"`
}

// packwizIndexFile is index.toml.
type packwizIndexFile struct {
	HashFormat string             `toml:"hash-format"`
	Files      []packwizIndexItem `toml:"files"`
}

type packwizIndexItem struct {
	File       string `toml:"file"`
	Hash       string `toml:"hash"`
	HashFormat string `toml:"hash-format"`
	Alias      string `toml:"alias"`
	Metafile   bool   `toml:"metafile"`
	Preserve   bool   `toml:"preserve"`
}

// packwizMetaFile is one *.pw.toml.
type packwizMetaFile struct {
	Name     string `toml:"name"`
	Filename string `toml:"filename"`
	Side     string `toml:"side"`
	Download struct {
		URL        string `toml:"url"`
		HashFormat string `toml:"hash-format"`
		Hash       string `toml:"hash"`
		Mode       string `toml:"mode"`
	} `toml:"download"`
	Update struct {
		Modrinth *struct {
			ModID   string `toml:"mod-id"`
			Version string `toml:"version"`
		} `toml:"modrinth"`
	} `toml:"update"`
}

// packEntry is one file of a resolved pack that lands in mods/, whatever the
// pack's format. Plan works on these and nothing format-specific.
type packEntry struct {
	// Key is the name Exclude and Include match: a metafile's base name
	// without ".pw.toml", or a plain file's name.
	Key      string
	FileName string
	Name     string
	Side     string // "both" | "client" | "server"
	// HashFormat and Hash identify the file's bytes.
	HashFormat string
	Hash       string
	// URL is where to download it; LocalPath where to copy it from instead,
	// for a plain file in a folder source. CurseForge is a metafile whose
	// download is "metadata:curseforge": no URL, only an API lookup Konnekt
	// has no key for (#253).
	URL        string
	LocalPath  string
	CurseForge bool
	// ProjectID and VersionID are the Modrinth ids a metafile's update
	// section names, when it does.
	ProjectID string
	VersionID string
}

// resolvedPack is a pack read and checked, reduced to what a server needs.
type resolvedPack struct {
	Name          string
	Version       string
	Minecraft     string
	Loader        string
	LoaderVersion string
	Fingerprint   string
	// Host is the pack's own host for a url source, the one host besides the
	// mod CDNs that plain files are downloaded from.
	Host    string
	Entries []packEntry
}

// packReader reads a pack's files by their path relative to pack.toml's
// folder. Implemented over https for a url source and over the disk for a
// folder source.
type packReader interface {
	read(ctx context.Context, rel string, limit int64) ([]byte, error)
	// locate is where a plain file is fetched from: a URL, or a local path.
	locate(rel string) (fileURL, localPath string, err error)
}

// packLoaders are the pack.toml [versions] keys that name a loader, mapped to
// the loader names Konnekt's server config uses.
var packLoaders = map[string]string{
	"neoforge": "neoforge",
	"forge":    "forge",
	"fabric":   "fabric",
	"quilt":    "quilt",
}

// resolvePackwiz reads a packwiz pack through r and returns the entries that
// land in mods/. Every file it reads past pack.toml is checked against the
// hash the file above it gave.
func resolvePackwiz(ctx context.Context, r packReader) (resolvedPack, error) {
	raw, err := r.read(ctx, "pack.toml", packMetaLimit)
	if err != nil {
		return resolvedPack{}, fmt.Errorf("read pack.toml: %w", err)
	}
	var pf packwizPackFile
	if _, err := toml.Decode(string(raw), &pf); err != nil {
		return resolvedPack{}, fmt.Errorf("pack.toml: %w", err)
	}
	sum := sha256.Sum256(raw)
	out := resolvedPack{
		Name:        pf.Name,
		Version:     pf.Version,
		Minecraft:   pf.Versions["minecraft"],
		Fingerprint: hex.EncodeToString(sum[:]),
	}
	for key, loader := range packLoaders {
		if v, ok := pf.Versions[key]; ok {
			out.Loader, out.LoaderVersion = loader, v
		}
	}

	indexRel, err := cleanPackPath(pf.Index.File)
	if err != nil {
		return resolvedPack{}, fmt.Errorf("pack.toml index: %w", err)
	}
	indexRaw, err := r.read(ctx, indexRel, packIndexLimit)
	if err != nil {
		return resolvedPack{}, fmt.Errorf("read %s: %w", indexRel, err)
	}
	if err := checkPackHash(indexRaw, pf.Index.HashFormat, pf.Index.Hash); err != nil {
		return resolvedPack{}, fmt.Errorf("%s: %w", indexRel, err)
	}
	var idx packwizIndexFile
	if _, err := toml.Decode(string(indexRaw), &idx); err != nil {
		return resolvedPack{}, fmt.Errorf("%s: %w", indexRel, err)
	}
	// Index paths are relative to the index's own folder.
	indexDir := path.Dir(indexRel)

	type job struct {
		item packwizIndexItem
		rel  string
	}
	var jobs []job
	for _, it := range idx.Files {
		rel, err := cleanPackPath(path.Join(indexDir, it.File))
		if err != nil {
			return resolvedPack{}, fmt.Errorf("index entry %q: %w", it.File, err)
		}
		if it.HashFormat == "" {
			it.HashFormat = idx.HashFormat
		}
		jobs = append(jobs, job{item: it, rel: rel})
	}

	entries := make([]*packEntry, len(jobs))
	errs := make([]error, len(jobs))
	sem := make(chan struct{}, packFetchParallel)
	var wg sync.WaitGroup
	for i, j := range jobs {
		// Only what lands directly in mods/ is a server's business here.
		// Configs and other folders are a later, opt-in step.
		if !j.item.Metafile {
			dest := j.rel
			if j.item.Alias != "" {
				a, err := cleanPackPath(path.Join(indexDir, j.item.Alias))
				if err != nil {
					return resolvedPack{}, fmt.Errorf("index entry %q alias: %w", j.item.File, err)
				}
				dest = a
			}
			if path.Dir(dest) != "mods" || !strings.HasSuffix(dest, ".jar") {
				continue
			}
			fileURL, local, err := r.locate(j.rel)
			if err != nil {
				return resolvedPack{}, err
			}
			name := path.Base(dest)
			entries[i] = &packEntry{
				Key: name, FileName: name, Name: name, Side: "both",
				HashFormat: j.item.HashFormat, Hash: strings.ToLower(j.item.Hash),
				URL: fileURL, LocalPath: local,
			}
			continue
		}
		if path.Dir(j.rel) != "mods" {
			continue
		}
		wg.Add(1)
		go func(i int, j job) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			e, err := readPackwizMeta(ctx, r, j.rel, j.item)
			entries[i], errs[i] = e, err
		}(i, j)
	}
	wg.Wait()
	if err := errors.Join(errs...); err != nil {
		return resolvedPack{}, err
	}
	for _, e := range entries {
		if e != nil {
			out.Entries = append(out.Entries, *e)
		}
	}
	sort.Slice(out.Entries, func(a, b int) bool { return out.Entries[a].FileName < out.Entries[b].FileName })
	return out, nil
}

// readPackwizMeta reads and checks one metafile.
func readPackwizMeta(ctx context.Context, r packReader, rel string, it packwizIndexItem) (*packEntry, error) {
	raw, err := r.read(ctx, rel, packMetaLimit)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", rel, err)
	}
	if err := checkPackHash(raw, it.HashFormat, it.Hash); err != nil {
		return nil, fmt.Errorf("%s: %w", rel, err)
	}
	var mf packwizMetaFile
	if _, err := toml.Decode(string(raw), &mf); err != nil {
		return nil, fmt.Errorf("%s: %w", rel, err)
	}
	name := mf.Filename
	if name == "" || name != path.Base(name) || strings.ContainsAny(name, `/\`) || name == "." || name == ".." {
		return nil, fmt.Errorf("%s: invalid file name %q", rel, mf.Filename)
	}
	side := strings.ToLower(mf.Side)
	switch side {
	case "":
		side = "both"
	case "both", "client", "server":
	default:
		return nil, fmt.Errorf("%s: unknown side %q", rel, mf.Side)
	}
	e := &packEntry{
		Key:        strings.TrimSuffix(path.Base(rel), ".pw.toml"),
		FileName:   name,
		Name:       mf.Name,
		Side:       side,
		HashFormat: strings.ToLower(mf.Download.HashFormat),
		Hash:       strings.ToLower(mf.Download.Hash),
		URL:        mf.Download.URL,
	}
	if e.Name == "" {
		e.Name = name
	}
	switch mf.Download.Mode {
	case "", "url":
		if e.URL == "" {
			return nil, fmt.Errorf("%s: no download url", rel)
		}
	case "metadata:curseforge":
		e.CurseForge = true
		e.URL = ""
	default:
		return nil, fmt.Errorf("%s: unsupported download mode %q", rel, mf.Download.Mode)
	}
	if m := mf.Update.Modrinth; m != nil {
		e.ProjectID, e.VersionID = m.ModID, m.Version
	}
	return e, nil
}

// cleanPackPath refuses a pack path that is absolute or climbs out of the
// pack, and returns it in slash form. A pack is untrusted input, and these
// paths become file names on the server's disk and paths under the pack's
// own folder.
func cleanPackPath(p string) (string, error) {
	if p == "" {
		return "", errors.New("empty path")
	}
	// A colon is checked by hand because filepath.VolumeName only knows "C:"
	// on Windows, and a pack is read on every platform.
	if strings.ContainsAny(p, `\:`) || path.IsAbs(p) || filepath.IsAbs(p) {
		return "", fmt.Errorf("path %q is not relative", p)
	}
	c := path.Clean(p)
	if c == "." || c == ".." || strings.HasPrefix(c, "../") {
		return "", fmt.Errorf("path %q leaves the pack", p)
	}
	return c, nil
}

// --- Hashes ---

// newPackHasher returns a hasher for a packwiz hash format. murmur2, the one
// format packwiz accepts that is not here, is CurseForge's fingerprint and
// only appears beside a CurseForge download Konnekt cannot make anyway.
func newPackHasher(format string) (hash.Hash, error) {
	switch strings.ToLower(format) {
	case "sha512":
		return sha512.New(), nil
	case "sha256":
		return sha256.New(), nil
	case "sha1":
		return sha1.New(), nil //nolint:gosec // see the import
	case "md5":
		return md5.New(), nil //nolint:gosec // see the import
	}
	return nil, fmt.Errorf("unsupported hash format %q", format)
}

// packHashStrong reports whether a format may vouch for a download. md5 can
// only recognise a file already on the server: a pack that names a download
// by md5 alone is not fetched.
func packHashStrong(format string) bool {
	switch strings.ToLower(format) {
	case "sha512", "sha256", "sha1":
		return true
	}
	return false
}

func checkPackHash(data []byte, format, want string) error {
	h, err := newPackHasher(format)
	if err != nil {
		return err
	}
	h.Write(data)
	if got := hex.EncodeToString(h.Sum(nil)); !strings.EqualFold(got, want) {
		return fmt.Errorf("%s mismatch", format)
	}
	return nil
}

// hashFileAs hashes the file at p in the given format.
func hashFileAs(p, format string) (string, error) {
	h, err := newPackHasher(format)
	if err != nil {
		return "", err
	}
	f, err := os.Open(p)
	if err != nil {
		return "", err
	}
	defer f.Close()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// --- Readers ---

// folderPackReader reads a pack from a folder on this machine: a git checkout
// of a pack repository, or a packwiz project being worked on.
type folderPackReader struct{ root string }

func (f folderPackReader) abs(rel string) (string, error) {
	c, err := cleanPackPath(rel)
	if err != nil {
		return "", err
	}
	p := filepath.Join(f.root, filepath.FromSlash(c))
	if err := sandboxCheck(f.root, p); err != nil {
		return "", err
	}
	return p, nil
}

func (f folderPackReader) read(_ context.Context, rel string, limit int64) ([]byte, error) {
	p, err := f.abs(rel)
	if err != nil {
		return nil, err
	}
	fh, err := os.Open(p)
	if err != nil {
		return nil, err
	}
	defer fh.Close()
	return readLimited(fh, limit)
}

func (f folderPackReader) locate(rel string) (string, string, error) {
	p, err := f.abs(rel)
	return "", p, err
}

// urlPackReader reads a pack served over https, such as packwiz's own
// "packwiz serve" output pushed to a static host.
type urlPackReader struct {
	base   *url.URL // pack.toml's URL
	client *http.Client
}

// parsePackURL checks a pack.toml address. https, or http to this machine
// only, which is what "packwiz serve" gives while a pack is being tested.
func parsePackURL(raw string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return nil, fmt.Errorf("pack address: %w", err)
	}
	if u.User != nil {
		return nil, errors.New("pack address: credentials in the address are not accepted")
	}
	switch u.Scheme {
	case "https":
	case "http":
		if !isLoopbackHost(u.Hostname()) {
			return nil, errors.New("pack address: http is accepted only for this machine (packwiz serve); use https")
		}
	default:
		return nil, errors.New("pack address: must be an https address of pack.toml")
	}
	if u.Hostname() == "" {
		return nil, errors.New("pack address: no host")
	}
	if path.Base(u.Path) != "pack.toml" {
		return nil, errors.New("pack address: must end in /pack.toml")
	}
	u.RawQuery, u.Fragment = "", ""
	return u, nil
}

func isLoopbackHost(h string) bool {
	if h == "localhost" {
		return true
	}
	ip := net.ParseIP(h)
	return ip != nil && ip.IsLoopback()
}

func newURLPackReader(raw string, client *http.Client) (*urlPackReader, error) {
	u, err := parsePackURL(raw)
	if err != nil {
		return nil, err
	}
	if client == nil {
		client = &http.Client{}
	}
	c := *client
	scheme := u.Scheme
	c.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("too many redirects")
		}
		if req.URL.Scheme != scheme {
			return fmt.Errorf("redirect to %s refused", req.URL.Redacted())
		}
		return nil
	}
	return &urlPackReader{base: u, client: &c}, nil
}

// fileURL resolves a pack path against pack.toml's URL, escaping each
// segment: pack file names carry spaces and brackets.
func (u *urlPackReader) fileURL(rel string) (*url.URL, error) {
	c, err := cleanPackPath(rel)
	if err != nil {
		return nil, err
	}
	segs := strings.Split(c, "/")
	for i, s := range segs {
		segs[i] = url.PathEscape(s)
	}
	ref, err := url.Parse(strings.Join(segs, "/"))
	if err != nil {
		return nil, err
	}
	return u.base.ResolveReference(ref), nil
}

func (u *urlPackReader) read(ctx context.Context, rel string, limit int64) ([]byte, error) {
	target, err := u.fileURL(rel)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, packFetchTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", modrinthUserAgent)
	req.Header.Set("Cache-Control", "no-cache")
	resp, err := u.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return readLimited(resp.Body, limit)
}

func (u *urlPackReader) locate(rel string) (string, string, error) {
	target, err := u.fileURL(rel)
	if err != nil {
		return "", "", err
	}
	return target.String(), "", nil
}

// readLimited reads at most limit bytes and fails on more, rather than
// silently truncating a file whose hash is about to be checked.
func readLimited(r io.Reader, limit int64) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(r, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("larger than %d bytes", limit)
	}
	return data, nil
}
