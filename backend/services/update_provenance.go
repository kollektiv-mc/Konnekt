package services

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"sync"

	"github.com/sigstore/sigstore-go/pkg/bundle"
	"github.com/sigstore/sigstore-go/pkg/root"
	"github.com/sigstore/sigstore-go/pkg/tuf"
	"github.com/sigstore/sigstore-go/pkg/verify"
)

// Update authenticity (#432, SECURITY_CHECKLIST.md § S1.2).
//
// checksums.txt and the binary come from the same release, so anyone who can
// upload a release asset can upload a matching pair. What they cannot make is
// the build provenance release.yml and snapshot.yml publish with actions/attest:
// an in-toto statement naming each artifact's digest, signed with a short-lived
// Fulcio certificate issued to that workflow's OIDC token and recorded in
// Rekor. So before a byte of the binary is downloaded, the digest checksums.txt
// names has to carry an attestation that Sigstore's public-good trust root
// verifies and whose certificate was issued to one of this repository's two
// release workflows. selfupdate.Apply then holds the download to that digest,
// which is what ties the verified statement to the bytes that are installed.
//
// What it does not cover: someone who can push to main, or push a v* tag whose
// release.yml they have rewritten, can produce a valid attestation. That is a
// repository compromise rather than an asset-upload one, and branch protection
// is the control for it, not the updater.

const (
	// The repository the attestation API is asked about. The release paths
	// above spell it out the same way.
	updateAttestationsPath = "/repos/kollektiv-mc/Konnekt/attestations/sha256:"

	// A response is a handful of bundles of a few KB each.
	maxAttestationJSONBytes = 4 << 20

	// What a GitHub Actions OIDC token is issued by, and the workflows allowed
	// to have signed. release.yml runs from main when cut from the Actions tab
	// and from the tag when one is pushed by hand; snapshot.yml runs nightly
	// from main. Both were read off the certificates of v0.2.0-alpha.2 and the
	// 2026-10-06 snapshot.
	githubActionsIssuer  = "https://token.actions.githubusercontent.com"
	konnektReleaseSigner = `^https://github\.com/kollektiv-mc/Konnekt/\.github/workflows/(release\.yml@refs/(heads/main|tags/v[0-9][^/]*)|snapshot\.yml@refs/heads/main)$`
)

// provenanceVerifier checks that a release artifact's SHA-256 is attested by
// one of the release workflows. A seam so the install path is testable without
// Sigstore's network; production uses sigstoreVerifier.
type provenanceVerifier interface {
	verify(ctx context.Context, s *UpdateService, digest []byte) error
}

// errNotAttested is the refusal when no attestation for the digest verifies.
var errNotAttested = errors.New("no valid build provenance for this download")

// sigstoreVerifier fetches the attestations GitHub holds for a digest and
// verifies them against Sigstore's public-good trust root.
type sigstoreVerifier struct {
	// trustedRoot returns the trust material; production reads it through TUF,
	// tests hand in a fixed trusted_root.json.
	trustedRoot func() (root.TrustedMaterial, error)
	// signer is the SAN regular expression the certificate must match.
	signer string
}

// newSigstoreVerifier reads the trust root through Sigstore's TUF repository,
// starting from the root.json sigstore-go embeds and caching under the app data
// dir. Fetched once per process, and only when an install is attempted.
func newSigstoreVerifier() *sigstoreVerifier {
	var (
		once sync.Once
		tm   root.TrustedMaterial
		err  error
	)
	return &sigstoreVerifier{
		signer: konnektReleaseSigner,
		trustedRoot: func() (root.TrustedMaterial, error) {
			once.Do(func() {
				opts := tuf.DefaultOptions()
				opts.CachePath = filepath.Join(DataDir(), "sigstore-tuf")
				client, cerr := tuf.New(opts)
				if cerr != nil {
					err = fmt.Errorf("sigstore trust root: %w", cerr)
					return
				}
				tr, gerr := root.GetTrustedRoot(client)
				if gerr != nil {
					err = fmt.Errorf("sigstore trust root: %w", gerr)
					return
				}
				tm = tr
			})
			return tm, err
		},
	}
}

func (v *sigstoreVerifier) verify(ctx context.Context, s *UpdateService, digest []byte) error {
	bundles, err := s.fetchAttestations(ctx, digest)
	if err != nil {
		return fmt.Errorf("fetch build provenance: %w", err)
	}
	if len(bundles) == 0 {
		return errNotAttested
	}
	tm, err := v.trustedRoot()
	if err != nil {
		return err
	}
	// Public-good Sigstore, as actions/attest uses for a public repository:
	// an SCT on the certificate, a Rekor entry, and Rekor's integrated time as
	// the moment the short-lived certificate is checked against.
	verifier, err := verify.NewVerifier(tm,
		verify.WithSignedCertificateTimestamps(1),
		verify.WithTransparencyLog(1),
		verify.WithObserverTimestamps(1),
	)
	if err != nil {
		return fmt.Errorf("build provenance verifier: %w", err)
	}
	identity, err := verify.NewShortCertificateIdentity(githubActionsIssuer, "", "", v.signer)
	if err != nil {
		return fmt.Errorf("build provenance identity: %w", err)
	}
	policy := verify.NewPolicy(verify.WithArtifactDigest("sha256", digest), verify.WithCertificateIdentity(identity))

	// The list arrives over the network and is verified, not trusted: one
	// bundle that verifies is enough, and the last error explains a refusal.
	var last error
	for _, b := range bundles {
		if _, err := verifier.Verify(b, policy); err != nil {
			last = err
			continue
		}
		return nil
	}
	return fmt.Errorf("%w: %v", errNotAttested, last)
}

// fetchAttestations asks GitHub's attestation API for the bundles that name
// digest. A 404 is GitHub's answer for a digest nothing attested, which is a
// refusal rather than a transport failure.
func (s *UpdateService) fetchAttestations(ctx context.Context, digest []byte) ([]*bundle.Bundle, error) {
	url := s.baseURL + updateAttestationsPath + hex.EncodeToString(digest)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", updateUserAgent)
	resp, err := s.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	body, err := readCapped(resp.Body, maxAttestationJSONBytes)
	if err != nil {
		return nil, err
	}
	var payload struct {
		Attestations []struct {
			Bundle json.RawMessage `json:"bundle"`
		} `json:"attestations"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("decode: %w", err)
	}
	bundles := make([]*bundle.Bundle, 0, len(payload.Attestations))
	for _, a := range payload.Attestations {
		var b bundle.Bundle
		// One unreadable bundle is not a reason to ignore the others.
		if err := b.UnmarshalJSON(a.Bundle); err != nil {
			continue
		}
		bundles = append(bundles, &b)
	}
	return bundles, nil
}

// verifyProvenance is the install path's check: the service's verifier, or the
// Sigstore one when none was set.
func (s *UpdateService) verifyProvenance(ctx context.Context, digest []byte) error {
	v := s.provenance
	if v == nil {
		v = defaultProvenance()
	}
	return v.verify(ctx, s, digest)
}

// defaultProvenance is one Sigstore verifier per process, so the trust root is
// fetched once however many installs are attempted.
var defaultProvenance = sync.OnceValue(func() provenanceVerifier { return newSigstoreVerifier() })
