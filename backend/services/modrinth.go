package services

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"konnekt/backend/models"
)

const (
	modrinthBase      = "https://api.modrinth.com/v2"
	modrinthUserAgent = "Konnekt/0.1 (github.com/kollektiv-mc/konnekt)"
	modrinthPageSize  = 20
)

// loaderProjectType maps a server loader string to the Modrinth project_type facet
// and the loader string Modrinth expects in version queries.
var loaderProjectType = map[string]struct{ projectType, modrinthLoader string }{
	"fabric":   {"mod", "fabric"},
	"forge":    {"mod", "forge"},
	"neoforge": {"mod", "neoforge"},
	"quilt":    {"mod", "quilt"},
	"paper":    {"plugin", "paper"},
	"spigot":   {"plugin", "spigot"},
	"bukkit":   {"plugin", "bukkit"},
	"purpur":   {"plugin", "purpur"},
	"velocity": {"plugin", "velocity"},
	"vanilla":  {"mod", ""},
}

// ModrinthClient implements ModProvider for the Modrinth v2 API.
type ModrinthClient struct {
	http *http.Client
}

func NewModrinthClient() *ModrinthClient {
	return &ModrinthClient{
		http: &http.Client{Timeout: 30 * time.Second},
	}
}

func (c *ModrinthClient) ID() string { return "modrinth" }

// --- ModProvider implementation ---

func (c *ModrinthClient) Search(ctx context.Context, q models.ModSearchQuery, mcVersion, loader string) (models.ModSearchResult, error) {
	facets := buildFacets(mcVersion, loader, q.Categories)
	params := url.Values{
		"query":  {q.Query},
		"limit":  {strconv.Itoa(modrinthPageSize)},
		"offset": {strconv.Itoa(q.Offset)},
	}
	if facets != "" {
		params.Set("facets", facets)
	}
	if q.Sort != "" {
		params.Set("index", q.Sort)
	}

	var raw mrSearchResponse
	if err := c.doJSON(ctx, "/search?"+params.Encode(), &raw); err != nil {
		return models.ModSearchResult{}, err
	}

	seen := make(map[string]struct{}, len(raw.Hits))
	hits := make([]models.ModProject, 0, len(raw.Hits))
	for _, h := range raw.Hits {
		if _, dup := seen[h.ProjectID]; dup {
			continue
		}
		seen[h.ProjectID] = struct{}{}
		hits = append(hits, mrHitToProject(h))
	}
	return models.ModSearchResult{
		Hits:   hits,
		Total:  raw.TotalHits,
		Offset: raw.Offset,
	}, nil
}

func (c *ModrinthClient) GetProject(ctx context.Context, projectID string) (models.ModProject, error) {
	var raw mrProject
	if err := c.doJSON(ctx, "/project/"+url.PathEscape(projectID), &raw); err != nil {
		return models.ModProject{}, err
	}
	proj := mrProjectToModel(raw)
	// Resolve team members to get the owner's username.
	var members []mrMember
	if err := c.doJSON(ctx, "/project/"+url.PathEscape(projectID)+"/members", &members); err == nil {
		for _, m := range members {
			if m.Role == "Owner" {
				proj.Author = m.User.Username
				break
			}
		}
		// Fallback to first member if no Owner role found.
		if proj.Author == "" && len(members) > 0 {
			proj.Author = members[0].User.Username
		}
	}
	return proj, nil
}

func (c *ModrinthClient) GetCategories(ctx context.Context) ([]models.ModCategory, error) {
	var raw []mrCategory
	if err := c.doJSON(ctx, "/tag/category", &raw); err != nil {
		return nil, err
	}
	out := make([]models.ModCategory, len(raw))
	for i, c := range raw {
		out[i] = models.ModCategory{
			Name:        c.Name,
			ProjectType: c.ProjectType,
			Header:      c.Header,
		}
	}
	return out, nil
}

