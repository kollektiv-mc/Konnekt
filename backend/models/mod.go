package models

// ModSearchQuery is the input for browsing Modrinth.
type ModSearchQuery struct {
	Query      string   `json:"query"`
	Offset     int      `json:"offset"`
	Categories []string `json:"categories"`
	Sort       string   `json:"sort"` // Modrinth index: relevance|newest|updated|downloads|follows
}

// ModSearchResult is one page of Modrinth search results.
type ModSearchResult struct {
	Hits   []ModProject `json:"hits"`
	Total  int          `json:"total"`
	Offset int          `json:"offset"`
}

// ModProject is a Modrinth project (mod, plugin, etc.) as returned by search or detail.
type ModProject struct {
	ID           string          `json:"id"`
	Slug         string          `json:"slug"`
	Title        string          `json:"title"`
	Description  string          `json:"description"`
	Body         string          `json:"body"` // full markdown body (detail endpoint only)
	IconURL      string          `json:"iconUrl"`
	Author       string          `json:"author"`
	ProjectType  string          `json:"projectType"` // "mod" | "plugin"
	Downloads    int             `json:"downloads"`
	Follows      int             `json:"follows"`
	DateModified string          `json:"dateModified"` // ISO timestamp
	Categories   []string        `json:"categories"`
	Gallery      []ModGalleryImg `json:"gallery"`
}

// ModCategory is a Modrinth content category tag.
type ModCategory struct {
	Name        string `json:"name"`
	ProjectType string `json:"projectType"`
	Header      string `json:"header"`
}

// ModGalleryImg is one image in a project's gallery.
type ModGalleryImg struct {
	URL         string `json:"url"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Featured    bool   `json:"featured"`
}

// ModVersion is one release of a Modrinth project.
type ModVersion struct {
	ID            string          `json:"id"`
	ProjectID     string          `json:"projectId"`
	Name          string          `json:"name"`
	VersionNumber string          `json:"versionNumber"`
	VersionType   string          `json:"versionType"` // "release" | "beta" | "alpha"
	GameVersions  []string        `json:"gameVersions"`
	Loaders       []string        `json:"loaders"`
	FileName      string          `json:"fileName"`
	FileURL       string          `json:"fileUrl"`
	SHA512        string          `json:"sha512"`
	FileSize      int64           `json:"fileSize"`
	Dependencies  []ModDependency `json:"dependencies"`
	DatePublished string          `json:"datePublished"`
}

// ModDependency describes a mod that another mod depends on.
type ModDependency struct {
	ProjectID      string `json:"projectId"`
	VersionID      string `json:"versionId"`      // may be empty; only projectId guaranteed
	DependencyType string `json:"dependencyType"` // "required" | "optional" | "incompatible" | "embedded"
}

// ResolvedDependency is a dependency after resolution — includes the actual
// ModVersion to install plus UX flags for the confirm dialog.
type ResolvedDependency struct {
	ProjectID        string     `json:"projectId"`
	ProjectTitle     string     `json:"projectTitle"`
	Version          ModVersion `json:"version"`
	Required         bool       `json:"required"`
	AlreadyInstalled bool       `json:"alreadyInstalled"`
}

// InstalledMod is one item in the installed list (merged from manifest + disk scan).
type InstalledMod struct {
	FileName      string `json:"fileName"`
	DisplayName   string `json:"displayName"`
	IconURL       string `json:"iconUrl"` // Modrinth project icon (empty for local)
	ModID         string `json:"modId"`
	Source        string `json:"source"`   // "modrinth" | "local"
	Provider      string `json:"provider"` // "modrinth" | ""
	ProjectID     string `json:"projectId"`
	VersionID     string `json:"versionId"`
	VersionNumber string `json:"versionNumber"`
	Loader        string `json:"loader"`
	TargetFolder  string `json:"targetFolder"` // "mods" | "plugins"
	Enabled       bool   `json:"enabled"`
	SizeBytes     int64  `json:"sizeBytes"`
	InstalledAt   int64  `json:"installedAt"` // unix ms; 0 for local/unknown
}

// ModUpdateInfo holds the result of an update check for one installed mod.
//
// FileName identifies which installed mod this is about. It used to be the key
// of a map[string]ModUpdateInfo, which read naturally in Go and broke the
// generated bindings: Wails v2.12.0 walks a bound signature's parameter and
// return types but does not descend into a *map value*, so it emitted
// `Record<string, models.ModUpdateInfo>` in App.d.ts while never declaring
// ModUpdateInfo in models.ts. tsconfig's skipLibCheck kept that dangling
// reference from being an error and the return type quietly degraded to `any`,
// so a JSON-tag rename here would have surfaced as `undefined` in the mods UI
// with a green typecheck and a green lint (HEALTH_LOG.md, 2026-08-20).
//
// Carrying the key inside the struct and returning a slice is what lets the
// generator see the type at all. Keep it that way.
type ModUpdateInfo struct {
	FileName            string `json:"fileName"`
	UpdateAvailable     bool   `json:"updateAvailable"`
	LatestVersionID     string `json:"latestVersionId"`
	LatestVersionNumber string `json:"latestVersionNumber"`
}

// JarMeta is the parsed identity info extracted from a mod/plugin jar.
type JarMeta struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Version string `json:"version"`
	Loader  string `json:"loader"` // detected loader, may be empty
}
