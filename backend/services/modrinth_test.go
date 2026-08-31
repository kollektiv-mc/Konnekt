package services

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"konnekt/backend/models"
)

// newTestClient points a ModrinthClient at an httptest.Server. Everything past
// the facet helpers needs this: doJSON's rate-limit retry and Search's dedup are
// only reachable through a real HTTP round-trip, which is why baseURL is a field
// rather than the modrinthBase const.
func newTestClient(ts *httptest.Server) *ModrinthClient {
	return &ModrinthClient{http: ts.Client(), baseURL: ts.URL}
}

// --- Facet helpers ---

func TestBuildFacetsEmpty(t *testing.T) {
	if got := buildFacets("", "", nil); got != "" {
		t.Errorf("buildFacets(empty) = %q, want empty string", got)
	}
}

func TestBuildFacetsVersionOnly(t *testing.T) {
	got := buildFacets("1.20.1", "", nil)
	want := `[["versions:1.20.1"]]`
	if got != want {
		t.Errorf("buildFacets(version only) = %q, want %q", got, want)
	}
}

func TestBuildFacetsLoaderWithModrinthMapping(t *testing.T) {
	got := buildFacets("", "fabric", nil)
	want := `[["project_type:mod"],["categories:fabric"]]`
	if got != want {
		t.Errorf("buildFacets(fabric) = %q, want %q", got, want)
	}
}

func TestBuildFacetsLoaderWithoutModrinthMapping(t *testing.T) {
	// vanilla maps to project_type "mod" but has no modrinthLoader category.
	got := buildFacets("", "vanilla", nil)
	want := `[["project_type:mod"]]`
	if got != want {
		t.Errorf("buildFacets(vanilla) = %q, want %q", got, want)
	}
}

func TestBuildFacetsUnknownLoaderIgnored(t *testing.T) {
	got := buildFacets("1.20.1", "not-a-real-loader", nil)
	want := `[["versions:1.20.1"]]`
	if got != want {
		t.Errorf("buildFacets(unknown loader) = %q, want %q", got, want)
	}
}

func TestBuildFacetsCategoriesSkipEmpty(t *testing.T) {
	got := buildFacets("", "", []string{"adventure", "", "economy"})
	want := `[["categories:adventure"],["categories:economy"]]`
	if got != want {
		t.Errorf("buildFacets(categories) = %q, want %q", got, want)
	}
}

func TestBuildFacetsCombinesAllGroups(t *testing.T) {
	got := buildFacets("1.20.1", "paper", []string{"economy"})
	want := `[["project_type:plugin"],["categories:paper"],["versions:1.20.1"],["categories:economy"]]`
	if got != want {
		t.Errorf("buildFacets(combined) = %q, want %q", got, want)
	}
}

// --- HTTP transport: doJSON ---

func TestModrinthDoJSONSetsUserAgentAndDecodes(t *testing.T) {
	var gotURI, gotUA string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotURI = r.URL.RequestURI()
		gotUA = r.Header.Get("User-Agent")
		writeString(t, w, `{"name":"decoded"}`)
	}))
	defer ts.Close()

	var out struct {
		Name string `json:"name"`
	}
	if err := newTestClient(ts).doJSON(context.Background(), "/tag/category?x=1", &out); err != nil {
		t.Fatalf("doJSON error: %v", err)
	}
	if out.Name != "decoded" {
		t.Errorf("decoded name = %q, want %q", out.Name, "decoded")
	}
	if gotURI != "/tag/category?x=1" {
		t.Errorf("request URI = %q, want %q", gotURI, "/tag/category?x=1")
	}
	if gotUA != modrinthUserAgent {
		t.Errorf("User-Agent = %q, want %q", gotUA, modrinthUserAgent)
	}
}

func TestModrinthDoJSONRetriesAfter429(t *testing.T) {
	var attempts atomic.Int32
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Retry-After: 0 keeps the backoff instant so the test stays fast.
		if attempts.Add(1) < 3 {
			w.Header().Set("Retry-After", "0")
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		writeString(t, w, `{"name":"eventually"}`)
	}))
	defer ts.Close()

	var out struct {
		Name string `json:"name"`
	}
	if err := newTestClient(ts).doJSON(context.Background(), "/search", &out); err != nil {
		t.Fatalf("doJSON error after retries: %v", err)
	}
	if out.Name != "eventually" {
		t.Errorf("decoded name = %q, want %q", out.Name, "eventually")
	}
	if got := attempts.Load(); got != 3 {
		t.Errorf("attempts = %d, want 3", got)
	}
}

