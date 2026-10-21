package models

// UpdateInfo is the result of checking GitHub Releases for a newer version.
type UpdateInfo struct {
	CurrentVersion  string `json:"currentVersion"`
	LatestVersion   string `json:"latestVersion"`
	UpdateAvailable bool   `json:"updateAvailable"`
	// Channel the offered release came from, "stable" or "snapshot". Set even
	// when no update is available, in which case it is the channel the check
	// ran on. The frontend branches on it to warn before installing a
	// snapshot, which is untested nightly code.
	Channel      string        `json:"channel"`
	ReleaseURL   string        `json:"releaseUrl"`
	ReleaseNotes string        `json:"releaseNotes"`
	PublishedAt  string        `json:"publishedAt"`
	Assets       []UpdateAsset `json:"assets"`
	// PackageManaged is true when the running binary was installed by a system
	// package (the RPM), which the in-place update must not replace. The
	// frontend then shows how to update through the package instead.
	PackageManaged bool `json:"packageManaged"`
}

// UpdateAsset is a single file attached to a GitHub release (a per-platform
// binary, or checksums.txt).
type UpdateAsset struct {
	Name        string `json:"name"`
	DownloadURL string `json:"downloadUrl"`
	Size        int64  `json:"size"`
}

// ReleaseNotes is what Settings > What's New shows: every published release at
// or below the running version, newest first, read from GitHub Releases.
type ReleaseNotes struct {
	Releases []ReleaseNote `json:"releases"`
	// FetchedAt is when GitHub last answered (RFC 3339), "" if it never has.
	FetchedAt string `json:"fetchedAt"`
	// Stale is true when GitHub could not be reached this time and Releases
	// came from the copy cached at FetchedAt.
	Stale bool `json:"stale"`
}

// ReleaseNote is one release's "## What's changed" section, split into the
// sections .github/scripts/release-notes.py writes (Features, Fixes, Other
// changes). A release whose body has no such section, a hand-written one,
// carries no sections and is shown as a link to its page.
type ReleaseNote struct {
	Version     string               `json:"version"`
	Snapshot    bool                 `json:"snapshot"`
	URL         string               `json:"url"`
	PublishedAt string               `json:"publishedAt"`
	Sections    []ReleaseNoteSection `json:"sections"`
}

// ReleaseNoteSection is one "### Title" heading and its bullets, each the
// title of a merged pull request.
type ReleaseNoteSection struct {
	Title string   `json:"title"`
	Items []string `json:"items"`
}
