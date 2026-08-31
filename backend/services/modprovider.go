package services

import (
	"context"

	"konnekt/backend/models"
)

// ModProvider is the abstraction layer for mod/plugin registries.
// Modrinth is the only implementation this phase; CurseForge can slot in later.
type ModProvider interface {
	// ID returns a stable identifier for this provider ("modrinth").
	ID() string

	// Search queries the registry with optional MC version + loader facets.
	Search(ctx context.Context, q models.ModSearchQuery, mcVersion, loader string) (models.ModSearchResult, error)

	// GetProject fetches full project details including the markdown body and gallery.
	GetProject(ctx context.Context, projectID string) (models.ModProject, error)

	// GetVersions lists versions compatible with the given MC version and loader.
	// If mcVersion or loader are empty, no filter is applied for that facet.
	GetVersions(ctx context.Context, projectID, mcVersion, loader string) ([]models.ModVersion, error)

	// GetAllVersions lists all versions for a project without compatibility filtering.
	GetAllVersions(ctx context.Context, projectID string) ([]models.ModVersion, error)

	// GetVersion fetches a single version by ID.
	GetVersion(ctx context.Context, versionID string) (models.ModVersion, error)

	// GetVersionsByHashes identifies files by their content, mapping each
	// SHA-512 the registry recognises to the version that ships it. This is the
	// only way to recognise a jar Konnekt did not download itself, and the only
	// way to recognise a version's secondary files at all — EssentialsX ships
	// its modules that way, so EssentialsXChat.jar is a file of the EssentialsX
	// version rather than a project of its own, and no filename could resolve
	// it. Hashes the registry does not know are simply absent from the result;
	// that is an answer, not an error.
	GetVersionsByHashes(ctx context.Context, hashes []string) (map[string]models.ModVersion, error)

	// ResolveDependencies walks the dependency graph of a version breadth-first,
	// dedupes by projectID, and picks a compatible version per dependency.
	// Already-installed project IDs are passed in to set AlreadyInstalled flags.
	ResolveDependencies(ctx context.Context, versionID, mcVersion, loader string, installed map[string]bool) ([]models.ResolvedDependency, error)

	// GetCategories returns the list of available content categories.
	GetCategories(ctx context.Context) ([]models.ModCategory, error)

	// GetProjectsByAuthor returns all projects published by a given username.
	GetProjectsByAuthor(ctx context.Context, username string) ([]models.ModProject, error)
}
