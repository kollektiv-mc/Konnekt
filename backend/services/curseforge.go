package services

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"konnekt/backend/models"
)

const (
	// aislop-ignore-next-line ai-slop/hardcoded-url -- the canonical API base; tests point CurseForgeClient at an httptest.Server through its fields
	curseForgeBase = "https://api.curseforge.com"
	// curseForgeGameID is Minecraft's id on CurseForge.
	curseForgeGameID = 432
	// curseForgeClassMods and curseForgeClassPlugins are the two sections
	// Konnekt searches: "Mods" and "Bukkit Plugins".
	curseForgeClassMods    = 6
	curseForgeClassPlugins = 5
	curseForgePageSize     = 20
	// curseForgeMaxWindow is the API's own limit on index + pageSize.
	curseForgeMaxWindow = 10000
	// curseForgeFilesPage is the largest page /files hands out.
	curseForgeFilesPage = 50
	// curseForgeAllFilesPages bounds GetAllVersions: a long-lived mod has
	// thousands of files, and the unfiltered list is only ever a way out of
	// a server described with the wrong version.
	curseForgeAllFilesPages = 4

	// curseForgeIDPrefix marks a project or version id as CurseForge's. Its
	// ids are bare integers, which a Modrinth id could in principle also be,
	// so every id this client hands out carries the prefix and every method
	// that receives one routes on it (ModService.providerFor).
	curseForgeIDPrefix = "cf:"
)

// ErrCurseForgeNoKey is what every CurseForge call returns before anything is
// sent when no API key is configured. The tile checks CurseForgeStatus first,
// so a user only sees this from a stale view.
var ErrCurseForgeNoKey = errors.New("curseforge: no API key is set; add one in Settings, Mod sources")

// curseForgeLoaderType maps a server loader to CurseForge's ModLoaderType
// enum (1 Forge, 4 Fabric, 5 Quilt, 6 NeoForge). Absent means no filter.
var curseForgeLoaderType = map[string]int{
	"forge":    1,
	"fabric":   4,
	"quilt":    5,
	"neoforge": 6,
}

// curseForgeLoaderNames are the loader names CurseForge lists among a file's
// gameVersions, mapped to the loader strings the rest of Konnekt uses.
var curseForgeLoaderNames = map[string]string{
	"Forge":    "forge",
	"NeoForge": "neoforge",
	"Fabric":   "fabric",
	"Quilt":    "quilt",
}

// curseForgeSortField maps the tile's sort keys to ModsSearchSortField.
// CurseForge has no relevance sort, so the default and "follows" are both
// Popularity (2).
var curseForgeSortField = map[string]string{
	"":          "2",
	"relevance": "2",
	"follows":   "2",
	"downloads": "6",
	"updated":   "3",
	"newest":    "11",
}

// CurseForgeClient implements ModProvider for the CurseForge for Studios API.
//
// Every request needs an API key, read through key at call time so a key saved
// in Settings applies to the next search without a restart. Two things the API
// terms and the author's settings decide are honoured here rather than in the
// tile: a file whose author turned off third-party distribution comes back
// with no download URL and is offered as a link to its page, never fetched; and
// nothing from the API is written to disk beyond the identity of what was
// installed, which the manifest needs.
type CurseForgeClient struct {
	http    *http.Client
	baseURL string
	key     func() string

	// categories is the category list, held for the life of the process so a
	// search by category name costs one request rather than two.
	catMu      sync.Mutex
	categories []cfCategory
}

func NewCurseForgeClient(key func() string) *CurseForgeClient {
	return &CurseForgeClient{
		http:    &http.Client{Timeout: 30 * time.Second},
		baseURL: curseForgeBase,
		key:     key,
	}
}

func (c *CurseForgeClient) ID() string { return "curseforge" }

func (c *CurseForgeClient) api() providerAPI {
	return providerAPI{
		name:    "curseforge",
		http:    c.http,
		baseURL: c.baseURL,
		headers: func(h http.Header) error {
			k := c.key()
			if k == "" {
				return ErrCurseForgeNoKey
			}
			h.Set("x-api-key", k)
			h.Set("User-Agent", modrinthUserAgent)
			return nil
		},
	}
}

