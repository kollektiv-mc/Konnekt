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
}

// UpdateAsset is a single file attached to a GitHub release (a per-platform
// binary, or checksums.txt).
type UpdateAsset struct {
	Name        string `json:"name"`
	DownloadURL string `json:"downloadUrl"`
	Size        int64  `json:"size"`
}