func (c *ModrinthClient) GetProjectsByAuthor(ctx context.Context, username string) ([]models.ModProject, error) {
	var raw []mrProject
	if err := c.doJSON(ctx, "/user/"+url.PathEscape(username)+"/projects", &raw); err != nil {
		return nil, err
	}
	out := make([]models.ModProject, len(raw))
	for i, p := range raw {
		out[i] = mrProjectToModel(p)
		out[i].Author = username
	}
	return out, nil
}

func (c *ModrinthClient) GetVersions(ctx context.Context, projectID, mcVersion, loader string) ([]models.ModVersion, error) {
	params := url.Values{}
	if mcVersion != "" {
		params.Set("game_versions", `["`+mcVersion+`"]`)
	}
	if loader != "" {
		if info, ok := loaderProjectType[loader]; ok && info.modrinthLoader != "" {
			params.Set("loaders", `["`+info.modrinthLoader+`"]`)
		}
	}
	path := "/project/" + url.PathEscape(projectID) + "/version"
	if len(params) > 0 {
		path += "?" + params.Encode()
	}

	var raw []mrVersion
	if err := c.doJSON(ctx, path, &raw); err != nil {
		return nil, err
	}
	return mrVersionsToModel(raw), nil
}

func (c *ModrinthClient) GetAllVersions(ctx context.Context, projectID string) ([]models.ModVersion, error) {
	var raw []mrVersion
	if err := c.doJSON(ctx, "/project/"+url.PathEscape(projectID)+"/version", &raw); err != nil {
		return nil, err
	}
	return mrVersionsToModel(raw), nil
}

func (c *ModrinthClient) GetVersion(ctx context.Context, versionID string) (models.ModVersion, error) {
	var raw mrVersion
	if err := c.doJSON(ctx, "/version/"+url.PathEscape(versionID), &raw); err != nil {
		return models.ModVersion{}, err
	}
	return mrVersionToModel(raw), nil
}

func (c *ModrinthClient) ResolveDependencies(
	ctx context.Context,
	versionID, mcVersion, loader string,
	installed map[string]bool,
) ([]models.ResolvedDependency, error) {
	seen := map[string]bool{} // projectIDs already queued
	var result []models.ResolvedDependency

	// BFS queue of (versionID, required)
	type qItem struct {
		versionID string
		required  bool
	}
	queue := []qItem{{versionID: versionID, required: true}}

	// Skip the root version itself — we only want its deps.
	if versionID != "" {
		seen[versionID] = true
	}

	for len(queue) > 0 {
		item := queue[0]
		queue = queue[1:]

		v, err := c.GetVersion(ctx, item.versionID)
		if err != nil {
			return nil, fmt.Errorf("fetching version %s: %w", item.versionID, err)
		}

		for _, dep := range v.Dependencies {
			if dep.DependencyType == "incompatible" || dep.DependencyType == "embedded" {
				continue
			}
			if seen[dep.ProjectID] {
				continue
			}
			seen[dep.ProjectID] = true

			required := dep.DependencyType == "required"

			// Resolve to a concrete version
			var depVersion models.ModVersion
			if dep.VersionID != "" {
				depVersion, err = c.GetVersion(ctx, dep.VersionID)
				if err != nil {
					return nil, fmt.Errorf("fetching dep version %s: %w", dep.VersionID, err)
				}
			} else {
				// Pick the latest compatible version for this project
				versions, err := c.GetVersions(ctx, dep.ProjectID, mcVersion, loader)
				if err != nil || len(versions) == 0 {
					// Fall back to any version if no compatible one found
					versions, err = c.GetAllVersions(ctx, dep.ProjectID)
					if err != nil || len(versions) == 0 {
						return nil, fmt.Errorf("no version found for dependency %s", dep.ProjectID)
					}
				}
				depVersion = versions[0]
			}

			// Fetch project title
			proj, err := c.GetProject(ctx, dep.ProjectID)
			title := dep.ProjectID
			if err == nil {
				title = proj.Title
			}

			result = append(result, models.ResolvedDependency{
				ProjectID:        dep.ProjectID,
				ProjectTitle:     title,
				Version:          depVersion,
				Required:         required,
				AlreadyInstalled: installed[dep.ProjectID],
			})

			// Queue required deps' transitive deps
			if required && depVersion.ID != "" {
				queue = append(queue, qItem{versionID: depVersion.ID, required: true})
			}
		}
	}

	return result, nil
}