// get wraps a call so a refused key reads as that rather than as a status
// code: 401 and 403 are what CurseForge answers a wrong or revoked key with.
func (c *CurseForgeClient) get(ctx context.Context, path string, out any) error {
	return c.explain(c.api().getJSON(ctx, path, out))
}

func (c *CurseForgeClient) post(ctx context.Context, path string, body, out any) error {
	return c.explain(c.api().postJSON(ctx, path, body, out))
}

func (c *CurseForgeClient) explain(err error) error {
	var he *providerHTTPError
	if errors.As(err, &he) && (he.status == http.StatusUnauthorized || he.status == http.StatusForbidden) {
		return fmt.Errorf("curseforge: the API key was refused (HTTP %d); check it in Settings, Mod sources", he.status)
	}
	return err
}

// CheckKey asks CurseForge whether key works, with one cheap request, so a
// key can be refused when it is saved rather than at the first search.
func (c *CurseForgeClient) CheckKey(ctx context.Context, key string) error {
	probe := &CurseForgeClient{http: c.http, baseURL: c.baseURL, key: func() string { return key }}
	var out struct {
		Data struct {
			ID int `json:"id"`
		} `json:"data"`
	}
	return probe.get(ctx, "/v1/games/"+strconv.Itoa(curseForgeGameID), &out)
}

// --- ModProvider implementation ---

// classFor is the section a server's content lives in. Velocity has none:
// CurseForge's Bukkit section is Bukkit-API plugins only.
func curseForgeClassFor(loader string) (int, error) {
	switch loaderTargetFolder(loader) {
	case "plugins":
		if loader == "velocity" {
			return 0, errors.New("curseforge has no Velocity plugins")
		}
		return curseForgeClassPlugins, nil
	default:
		return curseForgeClassMods, nil
	}
}

func (c *CurseForgeClient) Search(ctx context.Context, q models.ModSearchQuery, mcVersion, loader string) (models.ModSearchResult, error) {
	class, err := curseForgeClassFor(loader)
	if err != nil {
		return models.ModSearchResult{}, err
	}
	params := url.Values{
		"gameId":    {strconv.Itoa(curseForgeGameID)},
		"classId":   {strconv.Itoa(class)},
		"sortField": {curseForgeSortField[q.Sort]},
		"sortOrder": {"desc"},
		"index":     {strconv.Itoa(q.Offset)},
		"pageSize":  {strconv.Itoa(curseForgePageSize)},
	}
	if q.Query != "" {
		params.Set("searchFilter", q.Query)
	}
	if mcVersion != "" {
		params.Set("gameVersion", mcVersion)
		// The API documents modLoaderType as needing gameVersion beside it.
		if t, ok := curseForgeLoaderType[loader]; ok && class == curseForgeClassMods {
			params.Set("modLoaderType", strconv.Itoa(t))
		}
	}
	if len(q.Categories) > 0 {
		ids, err := c.categoryIDs(ctx, class, q.Categories)
		if err != nil {
			return models.ModSearchResult{}, err
		}
		if len(ids) > 0 {
			params.Set("categoryIds", "["+strings.Join(ids, ",")+"]")
		}
	}
	if q.Offset+curseForgePageSize > curseForgeMaxWindow {
		return models.ModSearchResult{Offset: q.Offset}, nil
	}

	var raw struct {
		Data       []cfMod `json:"data"`
		Pagination struct {
			Index      int `json:"index"`
			TotalCount int `json:"totalCount"`
		} `json:"pagination"`
	}
	if err := c.get(ctx, "/v1/mods/search?"+params.Encode(), &raw); err != nil {
		return models.ModSearchResult{}, err
	}
	hits := make([]models.ModProject, 0, len(raw.Data))
	for _, m := range raw.Data {
		hits = append(hits, cfModToProject(m))
	}
	// The API refuses a window past 10,000, so the pager stops there too
	// rather than offering pages that answer with an error.
	total := min(raw.Pagination.TotalCount, curseForgeMaxWindow)
	return models.ModSearchResult{Hits: hits, Total: total, Offset: raw.Pagination.Index}, nil
}

func (c *CurseForgeClient) getMod(ctx context.Context, modID string) (cfMod, error) {
	var raw struct {
		Data cfMod `json:"data"`
	}
	if err := c.get(ctx, "/v1/mods/"+url.PathEscape(modID), &raw); err != nil {
		return cfMod{}, err
	}
	return raw.Data, nil
}