func TestModrinthDoJSONGivesUpAfterThreeAttempts(t *testing.T) {
	var attempts atomic.Int32
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts.Add(1)
		w.Header().Set("Retry-After", "0")
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer ts.Close()

	var out map[string]any
	err := newTestClient(ts).doJSON(context.Background(), "/search", &out)
	if err == nil {
		t.Fatal("doJSON = nil error, want a retry-limit error")
	}
	if !strings.Contains(err.Error(), "exceeded retry limit") {
		t.Errorf("error = %v, want it to mention the retry limit", err)
	}
	// maxRetries is a total attempt count, not retries-after-the-first.
	if got := attempts.Load(); got != 3 {
		t.Errorf("attempts = %d, want 3", got)
	}
}

func TestModrinthDoJSONAbortsBackoffOnContextCancel(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// No Retry-After, so doJSON falls back to its 2s default backoff. The
		// point here is that a cancelled context cuts that wait short — which is
		// also why the 2s default itself is never timed in these tests.
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer ts.Close()

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()

	start := time.Now()
	var out map[string]any
	err := newTestClient(ts).doJSON(ctx, "/search", &out)
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("doJSON = nil error, want the context error")
	}
	if !strings.Contains(err.Error(), context.Canceled.Error()) {
		t.Errorf("error = %v, want a context-cancelled error", err)
	}
	if elapsed >= 2*time.Second {
		t.Errorf("doJSON waited %v — the cancel did not interrupt the backoff", elapsed)
	}
}

func TestModrinthDoJSONSurfacesHTTPErrorWithBody(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		writeString(t, w, "upstream exploded")
	}))
	defer ts.Close()

	var out map[string]any
	err := newTestClient(ts).doJSON(context.Background(), "/search", &out)
	if err == nil {
		t.Fatal("doJSON = nil error, want an HTTP error")
	}
	if !strings.Contains(err.Error(), "HTTP 500") || !strings.Contains(err.Error(), "upstream exploded") {
		t.Errorf("error = %v, want it to carry both the status and the body", err)
	}
}

func TestModrinthDoJSONRejectsMalformedJSON(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeString(t, w, "<html>not json</html>")
	}))
	defer ts.Close()

	var out map[string]any
	err := newTestClient(ts).doJSON(context.Background(), "/search", &out)
	if err == nil {
		t.Fatal("doJSON = nil error, want a decode error")
	}
	if !strings.Contains(err.Error(), "decode response") {
		t.Errorf("error = %v, want a decode-response error", err)
	}
}

// --- Search ---

func TestModrinthSearchDeduplicatesHitsByProjectID(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeString(t, w, `{
			"hits":[
				{"project_id":"AABB","title":"Sodium","downloads":10},
				{"project_id":"AABB","title":"Sodium (dupe)","downloads":10},
				{"project_id":"CCDD","title":"Lithium","downloads":5}
			],
			"total_hits":2,
			"offset":40
		}`)
	}))
	defer ts.Close()

	got, err := newTestClient(ts).Search(context.Background(), models.ModSearchQuery{}, "", "")
	if err != nil {
		t.Fatalf("Search error: %v", err)
	}
	if len(got.Hits) != 2 {
		t.Fatalf("hits = %d, want 2 (the repeated project_id collapses)", len(got.Hits))
	}
	// The first occurrence wins, not the last.
	if got.Hits[0].ID != "AABB" || got.Hits[0].Title != "Sodium" {
		t.Errorf("first hit = %+v, want the first AABB occurrence", got.Hits[0])
	}
	if got.Hits[1].ID != "CCDD" {
		t.Errorf("second hit id = %q, want CCDD", got.Hits[1].ID)
	}
	if got.Total != 2 || got.Offset != 40 {
		t.Errorf("total/offset = %d/%d, want 2/40 passed through", got.Total, got.Offset)
	}
}