// --- HTTP helper ---

// doJSON performs a GET against the Modrinth API, handling rate-limits (429)
// with up to 3 retries and honoring the Retry-After header.
func (c *ModrinthClient) doJSON(ctx context.Context, path string, out any) error {
	reqURL := modrinthBase + path
	const maxRetries = 3

	for attempt := 0; attempt < maxRetries; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
		if err != nil {
			return fmt.Errorf("modrinth: build request: %w", err)
		}
		req.Header.Set("User-Agent", modrinthUserAgent)

		resp, err := c.http.Do(req)
		if err != nil {
			return fmt.Errorf("modrinth: %w", err)
		}

		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		if resp.StatusCode == http.StatusTooManyRequests {
			wait := 2 * time.Second
			if ra := resp.Header.Get("Retry-After"); ra != "" {
				if secs, err := strconv.Atoi(ra); err == nil {
					wait = time.Duration(secs) * time.Second
				}
			}
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(wait):
			}
			continue
		}

		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return fmt.Errorf("modrinth: HTTP %d: %s", resp.StatusCode, truncate(string(body), 200))
		}

		if err := json.Unmarshal(body, out); err != nil {
			return fmt.Errorf("modrinth: decode response: %w", err)
		}
		return nil
	}
	return fmt.Errorf("modrinth: exceeded retry limit for %s", path)
}

// --- Facet helpers ---

// buildFacets constructs a Modrinth facets JSON string for the search endpoint.
func buildFacets(mcVersion, loader string, categories []string) string {
	var groups []string

	if loader != "" {
		if info, ok := loaderProjectType[loader]; ok {
			groups = append(groups, `["project_type:`+info.projectType+`"]`)
			if info.modrinthLoader != "" {
				groups = append(groups, `["categories:`+info.modrinthLoader+`"]`)
			}
		}
	}
	if mcVersion != "" {
		groups = append(groups, `["versions:`+mcVersion+`"]`)
	}
	for _, cat := range categories {
		if cat != "" {
			groups = append(groups, `["categories:`+cat+`"]`)
		}
	}

	if len(groups) == 0 {
		return ""
	}
	return "[" + strings.Join(groups, ",") + "]"
}

// --- Modrinth JSON shapes (private; never cross IPC) ---

type mrSearchResponse struct {
	Hits      []mrSearchHit `json:"hits"`
	TotalHits int           `json:"total_hits"`
	Offset    int           `json:"offset"`
	Limit     int           `json:"limit"`
}

type mrSearchHit struct {
	ProjectID    string   `json:"project_id"`
	Slug         string   `json:"slug"`
	Title        string   `json:"title"`
	Description  string   `json:"description"`
	IconURL      string   `json:"icon_url"`
	Author       string   `json:"author"`
	ProjectType  string   `json:"project_type"`
	Downloads    int      `json:"downloads"`
	Follows      int      `json:"follows"`
	DateModified string   `json:"date_modified"`
	Categories   []string `json:"categories"`
}

type mrProject struct {
	ID          string      `json:"id"`
	Slug        string      `json:"slug"`
	Title       string      `json:"title"`
	Description string      `json:"description"`
	Body        string      `json:"body"`
	IconURL     string      `json:"icon_url"`
	ProjectType string      `json:"project_type"`
	Downloads   int         `json:"downloads"`
	Followers   int         `json:"followers"`
	Updated     string      `json:"updated"`
	Categories  []string    `json:"categories"`
	Gallery     []mrGallery `json:"gallery"`
	Team        string      `json:"team"`
}

type mrMember struct {
	Role string `json:"role"`
	User struct {
		Username string `json:"username"`
	} `json:"user"`
}

