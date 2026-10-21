package services

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"sync/atomic"
	"testing"
	"time"

	"konnekt/backend/models"
)

// generatedBody is a release body in the shape release.yml writes: preamble,
// the changes, the footer and the compare link.
const generatedBody = "Pre-release. Expect rough edges.\r\n\r\n" +
	"## What's changed\r\n\r\n" +
	"### Features\r\n* Rework the Commands tile\r\n* Bind Backspace in the graph editor\r\n\r\n" +
	"### Fixes\r\n* Refuse a server id that is not a single path segment\r\n\r\n" +
	"_52 pull requests are not listed: 18 changed nothing that ships in this build._\r\n\r\n" +
	"**Full changelog**: https://github.com/kollektiv-mc/Konnekt/compare/a...b\r\n"

func TestParseReleaseChangesSplitsSections(t *testing.T) {
	got := parseReleaseChanges(generatedBody)
	want := []models.ReleaseNoteSection{
		{Title: "Features", Items: []string{"Rework the Commands tile", "Bind Backspace in the graph editor"}},
		{Title: "Fixes", Items: []string{"Refuse a server id that is not a single path segment"}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("parseReleaseChanges() = %#v, want %#v", got, want)
	}
}

func TestParseReleaseChangesEdgeShapes(t *testing.T) {
	cases := []struct {
		name string
		body string
		want []models.ReleaseNoteSection
	}{
		{
			// v0.1.0-alpha.1: install steps and platform notes beside the
			// changes, so none of its lists is taken for them.
			name: "hand-written body without the heading",
			body: "## Konnekt v0.1.0-alpha.1\n\n### What's included\n\n- Live console\n",
			want: []models.ReleaseNoteSection{},
		},
		{
			name: "bullets before any heading land in an untitled section",
			body: "## What's changed\n\n* One change\n- Another\n",
			want: []models.ReleaseNoteSection{{Items: []string{"One change", "Another"}}},
		},
		{
			name: "an empty section is dropped and the next h2 ends the changes",
			body: "## What's changed\n### Features\n### Fixes\n* A fix\n## Assets\n* not a change\n",
			want: []models.ReleaseNoteSection{{Title: "Fixes", Items: []string{"A fix"}}},
		},
		{
			name: "empty body",
			body: "",
			want: []models.ReleaseNoteSection{},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := parseReleaseChanges(c.body); !reflect.DeepEqual(got, c.want) {
				t.Errorf("parseReleaseChanges() = %#v, want %#v", got, c.want)
			}
		})
	}
}

// releaseListJSON is what /releases answers: the snapshot first, then the
// tagged releases newest first, and a draft that must never be shown.
const releaseListJSON = `[
  {"tag_name":"snapshot","name":"0.2.0-snapshot.202610191616.eeb89c9","html_url":"https://example.com/snapshot","published_at":"2026-10-20T09:08:30Z","body":"## What's changed\n### Features\n* Snapshot feature\n"},
  {"tag_name":"v0.3.0","name":"v0.3.0","draft":true,"html_url":"https://example.com/draft","body":""},
  {"tag_name":"v0.2.0-alpha.2","name":"v0.2.0-alpha.2","html_url":"https://example.com/a2","published_at":"2026-10-01T08:56:39Z","body":"## What's changed\n### Fixes\n* Alpha two fix\n"},
  {"tag_name":"v0.2.0-alpha.1","name":"v0.2.0-alpha.1","html_url":"https://example.com/a1","published_at":"2026-09-08T13:37:20Z","body":"## What's changed\n### Features\n* Alpha one feature\n"},
  {"tag_name":"v0.1.0-alpha.1","name":"v0.1.0-alpha.1","html_url":"https://example.com/first","published_at":"2026-07-16T18:51:55Z","body":"## Konnekt v0.1.0-alpha.1\n- hand-written\n"}
]`

// releaseListServer answers /releases with body and status, counting hits.
func releaseListServer(t *testing.T, status int, body string) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	var hits atomic.Int32
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		if r.URL.Path != "/repos/kollektiv-mc/Konnekt/releases" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.Header.Get("User-Agent") == "" {
			t.Error("expected a User-Agent header")
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(ts.Close)
	return ts, &hits
}

func versionsOf(notes models.ReleaseNotes) []string {
	out := []string{}
	for _, r := range notes.Releases {
		out = append(out, r.Version)
	}
	return out
}