func (c *CurseForgeClient) GetProject(ctx context.Context, projectID string) (models.ModProject, error) {
	id, err := curseForgeNativeID(projectID)
	if err != nil {
		return models.ModProject{}, err
	}
	m, err := c.getMod(ctx, id)
	if err != nil {
		return models.ModProject{}, err
	}
	proj := cfModToProject(m)
	var desc struct {
		Data string `json:"data"`
	}
	if err := c.get(ctx, "/v1/mods/"+url.PathEscape(id)+"/description", &desc); err != nil {
		// The summary still renders; a body is a nicety.
		slog.Warn("curseforge: description unavailable", "mod", id, "error", err)
	} else {
		proj.Body = dedentHTML(desc.Data)
	}
	return proj, nil
}

func (c *CurseForgeClient) GetVersions(ctx context.Context, projectID, mcVersion, loader string) ([]models.ModVersion, error) {
	params := url.Values{"pageSize": {strconv.Itoa(curseForgeFilesPage)}}
	if mcVersion != "" {
		params.Set("gameVersion", mcVersion)
	}
	if t, ok := curseForgeLoaderType[loader]; ok {
		params.Set("modLoaderType", strconv.Itoa(t))
	}
	return c.files(ctx, projectID, params, 1)
}

func (c *CurseForgeClient) GetAllVersions(ctx context.Context, projectID string) ([]models.ModVersion, error) {
	return c.files(ctx, projectID, url.Values{"pageSize": {strconv.Itoa(curseForgeFilesPage)}}, curseForgeAllFilesPages)
}

// files lists a mod's files, newest first, as versions. The mod itself is
// fetched alongside because a file carries neither the page a manual
// download goes through nor the author's distribution setting.
func (c *CurseForgeClient) files(ctx context.Context, projectID string, params url.Values, pages int) ([]models.ModVersion, error) {
	id, err := curseForgeNativeID(projectID)
	if err != nil {
		return nil, err
	}
	m, err := c.getMod(ctx, id)
	if err != nil {
		return nil, err
	}
	var all []cfFile
	for page := 0; page < pages; page++ {
		params.Set("index", strconv.Itoa(page*curseForgeFilesPage))
		var raw struct {
			Data       []cfFile `json:"data"`
			Pagination struct {
				TotalCount int `json:"totalCount"`
			} `json:"pagination"`
		}
		if err := c.get(ctx, "/v1/mods/"+url.PathEscape(id)+"/files?"+params.Encode(), &raw); err != nil {
			return nil, err
		}
		all = append(all, raw.Data...)
		if len(raw.Data) < curseForgeFilesPage || len(all) >= raw.Pagination.TotalCount {
			break
		}
	}
	// Newest first, which is the order the tile and installLatest assume.
	// The API does not promise one.
	slices.SortStableFunc(all, func(a, b cfFile) int { return strings.Compare(b.FileDate, a.FileDate) })
	out := make([]models.ModVersion, 0, len(all))
	for _, f := range all {
		if !f.IsAvailable || f.IsServerPack {
			continue
		}
		out = append(out, cfFileToVersion(f, m))
	}
	return out, nil
}

func (c *CurseForgeClient) GetVersion(ctx context.Context, versionID string) (models.ModVersion, error) {
	id, err := curseForgeNativeID(versionID)
	if err != nil {
		return models.ModVersion{}, err
	}
	fileID, err := strconv.Atoi(id)
	if err != nil {
		return models.ModVersion{}, fmt.Errorf("curseforge: bad file id %q", versionID)
	}
	var raw struct {
		Data []cfFile `json:"data"`
	}
	if err := c.post(ctx, "/v1/mods/files", map[string][]int{"fileIds": {fileID}}, &raw); err != nil {
		return models.ModVersion{}, err
	}
	if len(raw.Data) == 0 {
		return models.ModVersion{}, fmt.Errorf("curseforge: no file %s", id)
	}
	f := raw.Data[0]
	m, err := c.getMod(ctx, strconv.Itoa(f.ModID))
	if err != nil {
		return models.ModVersion{}, err
	}
	return cfFileToVersion(f, m), nil
}

