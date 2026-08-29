package services

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The versions endpoint's real response shape, trimmed. Ordering is ascending
// here on purpose: the API returns it that way and the client must not depend
// on it.
const neoForgeVersionsJSON = `{
  "isSnapshot": false,
  "versions": [
    "20.4.237",
    "21.0.167",
    "21.1.9",
    "21.1.72",
    "21.1.209",
    "21.2.1-beta"
  ]
}`

func neoForgeFixture(t *testing.T, handler http.HandlerFunc) *NeoForgeClient {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	c := NewNeoForgeClient()
	c.baseURL = srv.URL
	return c
}

func versionsHandler(body string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/api/maven/versions/releases/net/neoforged/neoforge") {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body)) //nolint:errcheck // test server write
	}
}

func TestNeoForgeVersions(t *testing.T) {
	c := neoForgeFixture(t, versionsHandler(neoForgeVersionsJSON))

	got, err := c.Versions(context.Background(), "")
	if err != nil {
		t.Fatalf("Versions: %v", err)
	}
	if len(got) != 6 {
		t.Fatalf("Versions returned %d entries, want 6", len(got))
	}

	// Newest first, and numerically: 21.1.209 > 21.1.72 > 21.1.9 is exactly the
	// ordering a string sort gets wrong.
	want := []string{"21.2.1-beta", "21.1.209", "21.1.72", "21.1.9", "21.0.167", "20.4.237"}
	for i, w := range want {
		if got[i].Version != w {
			t.Errorf("Versions[%d] = %q, want %q", i, got[i].Version, w)
		}
	}
}