func TestReleaseNotesKeepUpToRunningVersion(t *testing.T) {
	cases := []struct {
		name    string
		current string
		want    []string
	}{
		{"stable build sees its release and older", "v0.2.0-alpha.1",
			[]string{"v0.2.0-alpha.1", "v0.1.0-alpha.1"}},
		{"snapshot build sees its own notes", "0.2.0-snapshot.202610191616.eeb89c9",
			[]string{"0.2.0-snapshot.202610191616.eeb89c9", "v0.2.0-alpha.2", "v0.2.0-alpha.1", "v0.1.0-alpha.1"}},
		{"dev build sees every tagged release of its core", "0.2.0-dev",
			[]string{"v0.2.0-alpha.2", "v0.2.0-alpha.1", "v0.1.0-alpha.1"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ts, _ := releaseListServer(t, http.StatusOK, releaseListJSON)
			svc := &UpdateService{http: ts.Client(), baseURL: ts.URL, dataDir: t.TempDir()}
			notes, err := svc.GetReleaseNotes(context.Background(), c.current)
			if err != nil {
				t.Fatalf("GetReleaseNotes: %v", err)
			}
			if got := versionsOf(notes); !reflect.DeepEqual(got, c.want) {
				t.Errorf("versions = %v, want %v", got, c.want)
			}
			if notes.Stale || notes.FetchedAt == "" {
				t.Errorf("Stale = %v, FetchedAt = %q; want a fresh answer", notes.Stale, notes.FetchedAt)
			}
		})
	}
}

func TestReleaseNotesCarrySectionsAndLinks(t *testing.T) {
	ts, _ := releaseListServer(t, http.StatusOK, releaseListJSON)
	svc := &UpdateService{http: ts.Client(), baseURL: ts.URL}
	notes, err := svc.GetReleaseNotes(context.Background(), "0.2.0-snapshot.202610191616.eeb89c9")
	if err != nil {
		t.Fatalf("GetReleaseNotes: %v", err)
	}
	snap := notes.Releases[0]
	if !snap.Snapshot || snap.URL != "https://example.com/snapshot" || snap.PublishedAt != "2026-10-20T09:08:30Z" {
		t.Errorf("snapshot entry = %#v", snap)
	}
	if want := []models.ReleaseNoteSection{{Title: "Features", Items: []string{"Snapshot feature"}}}; !reflect.DeepEqual(snap.Sections, want) {
		t.Errorf("snapshot sections = %#v", snap.Sections)
	}
	first := notes.Releases[len(notes.Releases)-1]
	if first.Snapshot || len(first.Sections) != 0 || first.URL != "https://example.com/first" {
		t.Errorf("hand-written release = %#v; want no sections and its link", first)
	}
}