// GetVersionsByHashes answers that it recognises nothing. CurseForge
// identifies a jar by its own fingerprint rather than a SHA-512 (#249), and
// identification stays with Modrinth until per-provider state exists (#250).
func (c *CurseForgeClient) GetVersionsByHashes(context.Context, []string) (map[string]models.ModVersion, error) {
	return map[string]models.ModVersion{}, nil
}

// ResolveDependencies walks required and optional dependencies breadth-first.
// A CurseForge dependency names a mod and never a file, so each one resolves
// to the newest file for this server, else the newest there is. A dependency
// whose author opted out of third-party downloads comes back with its PageURL
// and no FileURL, for the confirm dialog to offer as a manual download.
func (c *CurseForgeClient) ResolveDependencies(
	ctx context.Context,
	versionID, mcVersion, loader string,
	installed map[string]bool,
) ([]models.ResolvedDependency, error) {
	root, err := c.GetVersion(ctx, versionID)
	if err != nil {
		return nil, fmt.Errorf("fetching version %s: %w", versionID, err)
	}
	seen := map[string]bool{root.ProjectID: true}
	queue := [][]models.ModDependency{root.Dependencies}
	var result []models.ResolvedDependency

	for len(queue) > 0 {
		deps := queue[0]
		queue = queue[1:]
		for _, dep := range deps {
			if dep.DependencyType != "required" && dep.DependencyType != "optional" {
				continue
			}
			if seen[dep.ProjectID] {
				continue
			}
			seen[dep.ProjectID] = true
			required := dep.DependencyType == "required"
			alreadyInstalled := installed[dep.ProjectID]

			versions, verr := c.GetVersions(ctx, dep.ProjectID, mcVersion, loader)
			if verr == nil && len(versions) == 0 {
				versions, verr = c.GetAllVersions(ctx, dep.ProjectID)
			}
			if verr != nil || len(versions) == 0 {
				if required && !alreadyInstalled {
					if verr == nil {
						verr = fmt.Errorf("no file found for dependency %s", dep.ProjectID)
					}
					return nil, verr
				}
				slog.Warn("curseforge: leaving a dependency unresolved",
					"project", dep.ProjectID, "required", required, "error", verr)
				continue
			}
			v := versions[0]
			title := dep.ProjectID
			if id, err := curseForgeNativeID(dep.ProjectID); err == nil {
				if m, err := c.getMod(ctx, id); err == nil && m.Name != "" {
					title = m.Name
				}
			}
			result = append(result, models.ResolvedDependency{
				ProjectID:        dep.ProjectID,
				ProjectTitle:     title,
				Version:          v,
				Required:         required,
				AlreadyInstalled: alreadyInstalled,
			})
			if required {
				queue = append(queue, v.Dependencies)
			}
		}
	}
	return result, nil
}

func (c *CurseForgeClient) loadCategories(ctx context.Context) ([]cfCategory, error) {
	c.catMu.Lock()
	defer c.catMu.Unlock()
	if c.categories != nil {
		return c.categories, nil
	}
	var raw struct {
		Data []cfCategory `json:"data"`
	}
	if err := c.get(ctx, "/v1/categories?gameId="+strconv.Itoa(curseForgeGameID), &raw); err != nil {
		return nil, err
	}
	c.categories = raw.Data
	return c.categories, nil
}

// GetCategories lists the categories of the two sections Konnekt searches,
// tagged with the project type ModService filters them by.
func (c *CurseForgeClient) GetCategories(ctx context.Context) ([]models.ModCategory, error) {
	all, err := c.loadCategories(ctx)
	if err != nil {
		return nil, err
	}
	var out []models.ModCategory
	for _, cat := range all {
		if cat.IsClass {
			continue
		}
		switch cat.ClassID {
		case curseForgeClassMods:
			out = append(out, models.ModCategory{Name: cat.Name, ProjectType: "mod", Header: "categories"})
		case curseForgeClassPlugins:
			out = append(out, models.ModCategory{Name: cat.Name, ProjectType: "plugin", Header: "categories"})
		}
	}
	slices.SortFunc(out, func(a, b models.ModCategory) int { return strings.Compare(a.Name, b.Name) })
	return out, nil
}

// categoryIDs turns category names back into ids within one section. The API
// takes at most ten.
func (c *CurseForgeClient) categoryIDs(ctx context.Context, class int, names []string) ([]string, error) {
	all, err := c.loadCategories(ctx)
	if err != nil {
		return nil, err
	}
	var ids []string
	for _, cat := range all {
		if cat.ClassID == class && !cat.IsClass && slices.Contains(names, cat.Name) {
			ids = append(ids, strconv.Itoa(cat.ID))
		}
	}
	if len(ids) > 10 {
		ids = ids[:10]
	}
	return ids, nil
}