type mrCategory struct {
	Name        string `json:"name"`
	ProjectType string `json:"project_type"`
	Header      string `json:"header"`
}

type mrGallery struct {
	URL         string `json:"url"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Featured    bool   `json:"featured"`
}

type mrVersion struct {
	ID            string         `json:"id"`
	ProjectID     string         `json:"project_id"`
	Name          string         `json:"name"`
	VersionNumber string         `json:"version_number"`
	VersionType   string         `json:"version_type"`
	GameVersions  []string       `json:"game_versions"`
	Loaders       []string       `json:"loaders"`
	Files         []mrFile       `json:"files"`
	Dependencies  []mrDependency `json:"dependencies"`
	DatePublished string         `json:"date_published"`
}

type mrFile struct {
	URL      string            `json:"url"`
	Filename string            `json:"filename"`
	Primary  bool              `json:"primary"`
	Size     int64             `json:"size"`
	Hashes   map[string]string `json:"hashes"`
}

type mrDependency struct {
	ProjectID      string `json:"project_id"`
	VersionID      string `json:"version_id"`
	DependencyType string `json:"dependency_type"`
}

// --- Mapping helpers ---

func mrHitToProject(h mrSearchHit) models.ModProject {
	return models.ModProject{
		ID:           h.ProjectID,
		Slug:         h.Slug,
		Title:        h.Title,
		Description:  h.Description,
		IconURL:      h.IconURL,
		Author:       h.Author,
		ProjectType:  h.ProjectType,
		Downloads:    h.Downloads,
		Follows:      h.Follows,
		DateModified: h.DateModified,
		Categories:   h.Categories,
	}
}

func mrProjectToModel(p mrProject) models.ModProject {
	gallery := make([]models.ModGalleryImg, len(p.Gallery))
	for i, g := range p.Gallery {
		gallery[i] = models.ModGalleryImg{
			URL:         g.URL,
			Title:       g.Title,
			Description: g.Description,
			Featured:    g.Featured,
		}
	}
	return models.ModProject{
		ID:           p.ID,
		Slug:         p.Slug,
		Title:        p.Title,
		Description:  p.Description,
		Body:         p.Body,
		IconURL:      p.IconURL,
		Author:       p.Team, // overwritten by GetProject after member lookup
		ProjectType:  p.ProjectType,
		Downloads:    p.Downloads,
		Follows:      p.Followers,
		DateModified: p.Updated,
		Categories:   p.Categories,
		Gallery:      gallery,
	}
}

func mrVersionsToModel(raw []mrVersion) []models.ModVersion {
	out := make([]models.ModVersion, len(raw))
	for i, v := range raw {
		out[i] = mrVersionToModel(v)
	}
	return out
}

func mrVersionToModel(v mrVersion) models.ModVersion {
	mv := models.ModVersion{
		ID:            v.ID,
		ProjectID:     v.ProjectID,
		Name:          v.Name,
		VersionNumber: v.VersionNumber,
		VersionType:   v.VersionType,
		GameVersions:  v.GameVersions,
		Loaders:       v.Loaders,
		DatePublished: v.DatePublished,
	}
	for _, f := range v.Files {
		if f.Primary {
			mv.FileName = f.Filename
			mv.FileURL = f.URL
			mv.FileSize = f.Size
			mv.SHA512 = f.Hashes["sha512"]
			break
		}
	}
	// Fall back to first file if no primary is marked
	if mv.FileName == "" && len(v.Files) > 0 {
		f := v.Files[0]
		mv.FileName = f.Filename
		mv.FileURL = f.URL
		mv.FileSize = f.Size
		mv.SHA512 = f.Hashes["sha512"]
	}
	mv.Dependencies = make([]models.ModDependency, len(v.Dependencies))
	for i, d := range v.Dependencies {
		mv.Dependencies[i] = models.ModDependency{
			ProjectID:      d.ProjectID,
			VersionID:      d.VersionID,
			DependencyType: d.DependencyType,
		}
	}
	return mv
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