func TestReleaseNotesWriteTheCache(t *testing.T) {
	ts, _ := releaseListServer(t, http.StatusOK, releaseListJSON)
	dir := t.TempDir()
	svc := &UpdateService{http: ts.Client(), baseURL: ts.URL, dataDir: dir}
	if _, err := svc.GetReleaseNotes(context.Background(), "v0.2.0-alpha.1"); err != nil {
		t.Fatalf("GetReleaseNotes: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(dir, releaseNotesFile))
	if err != nil {
		t.Fatalf("read cache: %v", err)
	}
	var c releaseNotesCache
	if err := json.Unmarshal(data, &c); err != nil {
		t.Fatalf("decode cache: %v", err)
	}
	// Every release, not only the ones this build shows, so the cache still
	// serves the build after an update.
	if len(c.Releases) != 4 {
		t.Errorf("cached %d releases, want 4", len(c.Releases))
	}
}

// writeCache puts a cache fetched at fetchedAt into a fresh data dir.
func writeCache(t *testing.T, fetchedAt time.Time, versions ...string) string {
	t.Helper()
	c := releaseNotesCache{FetchedAt: fetchedAt.UTC().Format(time.RFC3339)}
	for _, v := range versions {
		c.Releases = append(c.Releases, models.ReleaseNote{Version: v, Sections: []models.ReleaseNoteSection{}})
	}
	data, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, releaseNotesFile), data, 0644); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestReleaseNotesFreshCacheSkipsGitHub(t *testing.T) {
	ts, hits := releaseListServer(t, http.StatusOK, releaseListJSON)
	dir := writeCache(t, time.Now().Add(-10*time.Minute), "v0.2.0-alpha.1")
	svc := &UpdateService{http: ts.Client(), baseURL: ts.URL, dataDir: dir}
	notes, err := svc.GetReleaseNotes(context.Background(), "v0.2.0-alpha.1")
	if err != nil {
		t.Fatalf("GetReleaseNotes: %v", err)
	}
	if hits.Load() != 0 {
		t.Errorf("GitHub asked %d times, want 0", hits.Load())
	}
	if got := versionsOf(notes); !reflect.DeepEqual(got, []string{"v0.2.0-alpha.1"}) {
		t.Errorf("versions = %v", got)
	}
}

func TestReleaseNotesRefetchWhenCacheIsBehind(t *testing.T) {
	cases := []struct {
		name string
		dir  func(t *testing.T) string
	}{
		{"older than the TTL", func(t *testing.T) string {
			return writeCache(t, time.Now().Add(-2*releaseNotesTTL), "v0.2.0-alpha.2")
		}},
		{"fresh but without this build", func(t *testing.T) string {
			return writeCache(t, time.Now().Add(-time.Minute), "v0.2.0-alpha.1")
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ts, hits := releaseListServer(t, http.StatusOK, releaseListJSON)
			svc := &UpdateService{http: ts.Client(), baseURL: ts.URL, dataDir: c.dir(t)}
			if _, err := svc.GetReleaseNotes(context.Background(), "v0.2.0-alpha.2"); err != nil {
				t.Fatalf("GetReleaseNotes: %v", err)
			}
			if hits.Load() != 1 {
				t.Errorf("GitHub asked %d times, want 1", hits.Load())
			}
		})
	}
}

func TestReleaseNotesServeStaleCacheOnFailure(t *testing.T) {
	ts, _ := releaseListServer(t, http.StatusForbidden, `{"message":"API rate limit exceeded"}`)
	dir := writeCache(t, time.Now().Add(-48*time.Hour), "v0.2.0-alpha.2", "v0.2.0-alpha.1")
	svc := &UpdateService{http: ts.Client(), baseURL: ts.URL, dataDir: dir}
	notes, err := svc.GetReleaseNotes(context.Background(), "v0.2.0-alpha.1")
	if err != nil {
		t.Fatalf("GetReleaseNotes: %v", err)
	}
	if !notes.Stale {
		t.Error("Stale = false, want true")
	}
	if got := versionsOf(notes); !reflect.DeepEqual(got, []string{"v0.2.0-alpha.1"}) {
		t.Errorf("versions = %v", got)
	}
}

func TestReleaseNotesFailWithoutCache(t *testing.T) {
	cases := []struct {
		name   string
		status int
		body   string
	}{
		{"rate limited", http.StatusForbidden, `{"message":"API rate limit exceeded"}`},
		{"not a list", http.StatusOK, `{"tag_name":"v1"}`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ts, _ := releaseListServer(t, c.status, c.body)
			svc := &UpdateService{http: ts.Client(), baseURL: ts.URL, dataDir: t.TempDir()}
			if _, err := svc.GetReleaseNotes(context.Background(), "v0.2.0-alpha.1"); err == nil {
				t.Error("want an error with no answer and no cache")
			}
		})
	}
}

func TestReleaseNotesIgnoreCorruptCache(t *testing.T) {
	ts, hits := releaseListServer(t, http.StatusOK, releaseListJSON)
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, releaseNotesFile), []byte("{not json"), 0644); err != nil {
		t.Fatal(err)
	}
	svc := &UpdateService{http: ts.Client(), baseURL: ts.URL, dataDir: dir}
	if _, err := svc.GetReleaseNotes(context.Background(), "v0.2.0-alpha.1"); err != nil {
		t.Fatalf("GetReleaseNotes: %v", err)
	}
	if hits.Load() != 1 {
		t.Errorf("GitHub asked %d times, want 1", hits.Load())
	}
}

func TestCacheIsFreshRejectsFutureAndBadTimes(t *testing.T) {
	now := time.Now()
	future := releaseNotesCache{FetchedAt: now.Add(time.Hour).UTC().Format(time.RFC3339)}
	if cacheIsFresh(future, "0.2.0-dev", now) {
		t.Error("a cache from the future counted as fresh")
	}
	if cacheIsFresh(releaseNotesCache{FetchedAt: "yesterday"}, "0.2.0-dev", now) {
		t.Error("an unparseable time counted as fresh")
	}
}