// GetProjectsByAuthor finds nothing: the tile knows an author by name, and
// CurseForge filters by author id only.
func (c *CurseForgeClient) GetProjectsByAuthor(context.Context, string) ([]models.ModProject, error) {
	return nil, nil
}

// --- ids ---

func isCurseForgeID(id string) bool { return strings.HasPrefix(id, curseForgeIDPrefix) }

// curseForgeNativeID strips the prefix and refuses anything but digits, so
// an id that arrived over IPC cannot reach a URL path as anything else.
func curseForgeNativeID(id string) (string, error) {
	n := strings.TrimPrefix(id, curseForgeIDPrefix)
	if n == "" || n == id {
		return "", fmt.Errorf("curseforge: not a CurseForge id: %q", id)
	}
	if _, err := strconv.ParseUint(n, 10, 32); err != nil {
		return "", fmt.Errorf("curseforge: not a CurseForge id: %q", id)
	}
	return n, nil
}

func cfID(n int) string { return curseForgeIDPrefix + strconv.Itoa(n) }

// --- CurseForge JSON shapes (private; never cross IPC) ---

type cfMod struct {
	ID      int    `json:"id"`
	Name    string `json:"name"`
	Slug    string `json:"slug"`
	Summary string `json:"summary"`
	Links   struct {
		WebsiteURL string `json:"websiteUrl"`
	} `json:"links"`
	DownloadCount int64        `json:"downloadCount"`
	ThumbsUpCount int          `json:"thumbsUpCount"`
	DateModified  string       `json:"dateModified"`
	ClassID       int          `json:"classId"`
	Categories    []cfCategory `json:"categories"`
	Authors       []struct {
		Name string `json:"name"`
	} `json:"authors"`
	Logo        *cfAsset  `json:"logo"`
	Screenshots []cfAsset `json:"screenshots"`
	LatestFiles []cfFile  `json:"latestFiles"`
	// AllowModDistribution is nullable in the schema. Only an explicit false
	// marks the mod as manual-download; a file's own missing downloadUrl is
	// the other, per-file signal.
	AllowModDistribution *bool `json:"allowModDistribution"`
}

type cfAsset struct {
	Title        string `json:"title"`
	Description  string `json:"description"`
	ThumbnailURL string `json:"thumbnailUrl"`
	URL          string `json:"url"`
}

type cfCategory struct {
	ID      int    `json:"id"`
	Name    string `json:"name"`
	ClassID int    `json:"classId"`
	IsClass bool   `json:"isClass"`
}

type cfFile struct {
	ID           int      `json:"id"`
	ModID        int      `json:"modId"`
	IsAvailable  bool     `json:"isAvailable"`
	DisplayName  string   `json:"displayName"`
	FileName     string   `json:"fileName"`
	ReleaseType  int      `json:"releaseType"`
	FileDate     string   `json:"fileDate"`
	FileLength   int64    `json:"fileLength"`
	DownloadURL  string   `json:"downloadUrl"`
	GameVersions []string `json:"gameVersions"`
	Hashes       []struct {
		Value string `json:"value"`
		Algo  int    `json:"algo"`
	} `json:"hashes"`
	Dependencies []struct {
		ModID        int `json:"modId"`
		RelationType int `json:"relationType"`
	} `json:"dependencies"`
	IsServerPack bool `json:"isServerPack"`
}

// --- Mapping helpers ---

// curseForgeClientOnly reads the Client and Server tags CurseForge lists among
// a file's game versions. Only "Client without Server" is client-only; a file
// that names neither says nothing, which is most of them, so CurseForge flags
// far fewer client-only mods than Modrinth does.
func curseForgeClientOnly(gameVersions []string) bool {
	return slices.Contains(gameVersions, "Client") && !slices.Contains(gameVersions, "Server")
}

