package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"konnekt/backend/models"
)

const (
	// releaseListPath is every release, newest first. Thirty is GitHub's
	// default page and far more than What's New needs: anything older is one
	// click away on the releases page the pane links to.
	releaseListPath = "/repos/kollektiv-mc/Konnekt/releases?per_page=30"

	// releaseNotesFile is the last successful answer, kept so the pane still
	// has something to show offline or rate-limited.
	releaseNotesFile = "release_notes.json"

	// releaseNotesTTL is how long a cached answer is used without asking
	// GitHub again. An unauthenticated client gets 60 requests an hour, shared
	// with the update check, and the notes change once a night at most.
	releaseNotesTTL = time.Hour

	// snapshotTag is the rolling tag snapshot.yml republishes every night.
	snapshotTag = "snapshot"
)

// The markers release-notes.py writes, and website/release.js's changesOnly
// reads the same way: the section starts at its "## What's changed" heading
// and ends at the footer counting what was left out, the "Full changelog"
// link, or the next second-level heading.
var (
	changesHeading = regexp.MustCompile(`(?i)^##\s+What's changed\s*$`)
	changesEnd     = regexp.MustCompile(`(?i)^(?:_.*\bnot listed\b.*_|\*\*Full changelog\*\*|##\s)`)
)

// releaseNotesCache is release_notes.json: every release GitHub listed, not
// only those at or below the running version, so a cache written before an
// update still serves the build after it.
type releaseNotesCache struct {
	FetchedAt string               `json:"fetchedAt"`
	Releases  []models.ReleaseNote `json:"releases"`
}

// SetDataDir is where release_notes.json lives. Unset, the notes are fetched
// every time and never cached.
func (s *UpdateService) SetDataDir(dir string) { s.dataDir = dir }

// GetReleaseNotes returns the notes of every release at or below
// currentVersion, newest first.
//
// A cache younger than releaseNotesTTL that already knows currentVersion is
// answered without a request. Otherwise GitHub is asked, and when that fails
// the cache is returned whatever its age, marked Stale. An error comes back
// only when there is neither an answer nor a cache.
func (s *UpdateService) GetReleaseNotes(ctx context.Context, currentVersion string) (models.ReleaseNotes, error) {
	s.notesMu.Lock()
	defer s.notesMu.Unlock()

	cached, haveCache := s.readNotesCache()
	if haveCache && cacheIsFresh(cached, currentVersion, time.Now()) {
		return notesFor(cached, currentVersion, false), nil
	}

	releases, err := s.fetchReleaseNotes(ctx)
	if err != nil {
		if haveCache {
			slog.Warn("release notes: serving the cache", "error", err)
			return notesFor(cached, currentVersion, true), nil
		}
		return models.ReleaseNotes{}, err
	}

	fresh := releaseNotesCache{FetchedAt: time.Now().UTC().Format(time.RFC3339), Releases: releases}
	if err := s.writeNotesCache(fresh); err != nil {
		// The answer is still good; only the next offline open loses out.
		slog.Error("release notes: write cache", "error", err)
	}
	return notesFor(fresh, currentVersion, false), nil
}

// cacheIsFresh reports whether c can be served without asking GitHub: it is
// younger than the TTL, and it lists the running version. The second half is
// what makes a build that just updated itself ask straight away rather than
// show the release before its own for up to an hour. A build that is not a
// published release (a local dev build) never appears in the list, so for
// those age alone decides.
func cacheIsFresh(c releaseNotesCache, currentVersion string, now time.Time) bool {
	fetched, err := time.Parse(time.RFC3339, c.FetchedAt)
	if err != nil || now.Sub(fetched) > releaseNotesTTL || now.Before(fetched) {
		return false
	}
	if isLocalDevVersion(currentVersion) {
		return true
	}
	for _, r := range c.Releases {
		if compareVersions(r.Version, currentVersion) == 0 {
			return true
		}
	}
	return false
}

// notesFor keeps the releases at or below currentVersion. A stable build
// does not see the snapshot (which sorts above every prerelease of its core)
// or a release it has not installed yet; a snapshot build sees its own notes.
func notesFor(c releaseNotesCache, currentVersion string, stale bool) models.ReleaseNotes {
	out := models.ReleaseNotes{Releases: []models.ReleaseNote{}, FetchedAt: c.FetchedAt, Stale: stale}
	for _, r := range c.Releases {
		if compareVersions(r.Version, currentVersion) <= 0 {
			out.Releases = append(out.Releases, r)
		}
	}
	return out
}

