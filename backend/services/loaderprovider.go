package services

import (
	"context"

	"konnekt/backend/models"
)

// LoaderProvider is the abstraction layer for a mod loader's distribution.
// NeoForge is the only implementation this phase; Forge, Fabric and Paper can
// slot in later (issue #174), which is what this interface is shaped for.
//
// It deliberately mirrors ModProvider: one interface per registry, injectable
// base URL on the implementation so tests can point it at an httptest.Server.
type LoaderProvider interface {
	// ID returns the loader string this provider serves, matching
	// models.ServerConfig.Loader ("neoforge").
	ID() string

	// Versions lists published builds, newest first. An empty mcVersion returns
	// everything; otherwise only builds targeting that Minecraft version.
	Versions(ctx context.Context, mcVersion string) ([]models.LoaderVersion, error)

	// InstallerURL is where the installer jar for one build is downloaded from.
	// Building it is a pure string operation: the URL is conventional, so no
	// round trip is needed to discover it.
	InstallerURL(version string) string
}
