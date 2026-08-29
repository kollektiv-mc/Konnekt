package services

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"konnekt/backend/models"
)

const (
	neoForgeBase      = "https://maven.neoforged.net"
	neoForgeUserAgent = "Konnekt/0.1 (github.com/kollektiv-mc/konnekt)"

	// The maven path NeoForge publishes its server installers under.
	neoForgeArtifact = "net/neoforged/neoforge"
)

// NeoForgeClient implements LoaderProvider against NeoForge's maven repository.
// baseURL is injectable, the same way ModrinthClient's and UpdateService's are,
// so tests can point the client at an httptest.Server.
type NeoForgeClient struct {
	http    *http.Client
	baseURL string
}

func NewNeoForgeClient() *NeoForgeClient {
	return &NeoForgeClient{
		http:    &http.Client{Timeout: 30 * time.Second},
		baseURL: neoForgeBase,
	}
}

func (c *NeoForgeClient) ID() string { return "neoforge" }

// neoForgeVersions is the shape of the maven versions API response.
type neoForgeVersions struct {
	IsSnapshot bool     `json:"isSnapshot"`
	Versions   []string `json:"versions"`
}

// InstallerURL builds the conventional installer path for a build. NeoForge
// publishes every build at the same shape, so this needs no round trip.
func (c *NeoForgeClient) InstallerURL(version string) string {
	return fmt.Sprintf("%s/releases/%s/%s/neoforge-%s-installer.jar",
		strings.TrimRight(c.baseURL, "/"), neoForgeArtifact, version, version)
}

func (c *NeoForgeClient) Versions(ctx context.Context, mcVersion string) ([]models.LoaderVersion, error) {
	url := fmt.Sprintf("%s/api/maven/versions/releases/%s",
		strings.TrimRight(c.baseURL, "/"), neoForgeArtifact)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("build NeoForge version request: %w", err)
	}
	req.Header.Set("User-Agent", neoForgeUserAgent)
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch NeoForge versions: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("fetch NeoForge versions: HTTP %d", resp.StatusCode)
	}

	// Bounded read: the list is a few hundred short strings, and an unbounded
	// decode of whatever a proxy or captive portal returned is not worth it.
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, fmt.Errorf("read NeoForge versions: %w", err)
	}

	var raw neoForgeVersions
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("parse NeoForge versions: %w", err)
	}

	return buildLoaderVersions(raw.Versions, mcVersion), nil
}

// buildLoaderVersions turns raw maven version strings into sorted, classified
// LoaderVersions. Split out from the HTTP call so the classification, ordering
// and Latest rules are testable without a server.
func buildLoaderVersions(raw []string, mcVersion string) []models.LoaderVersion {
	out := make([]models.LoaderVersion, 0, len(raw))
	for _, v := range raw {
		v = strings.TrimSpace(v)
		if v == "" {
			continue
		}
		mc := mcVersionForNeoForge(v)
		if mcVersion != "" && mc != mcVersion {
			continue
		}
		out = append(out, models.LoaderVersion{
			Version:   v,
			MCVersion: mc,
			Stable:    !isPrerelease(v),
		})
	}

	// The API returns ascending order today. Sorting explicitly means the UI's
	// "newest first" does not depend on that staying true, and a numeric compare
	// is required regardless: "21.1.9" sorts above "21.1.72" as a string.
	sort.SliceStable(out, func(i, j int) bool {
		return compareNeoForgeVersions(out[i].Version, out[j].Version) > 0
	})

	markLatestPerMCVersion(out)
	return out
}

// markLatestPerMCVersion flags the build Konnekt recommends for each Minecraft
// version: the newest stable one, or the newest of any kind when that Minecraft
// version has no stable release yet. Input must already be sorted newest first.
func markLatestPerMCVersion(versions []models.LoaderVersion) {
	firstStable := make(map[string]int)
	firstAny := make(map[string]int)
	for i, v := range versions {
		if _, seen := firstAny[v.MCVersion]; !seen {
			firstAny[v.MCVersion] = i
		}
		if v.Stable {
			if _, seen := firstStable[v.MCVersion]; !seen {
				firstStable[v.MCVersion] = i
			}
		}
	}
	for mc, i := range firstAny {
		if stable, ok := firstStable[mc]; ok {
			versions[stable].Latest = true
			continue
		}
		versions[i].Latest = true
	}
}

// isPrerelease reports whether a build carries a qualifier such as "-beta".
func isPrerelease(version string) bool {
	return strings.Contains(version, "-")
}

// mcVersionForNeoForge derives the Minecraft version a build targets.
//
// NeoForge numbers itself <mcMinor>.<mcPatch>.<build>, so 21.1.72 targets
// Minecraft 1.21.1. A zero patch means the .0 release, which Minecraft writes
// without it: 21.0.167 targets 1.21, not 1.21.0. Returns "" for anything that
// does not parse, which the caller filters out rather than guessing at.
func mcVersionForNeoForge(version string) string {
	parts := strings.Split(strings.SplitN(version, "-", 2)[0], ".")
	if len(parts) < 3 {
		return ""
	}
	major, err := strconv.Atoi(parts[0])
	if err != nil {
		return ""
	}
	minor, err := strconv.Atoi(parts[1])
	if err != nil {
		return ""
	}
	if _, err := strconv.Atoi(parts[2]); err != nil {
		return ""
	}
	if minor == 0 {
		return fmt.Sprintf("1.%d", major)
	}
	return fmt.Sprintf("1.%d.%d", major, minor)
}

// compareNeoForgeVersions orders two builds: positive when a is newer than b.
// Numeric per component, with a release ahead of a prerelease carrying the same
// numbers. An unparseable component compares as lower than any number, so
// malformed input sorts to the end rather than reordering valid entries.
func compareNeoForgeVersions(a, b string) int {
	aNums, aPre := splitNeoForgeVersion(a)
	bNums, bPre := splitNeoForgeVersion(b)

	for i := 0; i < len(aNums) || i < len(bNums); i++ {
		av, bv := -1, -1
		if i < len(aNums) {
			av = aNums[i]
		}
		if i < len(bNums) {
			bv = bNums[i]
		}
		if av != bv {
			if av > bv {
				return 1
			}
			return -1
		}
	}

	switch {
	case aPre == bPre:
		return strings.Compare(a, b)
	case aPre:
		return -1
	default:
		return 1
	}
}

// splitNeoForgeVersion returns the numeric components of a build and whether it
// carries a prerelease qualifier. Non-numeric components become -1, which
// compares below every real component.
func splitNeoForgeVersion(version string) ([]int, bool) {
	base, _, pre := strings.Cut(version, "-")
	fields := strings.Split(base, ".")
	nums := make([]int, len(fields))
	for i, f := range fields {
		n, err := strconv.Atoi(f)
		if err != nil {
			n = -1
		}
		nums[i] = n
	}
	return nums, pre
}