// fetchReleaseNotes lists the releases and parses each body. Drafts are
// skipped (an unauthenticated client never sees one, but the field is
// there), as is a snapshot whose title is not a version (releaseVersion).
func (s *UpdateService) fetchReleaseNotes(ctx context.Context) ([]models.ReleaseNote, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.baseURL+releaseListPath, nil)
	if err != nil {
		return nil, fmt.Errorf("release notes: build request: %w", err)
	}
	req.Header.Set("User-Agent", updateUserAgent)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := s.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("release notes: %w", err)
	}
	defer resp.Body.Close()

	body, err := readCapped(resp.Body, maxReleaseJSONBytes)
	if err != nil {
		return nil, fmt.Errorf("release notes: read response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("release notes: HTTP %d: %s", resp.StatusCode, truncate(string(body), 200))
	}

	var raw []ghRelease
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("release notes: decode response: %w", err)
	}

	notes := make([]models.ReleaseNote, 0, len(raw))
	for _, r := range raw {
		if r.Draft {
			continue
		}
		snapshot := r.TagName == snapshotTag
		channel := UpdateChannelStable
		if snapshot {
			channel = UpdateChannelSnapshot
		}
		version := releaseVersion(r, channel)
		if version == "" {
			continue
		}
		notes = append(notes, models.ReleaseNote{
			Version:     version,
			Snapshot:    snapshot,
			URL:         r.HTMLURL,
			PublishedAt: r.PublishedAt,
			Sections:    parseReleaseChanges(r.Body),
		})
	}
	return notes, nil
}

// parseReleaseChanges splits a release body's "## What's changed" section
// into its "### " headings and their bullets. A bullet before any heading
// lands in an untitled section. A body without the heading is hand-written,
// with install steps and the like beside the changes, and yields no sections
// rather than a guess at which of its lists are changes.
func parseReleaseChanges(body string) []models.ReleaseNoteSection {
	lines := strings.Split(strings.ReplaceAll(body, "\r\n", "\n"), "\n")

	start := -1
	for i, line := range lines {
		if changesHeading.MatchString(strings.TrimSpace(line)) {
			start = i + 1
			break
		}
	}
	if start < 0 {
		return []models.ReleaseNoteSection{}
	}

	sections := []models.ReleaseNoteSection{}
	for _, line := range lines[start:] {
		line = strings.TrimSpace(line)
		if changesEnd.MatchString(line) {
			break
		}
		switch {
		case strings.HasPrefix(line, "### "):
			sections = append(sections, models.ReleaseNoteSection{
				Title: strings.TrimSpace(strings.TrimPrefix(line, "### ")),
				Items: []string{},
			})
		case strings.HasPrefix(line, "* "), strings.HasPrefix(line, "- "):
			item := strings.TrimSpace(line[2:])
			if item == "" {
				continue
			}
			if len(sections) == 0 {
				sections = append(sections, models.ReleaseNoteSection{Items: []string{}})
			}
			last := &sections[len(sections)-1]
			last.Items = append(last.Items, item)
		}
	}

	kept := sections[:0]
	for _, sec := range sections {
		if len(sec.Items) > 0 {
			kept = append(kept, sec)
		}
	}
	return kept
}

// readNotesCache reads release_notes.json. A missing file is the normal first
// run; an unreadable or corrupt one is logged and treated the same, since the
// next successful fetch overwrites it.
func (s *UpdateService) readNotesCache() (releaseNotesCache, bool) {
	if s.dataDir == "" {
		return releaseNotesCache{}, false
	}
	data, err := os.ReadFile(filepath.Join(s.dataDir, releaseNotesFile))
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			slog.Warn("release notes: read cache", "error", err)
		}
		return releaseNotesCache{}, false
	}
	var c releaseNotesCache
	if err := json.Unmarshal(data, &c); err != nil {
		slog.Warn("release notes: decode cache", "error", err)
		return releaseNotesCache{}, false
	}
	return c, true
}

func (s *UpdateService) writeNotesCache(c releaseNotesCache) error {
	if s.dataDir == "" {
		return nil
	}
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return WriteDataFile(s.dataDir, releaseNotesFile, data)
}