func TestModrinthSearchSendsQueryFacetsAndPaging(t *testing.T) {
	var gotQuery url.Values
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.Query()
		writeString(t, w, `{"hits":[],"total_hits":0,"offset":0}`)
	}))
	defer ts.Close()

	q := models.ModSearchQuery{Query: "sodium", Offset: 20, Sort: "downloads"}
	if _, err := newTestClient(ts).Search(context.Background(), q, "1.20.1", "fabric"); err != nil {
		t.Fatalf("Search error: %v", err)
	}

	want := map[string]string{
		"query":  "sodium",
		"offset": "20",
		"index":  "downloads",
		"limit":  "20",
		"facets": `[["project_type:mod"],["categories:fabric"],["versions:1.20.1"]]`,
	}
	for k, v := range want {
		if got := gotQuery.Get(k); got != v {
			t.Errorf("query param %s = %q, want %q", k, got, v)
		}
	}
}

func TestModrinthSearchOmitsFacetsWhenUnfiltered(t *testing.T) {
	var hadFacets bool
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, hadFacets = r.URL.Query()["facets"]
		writeString(t, w, `{"hits":[],"total_hits":0,"offset":0}`)
	}))
	defer ts.Close()

	if _, err := newTestClient(ts).Search(context.Background(), models.ModSearchQuery{}, "", ""); err != nil {
		t.Fatalf("Search error: %v", err)
	}
	if hadFacets {
		t.Error("facets param was sent for an unfiltered search, want it omitted")
	}
}

// --- GetProject: author resolution via /members ---

func TestModrinthGetProjectResolvesOwnerFromMembers(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/project/AABB":
			writeString(t, w, `{"id":"AABB","title":"Sodium"}`)
		case "/project/AABB/members":
			writeString(t, w, `[
				{"role":"Contributor","user":{"username":"helper"}},
				{"role":"Owner","user":{"username":"jellysquid"}}
			]`)
		default:
			t.Errorf("unexpected request path %q", r.URL.Path)
		}
	}))
	defer ts.Close()

	got, err := newTestClient(ts).GetProject(context.Background(), "AABB")
	if err != nil {
		t.Fatalf("GetProject error: %v", err)
	}
	if got.Author != "jellysquid" {
		t.Errorf("author = %q, want the Owner-role member", got.Author)
	}
}

func TestModrinthGetProjectFallsBackToFirstMember(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/members") {
			writeString(t, w, `[{"role":"Contributor","user":{"username":"helper"}}]`)
			return
		}
		writeString(t, w, `{"id":"AABB","title":"Sodium"}`)
	}))
	defer ts.Close()

	got, err := newTestClient(ts).GetProject(context.Background(), "AABB")
	if err != nil {
		t.Fatalf("GetProject error: %v", err)
	}
	if got.Author != "helper" {
		t.Errorf("author = %q, want the first member when no Owner role exists", got.Author)
	}
}

func TestModrinthGetProjectSurvivesMembersFailure(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/members") {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		writeString(t, w, `{"id":"AABB","title":"Sodium"}`)
	}))
	defer ts.Close()

	got, err := newTestClient(ts).GetProject(context.Background(), "AABB")
	if err != nil {
		t.Fatalf("GetProject error: %v — a failed members lookup must not fail the project", err)
	}
	if got.Title != "Sodium" {
		t.Errorf("title = %q, want Sodium", got.Title)
	}
	if got.Author != "" {
		t.Errorf("author = %q, want empty when members could not be resolved", got.Author)
	}
}

// --- GetVersions: filter construction ---

func TestModrinthGetVersionsSendsGameVersionAndLoader(t *testing.T) {
	var gotQuery url.Values
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.Query()
		writeString(t, w, `[]`)
	}))
	defer ts.Close()

	if _, err := newTestClient(ts).GetVersions(context.Background(), "AABB", "1.20.1", "fabric"); err != nil {
		t.Fatalf("GetVersions error: %v", err)
	}
	if got := gotQuery.Get("game_versions"); got != `["1.20.1"]` {
		t.Errorf("game_versions = %q, want %q", got, `["1.20.1"]`)
	}
	if got := gotQuery.Get("loaders"); got != `["fabric"]` {
		t.Errorf("loaders = %q, want %q", got, `["fabric"]`)
	}
}