func TestNeoForgeVersionsFiltersByMCVersion(t *testing.T) {
	c := neoForgeFixture(t, versionsHandler(neoForgeVersionsJSON))

	got, err := c.Versions(context.Background(), "1.21.1")
	if err != nil {
		t.Fatalf("Versions: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("Versions(1.21.1) returned %d entries, want 3", len(got))
	}
	for _, v := range got {
		if v.MCVersion != "1.21.1" {
			t.Errorf("Versions(1.21.1) returned %q targeting %q", v.Version, v.MCVersion)
		}
	}
}

func TestNeoForgeVersionsClassification(t *testing.T) {
	c := neoForgeFixture(t, versionsHandler(neoForgeVersionsJSON))

	got, err := c.Versions(context.Background(), "")
	if err != nil {
		t.Fatalf("Versions: %v", err)
	}

	byVersion := make(map[string]int, len(got))
	for i, v := range got {
		byVersion[v.Version] = i
	}

	if got[byVersion["21.2.1-beta"]].Stable {
		t.Error("21.2.1-beta reported as stable")
	}
	if !got[byVersion["21.1.209"]].Stable {
		t.Error("21.1.209 reported as unstable")
	}

	// Latest is per Minecraft version, and is the newest *stable* build.
	if !got[byVersion["21.1.209"]].Latest {
		t.Error("21.1.209 is the newest stable build for 1.21.1 and should be Latest")
	}
	if got[byVersion["21.1.72"]].Latest {
		t.Error("21.1.72 is not the newest build for 1.21.1")
	}
	// 1.21.2 has only a beta, so that beta is the recommendation.
	if !got[byVersion["21.2.1-beta"]].Latest {
		t.Error("21.2.1-beta is the only build for 1.21.2 and should be Latest")
	}
}

func TestMCVersionForNeoForge(t *testing.T) {
	for _, tc := range []struct{ version, want string }{
		{"21.1.72", "1.21.1"},
		{"21.1.209", "1.21.1"},
		// A zero patch is the .0 release, which Minecraft writes without it.
		{"21.0.167", "1.21"},
		{"20.4.237", "1.20.4"},
		{"20.2.5-beta", "1.20.2"},
		{"21.2.1-beta", "1.21.2"},
		// Anything that does not parse yields nothing rather than a guess.
		{"21.1", ""},
		{"", ""},
		{"garbage", ""},
		{"a.b.c", ""},
	} {
		t.Run(tc.version, func(t *testing.T) {
			if got := mcVersionForNeoForge(tc.version); got != tc.want {
				t.Errorf("mcVersionForNeoForge(%q) = %q, want %q", tc.version, got, tc.want)
			}
		})
	}
}

func TestCompareNeoForgeVersions(t *testing.T) {
	for _, tc := range []struct {
		a, b string
		want string // "newer", "older" or "same"
	}{
		{"21.1.72", "21.1.9", "newer"}, // the string-sort trap
		{"21.1.9", "21.1.72", "older"},
		{"21.1.209", "21.1.72", "newer"},
		{"21.2.0", "21.1.209", "newer"},
		{"22.0.1", "21.9.999", "newer"},
		{"21.1.72", "21.1.72", "same"},
		// A release outranks a prerelease carrying the same numbers.
		{"21.2.1", "21.2.1-beta", "newer"},
		{"21.2.1-beta", "21.2.1", "older"},
	} {
		t.Run(tc.a+" vs "+tc.b, func(t *testing.T) {
			got := compareNeoForgeVersions(tc.a, tc.b)
			switch tc.want {
			case "newer":
				if got <= 0 {
					t.Errorf("compare(%q, %q) = %d, want > 0", tc.a, tc.b, got)
				}
			case "older":
				if got >= 0 {
					t.Errorf("compare(%q, %q) = %d, want < 0", tc.a, tc.b, got)
				}
			default:
				if got != 0 {
					t.Errorf("compare(%q, %q) = %d, want 0", tc.a, tc.b, got)
				}
			}
		})
	}
}

func TestNeoForgeInstallerURL(t *testing.T) {
	c := NewNeoForgeClient()
	want := "https://maven.neoforged.net/releases/net/neoforged/neoforge/21.1.72/neoforge-21.1.72-installer.jar"
	if got := c.InstallerURL("21.1.72"); got != want {
		t.Errorf("InstallerURL = %q, want %q", got, want)
	}
}

// Every way the endpoint can let us down has to reach the caller as an error
// rather than an empty list, which the UI would render as "no versions".
func TestNeoForgeVersionsErrors(t *testing.T) {
	for _, tc := range []struct {
		name    string
		handler http.HandlerFunc
	}{
		{"not found", func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusNotFound)
		}},
		{"server error", func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
		}},
		{"malformed json", versionsHandler(`{"versions": [`)},
		{"not json at all", versionsHandler(`<html>captive portal</html>`)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := neoForgeFixture(t, tc.handler)
			if _, err := c.Versions(context.Background(), ""); err == nil {
				t.Error("Versions = nil error, want a failure")
			}
		})
	}
}

func TestNeoForgeVersionsEmptyList(t *testing.T) {
	c := neoForgeFixture(t, versionsHandler(`{"isSnapshot":false,"versions":[]}`))

	got, err := c.Versions(context.Background(), "")
	if err != nil {
		t.Fatalf("Versions: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("Versions = %v, want empty", got)
	}
}

// A build the version scheme does not cover must not be dropped from the
// unfiltered list, nor reorder the entries around it.
func TestNeoForgeVersionsKeepsUnparseableEntries(t *testing.T) {
	c := neoForgeFixture(t, versionsHandler(`{"versions":["21.1.72","weird","21.1.209",""]}`))

	got, err := c.Versions(context.Background(), "")
	if err != nil {
		t.Fatalf("Versions: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("Versions returned %d entries, want 3 (the empty string dropped)", len(got))
	}
	if got[0].Version != "21.1.209" || got[1].Version != "21.1.72" {
		t.Errorf("Versions = %v, want the parseable builds ordered first", got)
	}
	if got[2].Version != "weird" || got[2].MCVersion != "" {
		t.Errorf("Versions[2] = %+v, want the unparseable entry last with no MC version", got[2])
	}
}
