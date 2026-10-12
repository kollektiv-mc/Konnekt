package models

// Destination is a bucket the app can upload to: Cloudflare R2 first, any
// S3-compatible store second. It is saved once in Settings and referred to by
// name from a scheduler graph, so an exported graph never carries a credential.
//
// There is no secret field, and there must not be one (agent_docs/
// SECURITY_CHECKLIST.md § S2.3). The secret access key lives in its own owner-only
// file under the data directory, keyed by ID (services.DestinationService), and
// reaches the backend only as a separate argument to SaveDestination and
// TestDestination. AccessKeyID is an identifier, not a credential on its own.
type Destination struct {
	ID       string `json:"id"`
	Name     string `json:"name"`     // what a graph refers to; unique
	Endpoint string `json:"endpoint"` // https://<account>.r2.cloudflarestorage.com, host only
	Region   string `json:"region"`   // "auto" for R2
	Bucket   string `json:"bucket"`
	// Prefix is the key prefix uploads go under, without leading or trailing
	// slashes. Optional.
	Prefix string `json:"prefix"`
	// PublicBaseURL is the custom domain the bucket is served from, used to build
	// the links a snapshot publishes. Optional.
	PublicBaseURL string `json:"publicBaseUrl"`
	AccessKeyID   string `json:"accessKeyId"`
	// SecretSet reports whether a secret access key is stored for this
	// destination. It is filled in by the list call and ignored on save; the
	// secret itself is never sent to the frontend.
	SecretSet bool `json:"secretSet"`
	// PrivateLink reports whether the snapshot published here sits under a private
	// link (#561). It is a mode flag filled in by the list call and ignored on
	// save. The link's token is a credential and is never a field of this struct:
	// it lives in its own owner-only file (services.DestinationService).
	PrivateLink bool `json:"privateLink"`
}

// DestinationTestResult is what TestDestination found, in words a person can act
// on. Status is one of "ok", "credentials", "bucket", "unreachable", "invalid" or
// "error". Message never carries the secret or any request header.
type DestinationTestResult struct {
	OK      bool   `json:"ok"`
	Status  string `json:"status"`
	Message string `json:"message"`
}

// SnapshotLinkResult is what the three snapshot-link calls answer (#561). Link is
// filled only by GetSnapshotLink, on an explicit click: it carries the private
// token, so nothing that lists, saves or emits ever holds it. Message is in words
// a person can act on; OldLinkStillWorks is true when a move finished but the
// previous link could not be removed, which a person who rotated to revoke it
// needs to hear.
type SnapshotLinkResult struct {
	Private           bool   `json:"private"`
	Link              string `json:"link"`
	Message           string `json:"message"`
	OldLinkStillWorks bool   `json:"oldLinkStillWorks"`
}
