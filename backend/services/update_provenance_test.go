package services

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/sigstore/sigstore-go/pkg/root"
)

// The fixtures under testdata/provenance are real, recorded on 2026-10-09:
//
//   - v0.2.0-alpha.2-linux-amd64.json: GitHub's attestation API response for
//     the v0.2.0-alpha.2 konnekt-linux-amd64 digest, signed by release.yml
//     from refs/heads/main.
//   - snapshot-linux-amd64.json: the same for the 2026-10-06 snapshot's
//     konnekt-linux-amd64, signed by snapshot.yml.
//   - trusted_root.json: Sigstore's public-good trust root, the TUF target
//     from sigstore/root-signing's main branch.
//
// So the verifier is exercised against what production meets, with no network.
const (
	alpha2LinuxDigest   = "a2350aa265fcd23a12b42a35aed4dc6098f4c7898a1fffdcc04687e6a0d85d90"
	snapshotLinuxDigest = "057f30b4f8e2fe85281c3553c72f6001ecb40e79cbdd3662b8a39d147abde093"
)

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "provenance", name))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func fixtureVerifier(t *testing.T, signer string) *sigstoreVerifier {
	t.Helper()
	tr, err := root.NewTrustedRootFromJSON(fixture(t, "trusted_root.json"))
	if err != nil {
		t.Fatal(err)
	}
	return &sigstoreVerifier{signer: signer, trustedRoot: func() (root.TrustedMaterial, error) { return tr, nil }}
}

// attestationServer answers the attestation API with body for every digest,
// and records which digests were asked about.
func attestationServer(t *testing.T, status int, body []byte) (*UpdateService, *[]string) {
	t.Helper()
	var asked []string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		digest, ok := strings.CutPrefix(r.URL.Path, updateAttestationsPath)
		if !ok {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		asked = append(asked, digest)
		w.WriteHeader(status)
		_, _ = w.Write(body)
	}))
	t.Cleanup(ts.Close)
	return &UpdateService{http: ts.Client(), baseURL: ts.URL}, &asked
}

func mustHex(t *testing.T, s string) []byte {
	t.Helper()
	b, err := hex.DecodeString(s)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestSigstoreVerifierAcceptsRealReleases(t *testing.T) {
	for _, tc := range []struct{ name, file, digest string }{
		{"release.yml, cut from main", "v0.2.0-alpha.2-linux-amd64.json", alpha2LinuxDigest},
		{"snapshot.yml, nightly from main", "snapshot-linux-amd64.json", snapshotLinuxDigest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			svc, asked := attestationServer(t, http.StatusOK, fixture(t, tc.file))
			if err := fixtureVerifier(t, konnektReleaseSigner).verify(context.Background(), svc, mustHex(t, tc.digest)); err != nil {
				t.Fatalf("verify: %v", err)
			}
			if len(*asked) != 1 || (*asked)[0] != tc.digest {
				t.Errorf("asked about %v, want just %s", *asked, tc.digest)
			}
		})
	}
}

// The S1.2 probe: a matching binary and checksums.txt pair uploaded by someone
// who is not the release workflow. Their digest either has no attestation at
// all, or the attestations served for it name some other digest.
func TestSigstoreVerifierRefusesAnUnattestedDigest(t *testing.T) {
	forged := strings.Repeat("ab", 32)
	cases := []struct {
		name   string
		status int
		body   []byte
	}{
		{"GitHub has nothing for it", http.StatusNotFound, []byte(`{"message":"Not Found"}`)},
		{"an empty list", http.StatusOK, []byte(`{"attestations":[]}`)},
		{"a genuine bundle for a different digest", http.StatusOK, fixture(t, "v0.2.0-alpha.2-linux-amd64.json")},
		{"an unreadable bundle", http.StatusOK, []byte(`{"attestations":[{"bundle":{"mediaType":"nonsense"}}]}`)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc, _ := attestationServer(t, tc.status, tc.body)
			err := fixtureVerifier(t, konnektReleaseSigner).verify(context.Background(), svc, mustHex(t, forged))
			if !errors.Is(err, errNotAttested) {
				t.Errorf("err = %v, want errNotAttested", err)
			}
		})
	}
}

// A genuine Sigstore signature is not enough: it has to be this repository's
// release workflows that signed. A fork's release.yml, or any other workflow
// here, is refused.
func TestSigstoreVerifierRefusesAnotherSigner(t *testing.T) {
	for _, signer := range []string{
		`^https://github\.com/someone-else/Konnekt/\.github/workflows/release\.yml@refs/heads/main$`,
		`^https://github\.com/kollektiv-mc/Konnekt/\.github/workflows/ci\.yml@refs/heads/main$`,
		`^https://github\.com/kollektiv-mc/Konnekt/\.github/workflows/release\.yml@refs/heads/other$`,
	} {
		svc, _ := attestationServer(t, http.StatusOK, fixture(t, "v0.2.0-alpha.2-linux-amd64.json"))
		err := fixtureVerifier(t, signer).verify(context.Background(), svc, mustHex(t, alpha2LinuxDigest))
		if !errors.Is(err, errNotAttested) {
			t.Errorf("signer %s: err = %v, want errNotAttested", signer, err)
		}
	}
}