func TestModrinthGetVersionsOmitsLoaderWithoutModrinthMapping(t *testing.T) {
	var gotQuery url.Values
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.Query()
		writeString(t, w, `[]`)
	}))
	defer ts.Close()

	// vanilla is a known loader with no Modrinth loader string; not-a-loader is
	// unknown entirely. Neither may produce a loaders filter.
	for _, loader := range []string{"vanilla", "not-a-loader"} {
		if _, err := newTestClient(ts).GetVersions(context.Background(), "AABB", "", loader); err != nil {
			t.Fatalf("GetVersions(%s) error: %v", loader, err)
		}
		if _, ok := gotQuery["loaders"]; ok {
			t.Errorf("loaders param was sent for loader %q, want it omitted", loader)
		}
	}
}

// --- Remaining endpoints ---

func TestModrinthGetCategoriesMapsTags(t *testing.T) {
	ts := mrAPI(t, map[string]string{
		"/tag/category": `[
			{"name":"adventure","project_type":"mod","header":"categories"},
			{"name":"economy","project_type":"plugin","header":"categories"}
		]`,
	})
	defer ts.Close()

	got, err := newTestClient(ts).GetCategories(context.Background())
	if err != nil {
		t.Fatalf("GetCategories error: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("categories = %d, want 2", len(got))
	}
	if got[0].Name != "adventure" || got[0].ProjectType != "mod" || got[0].Header != "categories" {
		t.Errorf("first category = %+v, want adventure/mod/categories", got[0])
	}
}

func TestModrinthGetProjectsByAuthorStampsTheAuthor(t *testing.T) {
	// The endpoint is per-user, so the username is known without a /members
	// round-trip per project — every result gets it stamped on.
	ts := mrAPI(t, map[string]string{
		"/user/jellysquid/projects": `[{"id":"AABB","title":"Sodium"},{"id":"CCDD","title":"Lithium"}]`,
	})
	defer ts.Close()

	got, err := newTestClient(ts).GetProjectsByAuthor(context.Background(), "jellysquid")
	if err != nil {
		t.Fatalf("GetProjectsByAuthor error: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("projects = %d, want 2", len(got))
	}
	for _, p := range got {
		if p.Author != "jellysquid" {
			t.Errorf("project %s author = %q, want jellysquid", p.ID, p.Author)
		}
	}
}

func TestModrinthVersionPicksPrimaryFileThenFallsBack(t *testing.T) {
	// Which file a version resolves to decides what actually gets downloaded and
	// hash-checked, so both branches matter.
	ts := mrAPI(t, map[string]string{
		"/version/primary": `{"id":"primary","files":[
			{"url":"https://cdn/sources.jar","filename":"sources.jar","primary":false,"size":1,"hashes":{"sha512":"aaa"}},
			{"url":"https://cdn/mod.jar","filename":"mod.jar","primary":true,"size":22,"hashes":{"sha512":"bbb"}}
		]}`,
		"/version/none": `{"id":"none","files":[
			{"url":"https://cdn/only.jar","filename":"only.jar","primary":false,"size":33,"hashes":{"sha512":"ccc"}}
		]}`,
	})
	defer ts.Close()

	c := newTestClient(ts)

	withPrimary, err := c.GetVersion(context.Background(), "primary")
	if err != nil {
		t.Fatalf("GetVersion(primary) error: %v", err)
	}
	if withPrimary.FileName != "mod.jar" || withPrimary.FileURL != "https://cdn/mod.jar" {
		t.Errorf("primary file = %q/%q, want mod.jar — the primary flag wins over file order",
			withPrimary.FileName, withPrimary.FileURL)
	}
	if withPrimary.FileSize != 22 || withPrimary.SHA512 != "bbb" {
		t.Errorf("primary size/sha = %d/%q, want 22/bbb", withPrimary.FileSize, withPrimary.SHA512)
	}

	noPrimary, err := c.GetVersion(context.Background(), "none")
	if err != nil {
		t.Fatalf("GetVersion(none) error: %v", err)
	}
	if noPrimary.FileName != "only.jar" || noPrimary.SHA512 != "ccc" {
		t.Errorf("fallback file = %q/%q, want only.jar/ccc when nothing is marked primary",
			noPrimary.FileName, noPrimary.SHA512)
	}
}

// --- ResolveDependencies: the BFS over a version's dependency graph ---

// mrAPI is a tiny fake Modrinth: a path→JSON-body map, so a dependency-graph
// test reads as the graph it describes rather than as a switch statement.
func mrAPI(t *testing.T, routes map[string]string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, ok := routes[r.URL.Path]
		if !ok {
			t.Errorf("unexpected request path %q", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		writeString(t, w, body)
	}))
}

func TestModrinthResolveDependenciesSkipsIncompatibleAndEmbedded(t *testing.T) {
	ts := mrAPI(t, map[string]string{
		"/version/root": `{"id":"root","dependencies":[
			{"project_id":"REQ","version_id":"reqv","dependency_type":"required"},
			{"project_id":"OPT","version_id":"optv","dependency_type":"optional"},
			{"project_id":"BAD","version_id":"badv","dependency_type":"incompatible"},
			{"project_id":"EMB","version_id":"embv","dependency_type":"embedded"}
		]}`,
		"/version/reqv":        `{"id":"reqv","project_id":"REQ"}`,
		"/version/optv":        `{"id":"optv","project_id":"OPT"}`,
		"/project/REQ":         `{"id":"REQ","title":"Required Lib"}`,
		"/project/OPT":         `{"id":"OPT","title":"Optional Lib"}`,
		"/project/REQ/members": `[]`,
		"/project/OPT/members": `[]`,
	})
	defer ts.Close()

	got, err := newTestClient(ts).ResolveDependencies(
		context.Background(), "root", "1.20.1", "fabric", map[string]bool{"OPT": true},
	)
	if err != nil {
		t.Fatalf("ResolveDependencies error: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("resolved %d deps, want 2 (incompatible and embedded are skipped)", len(got))
	}

	byID := map[string]models.ResolvedDependency{}
	for _, d := range got {
		byID[d.ProjectID] = d
	}
	req, ok := byID["REQ"]
	if !ok {
		t.Fatal("required dependency REQ missing from the result")
	}
	if !req.Required || req.AlreadyInstalled {
		t.Errorf("REQ = required:%v installed:%v, want required:true installed:false", req.Required, req.AlreadyInstalled)
	}
	if req.ProjectTitle != "Required Lib" || req.Version.ID != "reqv" {
		t.Errorf("REQ = title:%q version:%q, want %q / %q", req.ProjectTitle, req.Version.ID, "Required Lib", "reqv")
	}
	opt, ok := byID["OPT"]
	if !ok {
		t.Fatal("optional dependency OPT missing from the result")
	}
	if opt.Required || !opt.AlreadyInstalled {
		t.Errorf("OPT = required:%v installed:%v, want required:false installed:true", opt.Required, opt.AlreadyInstalled)
	}
}

func TestModrinthResolveDependenciesFollowsTransitiveRequiredDeps(t *testing.T) {
	// root → A (required) → B (required). B's own dep points back at A, which
	// must not be resolved twice.
	ts := mrAPI(t, map[string]string{
		"/version/root": `{"id":"root","dependencies":[
			{"project_id":"A","version_id":"av","dependency_type":"required"}
		]}`,
		"/version/av": `{"id":"av","project_id":"A","dependencies":[
			{"project_id":"B","version_id":"bv","dependency_type":"required"}
		]}`,
		"/version/bv": `{"id":"bv","project_id":"B","dependencies":[
			{"project_id":"A","version_id":"av","dependency_type":"required"}
		]}`,
		"/project/A":         `{"id":"A","title":"Alpha"}`,
		"/project/B":         `{"id":"B","title":"Beta"}`,
		"/project/A/members": `[]`,
		"/project/B/members": `[]`,
	})
	defer ts.Close()

	got, err := newTestClient(ts).ResolveDependencies(
		context.Background(), "root", "1.20.1", "fabric", nil,
	)
	if err != nil {
		t.Fatalf("ResolveDependencies error: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("resolved %d deps, want 2 (A and B, each once)", len(got))
	}
	if got[0].ProjectID != "A" || got[1].ProjectID != "B" {
		t.Errorf("order = %s,%s; want A,B (breadth-first from the root)", got[0].ProjectID, got[1].ProjectID)
	}
}

func TestModrinthResolveDependenciesFallsBackToAllVersions(t *testing.T) {
	// A dep with no pinned version_id: the loader/mc-version query comes back
	// empty, so resolution must retry unfiltered rather than give up.
	var filteredQueries, unfilteredQueries atomic.Int32
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/version/root":
			writeString(t, w, `{"id":"root","dependencies":[{"project_id":"A","dependency_type":"required"}]}`)
		case r.URL.Path == "/project/A/version" && r.URL.RawQuery != "":
			filteredQueries.Add(1)
			writeString(t, w, `[]`)
		case r.URL.Path == "/project/A/version":
			unfilteredQueries.Add(1)
			writeString(t, w, `[{"id":"fallback","project_id":"A"}]`)
		case r.URL.Path == "/project/A":
			writeString(t, w, `{"id":"A","title":"Alpha"}`)
		case r.URL.Path == "/project/A/members":
			writeString(t, w, `[]`)
		case r.URL.Path == "/version/fallback":
			writeString(t, w, `{"id":"fallback","project_id":"A"}`)
		default:
			t.Errorf("unexpected request path %q", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer ts.Close()

	got, err := newTestClient(ts).ResolveDependencies(
		context.Background(), "root", "1.20.1", "fabric", nil,
	)
	if err != nil {
		t.Fatalf("ResolveDependencies error: %v", err)
	}
	if len(got) != 1 || got[0].Version.ID != "fallback" {
		t.Fatalf("resolved = %+v, want the single unfiltered fallback version", got)
	}
	if filteredQueries.Load() == 0 || unfilteredQueries.Load() == 0 {
		t.Errorf("filtered=%d unfiltered=%d, want the filtered query tried first and the unfiltered one as fallback",
			filteredQueries.Load(), unfilteredQueries.Load())
	}
}

func TestModrinthResolveDependenciesFailsWhenNoVersionExists(t *testing.T) {
	ts := mrAPI(t, map[string]string{
		"/version/root":      `{"id":"root","dependencies":[{"project_id":"A","dependency_type":"required"}]}`,
		"/project/A/version": `[]`,
		// Looked up only because the resolution failed: the error a user reads
		// has to name the mod they need to go and fetch.
		"/project/A":         `{"id":"A","title":"Alpha"}`,
		"/project/A/members": `[]`,
	})
	defer ts.Close()

	_, err := newTestClient(ts).ResolveDependencies(
		context.Background(), "root", "1.20.1", "fabric", nil,
	)
	if err == nil {
		t.Fatal("ResolveDependencies = nil error, want a failure when a required dep has no version at all")
	}
	if !strings.Contains(err.Error(), "no version found") {
		t.Errorf("error = %v, want it to say what went wrong", err)
	}
	if !strings.Contains(err.Error(), "Alpha") {
		t.Errorf("error = %v, want it to name the mod rather than only its project id", err)
	}
}

// One entry in somebody else's dependency graph that cannot be resolved used to
// end the whole resolution, and the switch with it. It is only fatal for a
// dependency that is required and missing: an optional one that cannot be
// resolved is not something to install, and not a reason to refuse.
func TestModrinthResolveDependenciesSurvivesAnUnresolvableOptionalDep(t *testing.T) {
	ts := mrAPI(t, map[string]string{
		"/version/root": `{"id":"root","dependencies":[
			{"project_id":"REQ","version_id":"reqv","dependency_type":"required"},
			{"project_id":"OPT","dependency_type":"optional"}
		]}`,
		"/version/reqv":        `{"id":"reqv","project_id":"REQ"}`,
		"/project/REQ":         `{"id":"REQ","title":"Required Mod"}`,
		"/project/REQ/members": `[]`,
		"/project/OPT/version": `[]`,
	})
	defer ts.Close()

	got, err := newTestClient(ts).ResolveDependencies(
		context.Background(), "root", "1.20.1", "fabric", nil,
	)
	if err != nil {
		t.Fatalf("ResolveDependencies error: %v, want the unresolvable optional dep skipped", err)
	}
	if len(got) != 1 || got[0].ProjectID != "REQ" {
		t.Fatalf("resolved = %+v, want only the required dependency", got)
	}
}

// The same, for a dependency the server already has. Resolving it is how the
// dialog labels the row and how its own dependencies get walked, but the answer
// changes nothing about what has to be installed — so a project that has since
// been emptied on Modrinth must not block a mod that is already working.
func TestModrinthResolveDependenciesSurvivesAnUnresolvableInstalledDep(t *testing.T) {
	ts := mrAPI(t, map[string]string{
		"/version/root":      `{"id":"root","dependencies":[{"project_id":"A","dependency_type":"required"}]}`,
		"/project/A/version": `[]`,
	})
	defer ts.Close()

	got, err := newTestClient(ts).ResolveDependencies(
		context.Background(), "root", "1.20.1", "fabric", map[string]bool{"A": true},
	)
	if err != nil {
		t.Fatalf("ResolveDependencies error: %v, want a dep the server already has to be skipped", err)
	}
	if len(got) != 0 {
		t.Errorf("resolved = %+v, want nothing to install", got)
	}
}

// writeString keeps the handlers above free of repeated error handling —
// CLAUDE.md's "no blank _ error-ignores" rule applies to test code too.
func writeString(t *testing.T, w http.ResponseWriter, body string) {
	t.Helper()
	if _, err := w.Write([]byte(body)); err != nil {
		t.Errorf("writing test response: %v", err)
	}
}

// --- Identification by file hash ---

func TestModrinthGetVersionsByHashesAsksBySHA512(t *testing.T) {
	var gotMethod, gotPath, gotBody string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod, gotPath = r.Method, r.URL.Path
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read body: %v", err)
		}
		gotBody = string(body)
		writeString(t, w, `{
			"aaa":{"id":"ver1","project_id":"proj1","version_number":"2.21.0",
				"files":[{"filename":"EssentialsX-2.21.0.jar","url":"https://x.test/e.jar","primary":true,"hashes":{"sha512":"aaa"}}]}
		}`)
	}))
	defer ts.Close()

	got, err := newTestClient(ts).GetVersionsByHashes(context.Background(), []string{"aaa", "bbb"})
	if err != nil {
		t.Fatalf("GetVersionsByHashes: %v", err)
	}

	if gotMethod != http.MethodPost || gotPath != "/version_files" {
		t.Errorf("request = %s %s, want POST /version_files", gotMethod, gotPath)
	}
	if !strings.Contains(gotBody, `"algorithm":"sha512"`) {
		t.Errorf("body = %s, want it to name the sha512 algorithm", gotBody)
	}
	if !strings.Contains(gotBody, `"aaa"`) || !strings.Contains(gotBody, `"bbb"`) {
		t.Errorf("body = %s, want both hashes asked about in one request", gotBody)
	}

	// A hash Modrinth does not recognise is absent, not an error: that is the
	// answer for a jar somebody built themselves.
	if len(got) != 1 {
		t.Fatalf("got %d versions, want 1", len(got))
	}
	v, ok := got["aaa"]
	if !ok {
		t.Fatal("result is not keyed by the hash that was asked about")
	}
	if v.ID != "ver1" || v.ProjectID != "proj1" || v.FileName != "EssentialsX-2.21.0.jar" {
		t.Errorf("version = %+v, want ver1/proj1/EssentialsX-2.21.0.jar", v)
	}
}

func TestModrinthGetVersionsByHashesBatches(t *testing.T) {
	var requests int32
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&requests, 1)
		writeString(t, w, `{}`)
	}))
	defer ts.Close()

	hashes := make([]string, modrinthHashBatch+1)
	for i := range hashes {
		hashes[i] = "hash" + strconv.Itoa(i)
	}
	if _, err := newTestClient(ts).GetVersionsByHashes(context.Background(), hashes); err != nil {
		t.Fatalf("GetVersionsByHashes: %v", err)
	}

	// A modpack folder is hundreds of jars, and one request carrying all of
	// them is how you earn a rate-limit.
	if got := atomic.LoadInt32(&requests); got != 2 {
		t.Errorf("requests for %d hashes = %d, want 2", len(hashes), got)
	}
}

func TestModrinthGetVersionsByHashesSurfacesHTTPErrors(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		writeString(t, w, "upstream down")
	}))
	defer ts.Close()

	// Identification must be able to tell "not recognised" from "could not
	// ask": only the first is an answer worth remembering.
	if _, err := newTestClient(ts).GetVersionsByHashes(context.Background(), []string{"aaa"}); err == nil {
		t.Fatal("GetVersionsByHashes = nil error, want the HTTP failure surfaced")
	}
}