func cfModToProject(m cfMod) models.ModProject {
	p := models.ModProject{
		ID:             cfID(m.ID),
		Slug:           m.Slug,
		Title:          m.Name,
		Description:    m.Summary,
		ProjectType:    "mod",
		Downloads:      int(m.DownloadCount),
		Follows:        m.ThumbsUpCount,
		DateModified:   m.DateModified,
		Source:         "curseforge",
		PageURL:        curseForgePageURL(m.Links.WebsiteURL),
		ManualDownload: m.AllowModDistribution != nil && !*m.AllowModDistribution,
	}
	if m.ClassID == curseForgeClassPlugins {
		p.ProjectType = "plugin"
	}
	if m.Logo != nil {
		p.IconURL = m.Logo.ThumbnailURL
	}
	if len(m.Authors) > 0 {
		p.Author = m.Authors[0].Name
	}
	for _, cat := range m.Categories {
		p.Categories = append(p.Categories, cat.Name)
	}
	for _, s := range m.Screenshots {
		p.Gallery = append(p.Gallery, models.ModGalleryImg{URL: s.URL, Title: s.Title, Description: s.Description})
	}
	if len(m.LatestFiles) > 0 {
		p.ClientOnly = true
		for _, f := range m.LatestFiles {
			if !curseForgeClientOnly(f.GameVersions) {
				p.ClientOnly = false
				break
			}
		}
	}
	return p
}

var cfReleaseType = map[int]string{1: "release", 2: "beta", 3: "alpha"}

// cfDependencyType maps FileRelationType onto the dependency types the
// confirm dialog knows. A Tool (4) is a separate program, not a mod to load.
var cfDependencyType = map[int]string{
	1: "embedded",
	2: "optional",
	3: "required",
	5: "incompatible",
	6: "embedded",
}

func cfFileToVersion(f cfFile, m cfMod) models.ModVersion {
	v := models.ModVersion{
		ID:            cfID(f.ID),
		ProjectID:     cfID(f.ModID),
		Name:          f.DisplayName,
		VersionNumber: f.DisplayName,
		VersionType:   cfReleaseType[f.ReleaseType],
		FileName:      f.FileName,
		FileSize:      f.FileLength,
		DatePublished: f.FileDate,
		ClientOnly:    curseForgeClientOnly(f.GameVersions),
	}
	for _, gv := range f.GameVersions {
		if loader, ok := curseForgeLoaderNames[gv]; ok {
			v.Loaders = append(v.Loaders, loader)
		} else if gv != "" && gv[0] >= '0' && gv[0] <= '9' {
			v.GameVersions = append(v.GameVersions, gv)
		}
	}
	for _, h := range f.Hashes {
		if h.Algo == 1 {
			v.SHA1 = strings.ToLower(h.Value)
		}
	}
	for _, d := range f.Dependencies {
		if t, ok := cfDependencyType[d.RelationType]; ok {
			v.Dependencies = append(v.Dependencies, models.ModDependency{ProjectID: cfID(d.ModID), DependencyType: t})
		}
	}
	// The author's setting wins over a URL that happens to be present: the
	// opt-out is consent withdrawn, and the review CurseForge applies to every
	// key asks how an app honours it.
	optedOut := m.AllowModDistribution != nil && !*m.AllowModDistribution
	if f.DownloadURL != "" && !optedOut {
		v.FileURL = f.DownloadURL
	}
	if page := curseForgePageURL(m.Links.WebsiteURL); page != "" {
		v.PageURL = strings.TrimRight(page, "/") + "/files/" + strconv.Itoa(f.ID)
	}
	return v
}

// curseForgePageURL keeps a project page only when it is https on
// curseforge.com: the frontend hands it to the system browser, so a URL the
// API returns is never trusted with another scheme or host.
func curseForgePageURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil {
		return ""
	}
	host := u.Hostname()
	if host != "curseforge.com" && !strings.HasSuffix(host, ".curseforge.com") {
		return ""
	}
	return u.String()
}

var leadingSpace = regexp.MustCompile(`(?m)^[ \t]+`)

// dedentHTML strips each line's indentation from a CurseForge description.
// The body is HTML, rendered by the tile's Markdown pipeline, and in Markdown
// four leading spaces after a blank line make a code block: an indented
// description would render as a wall of escaped tags. Whitespace inside a
// <pre> matters, so a description with one is left alone.
func dedentHTML(s string) string {
	if strings.Contains(strings.ToLower(s), "<pre") {
		return s
	}
	return leadingSpace.ReplaceAllString(s, "")
}