// The genuine attestation with its signature altered: the statement still
// names the right digest and the certificate the right workflow, so only the
// cryptography stands between this and an install.
func TestSigstoreVerifierRefusesATamperedSignature(t *testing.T) {
	var resp struct {
		Attestations []struct {
			Bundle map[string]any `json:"bundle"`
		} `json:"attestations"`
	}
	if err := json.Unmarshal(fixture(t, "v0.2.0-alpha.2-linux-amd64.json"), &resp); err != nil {
		t.Fatal(err)
	}
	sigs := resp.Attestations[0].Bundle["dsseEnvelope"].(map[string]any)["signatures"].([]any)
	sig := sigs[0].(map[string]any)
	raw := []byte(sig["sig"].(string))
	raw[10] ^= 'A' ^ 'B' // a different base64 digit, so it still decodes
	if raw[10] == '+' || raw[10] == '/' || raw[10] == '=' {
		t.Fatal("tamper produced a non-alphanumeric digit; pick another offset")
	}
	sig["sig"] = string(raw)
	body, err := json.Marshal(resp)
	if err != nil {
		t.Fatal(err)
	}
	svc, _ := attestationServer(t, http.StatusOK, body)
	err = fixtureVerifier(t, konnektReleaseSigner).verify(context.Background(), svc, mustHex(t, alpha2LinuxDigest))
	if !errors.Is(err, errNotAttested) {
		t.Errorf("err = %v, want errNotAttested", err)
	}
}

func TestKonnektReleaseSignerPattern(t *testing.T) {
	const prefix = "https://github.com/kollektiv-mc/Konnekt/.github/workflows/"
	for _, tc := range []struct {
		san  string
		want bool
	}{
		{prefix + "release.yml@refs/heads/main", true},
		{prefix + "release.yml@refs/tags/v0.2.0-alpha.2", true},
		{prefix + "snapshot.yml@refs/heads/main", true},
		{prefix + "release.yml@refs/heads/feature", false},
		{prefix + "release.yml@refs/tags/snapshot", false},
		{prefix + "snapshot.yml@refs/tags/v1.0.0", false},
		{prefix + "ci.yml@refs/heads/main", false},
		{"https://github.com/kollektiv-mc/KonnektX/.github/workflows/release.yml@refs/heads/main", false},
		{prefix + "release.yml@refs/heads/main.evil", false},
	} {
		got := regexp.MustCompile(konnektReleaseSigner).MatchString(tc.san)
		if got != tc.want {
			t.Errorf("%s: match = %v, want %v", tc.san, got, tc.want)
		}
	}
}

func TestSigstoreVerifierReportsATransportFailure(t *testing.T) {
	svc, _ := attestationServer(t, http.StatusInternalServerError, nil)
	err := fixtureVerifier(t, konnektReleaseSigner).verify(context.Background(), svc, mustHex(t, alpha2LinuxDigest))
	if err == nil || errors.Is(err, errNotAttested) || !strings.Contains(err.Error(), "HTTP 500") {
		t.Errorf("err = %v, want the HTTP failure", err)
	}
}

func TestSigstoreVerifierReportsAnUnavailableTrustRoot(t *testing.T) {
	svc, _ := attestationServer(t, http.StatusOK, fixture(t, "v0.2.0-alpha.2-linux-amd64.json"))
	v := &sigstoreVerifier{signer: konnektReleaseSigner, trustedRoot: func() (root.TrustedMaterial, error) {
		return nil, errors.New("sigstore trust root: offline")
	}}
	if err := v.verify(context.Background(), svc, mustHex(t, alpha2LinuxDigest)); err == nil || !strings.Contains(err.Error(), "offline") {
		t.Errorf("err = %v, want the trust-root failure", err)
	}
}

func TestFetchAttestationsRefusesAnOversizedBody(t *testing.T) {
	svc, _ := attestationServer(t, http.StatusOK, []byte(strings.Repeat(" ", maxAttestationJSONBytes+1)))
	if _, err := svc.fetchAttestations(context.Background(), mustHex(t, alpha2LinuxDigest)); !errors.Is(err, errTooLarge) {
		t.Errorf("err = %v, want errTooLarge", err)
	}
}

type fakeProvenance struct {
	err    error
	digest []byte
}

func (f *fakeProvenance) verify(_ context.Context, _ *UpdateService, digest []byte) error {
	f.digest = digest
	return f.err
}

// The install path asks about the digest checksums.txt names for this
// platform's asset, and a refusal stops it before the binary is requested.
func TestDownloadAndInstallUpdateRefusesBeforeDownloadingWithoutProvenance(t *testing.T) {
	name, err := platformAssetNameFor(runtime.GOOS, runtime.GOARCH)
	if err != nil {
		t.Skipf("no release asset for %s/%s: %v", runtime.GOOS, runtime.GOARCH, err)
	}
	sum := strings.Repeat("cd", 32)
	var binaryHits atomic.Int32
	var ts *httptest.Server
	ts = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case updateRepoPath:
			rel := map[string]any{
				"tag_name": "v9.0.0",
				"assets": []map[string]any{
					{"name": name, "browser_download_url": ts.URL + "/bin", "size": 4},
					{"name": updateChecksumsAssetName, "browser_download_url": ts.URL + "/sums", "size": 100},
				},
			}
			_ = json.NewEncoder(w).Encode(rel)
		case "/sums":
			_, _ = fmt.Fprintf(w, "%s  %s\n", sum, name)
		case "/bin":
			binaryHits.Add(1)
			_, _ = w.Write([]byte("evil"))
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
		}
	}))
	defer ts.Close()

	fake := &fakeProvenance{err: errNotAttested}
	svc := &UpdateService{http: ts.Client(), baseURL: ts.URL, checkURL: allowHost(ts.URL), provenance: fake}
	err = svc.DownloadAndInstallUpdate(context.Background(), "0.1.0", UpdateChannelStable)
	if !errors.Is(err, errNotAttested) {
		t.Fatalf("err = %v, want errNotAttested", err)
	}
	if got := hex.EncodeToString(fake.digest); got != sum {
		t.Errorf("verified digest %s, want the checksums.txt entry %s", got, sum)
	}
	if n := binaryHits.Load(); n != 0 {
		t.Errorf("the binary was requested %d times, want 0", n)
	}
}
