package services

import (
	"bytes"
	"html"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// --- the download page (#562) ---

const dhPageGolden = "testdata/dhsnapshot_page.golden.html"

// dhPageIndex is the fixture: two levels, both with the "@@" a client's folder
// names carry, the first a little over 20 GiB and the second a few MiB.
func dhPageIndex() DHIndex {
	return DHIndex{
		Format: 1, CreatedAt: "2026-10-11T04:00:00Z", PartsBase: "../../parts/",
		DHVersion: "3.3.3-b", ServerFolder: "42_frang",
		Levels: []DHIndexLevel{
			{Folder: "17625k4jm41ka@minecraft@@overworld", Size: 21_800_000_000, Parts: []DHPart{}},
			{Folder: "17625k4jm41ka@minecraft@@the_nether", Size: 5*1024*1024 + 600*1024, Parts: []DHPart{}},
		},
	}
}

func TestDHPageMatchesTheGoldenFile(t *testing.T) {
	got, err := renderDHPage(dhPageIndex())
	if err != nil {
		t.Fatal(err)
	}
	if os.Getenv("UPDATE_GOLDEN") != "" {
		if err := os.WriteFile(dhPageGolden, got, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	want, err := os.ReadFile(filepath.FromSlash(dhPageGolden))
	if err != nil {
		t.Fatalf("%v (UPDATE_GOLDEN=1 writes it)", err)
	}
	if !bytes.Equal(got, want) {
		t.Errorf("the page differs from %s (UPDATE_GOLDEN=1 rewrites it after a deliberate change):\n%s", dhPageGolden, got)
	}
}

func TestDHPageIsDeterministic(t *testing.T) {
	a, err := renderDHPage(dhPageIndex())
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 5; i++ {
		b, err := renderDHPage(dhPageIndex())
		if err != nil || !bytes.Equal(a, b) {
			t.Fatalf("render %d differs (%v)", i, err)
		}
	}
}

var (
	reDHPageHref = regexp.MustCompile(`href="([^"]*)"`)
	reDHPageCode = regexp.MustCompile(`<code>([^<]*)</code>`)
)

func TestDHPageLinksAndClientPathsAreRight(t *testing.T) {
	ix := dhPageIndex()
	page, err := renderDHPage(ix)
	if err != nil {
		t.Fatal(err)
	}
	text := string(page)

	listed := map[string]bool{}
	var wantPaths []string
	for _, l := range ix.Levels {
		listed[l.Folder+"/DistantHorizons.sqlite"] = true
		wantPaths = append(wantPaths, "Distant_Horizons_server_data/"+ix.ServerFolder+"/"+l.Folder+"/")
	}

	hrefs := reDHPageHref.FindAllStringSubmatch(text, -1)
	if len(hrefs) != len(ix.Levels) {
		t.Fatalf("%d links for %d levels", len(hrefs), len(ix.Levels))
	}
	base, err := url.Parse("https://bucket.example/dh/snapshots/20261011T040000Z/index.html")
	if err != nil {
		t.Fatal(err)
	}
	for i, m := range hrefs {
		ref, err := url.Parse(html.UnescapeString(m[1]))
		if err != nil || ref.IsAbs() || strings.HasPrefix(ref.Path, "/") {
			t.Fatalf("href %q is not a relative link (%v)", m[1], err)
		}
		if got := ref.Path; got != ix.Levels[i].Folder+"/DistantHorizons.sqlite" || !listed[got] {
			t.Errorf("href %d resolves to %q, which is not a listed level file", i, got)
		}
		// Resolved against the page, it lands in the snapshot's own folder.
		want := "https://bucket.example/dh/snapshots/20261011T040000Z/" + ix.Levels[i].Folder + "/DistantHorizons.sqlite"
		if got := base.ResolveReference(ref).String(); got != want {
			t.Errorf("href %d resolves to %q, want %q", i, got, want)
		}
	}

	codes := reDHPageCode.FindAllStringSubmatch(text, -1)
	if len(codes) != len(wantPaths) {
		t.Fatalf("%d client paths for %d levels", len(codes), len(wantPaths))
	}
	for i, m := range codes {
		if got := html.UnescapeString(m[1]); got != wantPaths[i] {
			t.Errorf("client path %d = %q, want %q", i, got, wantPaths[i])
		}
	}
}

func TestDHPageContent(t *testing.T) {
	page, err := renderDHPage(dhPageIndex())
	if err != nil {
		t.Fatal(err)
	}
	text := string(page)
	for _, want := range []string{
		"17625k4jm41ka@minecraft@@overworld", "17625k4jm41ka@minecraft@@the_nether",
		"20.3 GiB", "5.6 MiB",
		"snapshot of 2026-10-11 UTC", "made with Distant Horizons 3.3.3-b",
		"Close the game before copying the file in.",
		"<!doctype html>", `lang="en"`, "prefers-color-scheme: dark",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("page lacks %q", want)
		}
	}
	// Index order, and the closing line under the list.
	if strings.Index(text, "@@overworld") > strings.Index(text, "@@the_nether") {
		t.Error("levels are not in index order")
	}
	if strings.Index(text, "</ul>") > strings.Index(text, "Close the game") {
		t.Error("the closing line is not under the list")
	}
}

func TestDHPageIsOneSelfContainedFile(t *testing.T) {
	page, err := renderDHPage(dhPageIndex())
	if err != nil {
		t.Fatal(err)
	}
	text := strings.ToLower(string(page))
	for _, banned := range []string{
		"\xe2\x80\x94",                   // an em dash: this is published copy
		"<script", "http://", "https://", // no script, no absolute address
		"url(", "@import", "<img", "<link", "<iframe", "src=", "@font-face", // no asset of any kind
	} {
		if strings.Contains(text, banned) {
			t.Errorf("page contains %q", banned)
		}
	}
	if !strings.Contains(string(page), "<style>") {
		t.Error("the styles are not inline")
	}
}

// The template says in a comment why its colours are not the app's tokens, and
// the comment is for the maintainer: it is not published.
func TestDHPageTemplateExplainsItsHardcodedPalette(t *testing.T) {
	if !strings.Contains(dhPageSource, "design tokens") || !strings.Contains(dhPageSource, "written out on purpose") {
		t.Error("the template does not say why its colours are hardcoded")
	}
	page, err := renderDHPage(dhPageIndex())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(page), "design tokens") {
		t.Error("the maintainer's comment was published")
	}
	if strings.Contains(dhPageSource, "\xe2\x80\x94") {
		t.Error("the template contains an em dash")
	}
}

func TestDHPageRefusesAnIndexWithNoLevels(t *testing.T) {
	ix := dhPageIndex()
	ix.Levels = nil
	if page, err := renderDHPage(ix); err == nil || page != nil {
		t.Errorf("got (%q, %v), want a refusal", page, err)
	}
	ix = dhPageIndex()
	ix.CreatedAt = "yesterday"
	if _, err := renderDHPage(ix); err == nil {
		t.Error("a createdAt that is not a time was rendered")
	}
}

// The link and the text go through html/template's escaping: a folder with
// markup or a space in it cannot break out of its attribute or be read as HTML.
func TestDHPageEscapesWhatItPrints(t *testing.T) {
	ix := dhPageIndex()
	ix.Levels = ix.Levels[:1]
	ix.Levels[0].Folder = `a b"><script>x</script>`
	ix.DHVersion = "<b>3</b>"
	page, err := renderDHPage(ix)
	if err != nil {
		t.Fatal(err)
	}
	text := string(page)
	if strings.Contains(text, "<script>x") || strings.Contains(text, "<b>3") || strings.Contains(text, `a b"`) {
		t.Errorf("unescaped input in the page:\n%s", text)
	}
	if m := reDHPageHref.FindStringSubmatch(text); m == nil || strings.ContainsAny(m[1], " \"<>") {
		t.Errorf("href = %v, want a percent-encoded relative link", m)
	}
}

func TestDHPageDropsTheVersionClauseWhenThereIsNone(t *testing.T) {
	ix := dhPageIndex()
	ix.DHVersion = ""
	page, err := renderDHPage(ix)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(page), "made with") {
		t.Error("a 'made with' clause with no version")
	}
}

func TestDHPageSize(t *testing.T) {
	for n, want := range map[int64]string{
		0: "0.0 MiB", 1: "0.0 MiB", 1 << 20: "1.0 MiB", 5*1024*1024 + 600*1024: "5.6 MiB",
		1<<30 - 1: "1.0 GiB", 1<<30 - 1<<20: "1023.0 MiB", 1 << 30: "1.0 GiB", 21_800_000_000: "20.3 GiB",
	} {
		if got := dhPageSize(n); got != want {
			t.Errorf("dhPageSize(%d) = %q, want %q", n, got, want)
		}
	}
}
