package services

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"konnekt/backend/models"
)

const (
	// destinationsFile holds the destinations without their secrets. Nothing in it
	// is usable on its own, so it is an ordinary data file.
	destinationsFile = "destinations.json"

	// destinationSecretsDir holds one owner-only file per destination, named by
	// its id. A separate file per secret is what makes "delete the destination"
	// also "delete the secret" without rewriting anything else, and keeps the
	// secret out of every file the rest of the app reads (S2.3).
	destinationSecretsDir = "destination_secrets"

	destinationSecretExt = ".secret"

	// destinationTestTimeout bounds the whole connection test, including the
	// client's retries of a 5xx.
	destinationTestTimeout = 20 * time.Second

	destinationDefaultRegion = "auto"
)

// Test outcomes, the Status of a models.DestinationTestResult.
const (
	DestinationTestOK          = "ok"
	DestinationTestCredentials = "credentials"
	DestinationTestBucket      = "bucket"
	DestinationTestUnreachable = "unreachable"
	DestinationTestInvalid     = "invalid"
	DestinationTestError       = "error"
)

// destinationIDPattern is what newDestinationID produces. The id becomes part of
// a file name, so anything else is refused before it can name a path.
var destinationIDPattern = regexp.MustCompile(`^[0-9a-f]{16}$`)

// DestinationService owns the saved bucket destinations (#480): the list in
// destinations.json and one owner-only secret file per destination.
//
// The secret access key is never part of anything this service returns, logs or
// puts in an error. It is read from its file only to sign a request.
type DestinationService struct {
	mu      sync.Mutex
	dataDir string

	// httpClient and retryBase are for tests, which point the client at an
	// httptest.Server and do not want to wait out its backoff. Production leaves
	// both zero.
	httpClient *http.Client
	retryBase  time.Duration
}

func NewDestinationService() *DestinationService {
	return &DestinationService{}
}

func (s *DestinationService) SetDataDir(dir string) {
	s.dataDir = dir
}

func newDestinationID() (string, error) {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("generate destination id: %w", err)
	}
	return hex.EncodeToString(b[:]), nil
}

func (s *DestinationService) secretPath(id string) string {
	return filepath.Join(s.dataDir, destinationSecretsDir, id+destinationSecretExt)
}

// List returns every destination with SecretSet filled in. The slice is never
// nil, so the frontend does not receive null.
func (s *DestinationService) List() ([]models.Destination, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.listLocked()
}

func (s *DestinationService) listLocked() ([]models.Destination, error) {
	list, err := s.loadLocked()
	if err != nil {
		return nil, err
	}
	for i := range list {
		list[i].SecretSet = s.hasSecretLocked(list[i].ID)
	}
	return list, nil
}

// loadLocked reads destinations.json. A missing or empty file is the first run.
// SecretSet is never persisted, so a hand-edited file cannot claim a secret.
func (s *DestinationService) loadLocked() ([]models.Destination, error) {
	if s.dataDir == "" {
		return nil, fmt.Errorf("read %s: data directory is not set", destinationsFile)
	}
	data, err := os.ReadFile(filepath.Join(s.dataDir, destinationsFile))
	if os.IsNotExist(err) {
		return []models.Destination{}, nil
	}
	if err != nil {
		return nil, err
	}
	list := []models.Destination{}
	if len(data) == 0 {
		return list, nil
	}
	if err := json.Unmarshal(data, &list); err != nil {
		return nil, fmt.Errorf("parse %s: %w", destinationsFile, err)
	}
	for i := range list {
		list[i].SecretSet = false
	}
	if list == nil {
		list = []models.Destination{}
	}
	return list, nil
}

func (s *DestinationService) storeLocked(list []models.Destination) error {
	out := make([]models.Destination, len(list))
	copy(out, list)
	for i := range out {
		out[i].SecretSet = false
	}
	data, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		return fmt.Errorf("encode %s: %w", destinationsFile, err)
	}
	return WriteDataFile(s.dataDir, destinationsFile, data)
}

func (s *DestinationService) hasSecretLocked(id string) bool {
	if !destinationIDPattern.MatchString(id) {
		return false
	}
	info, err := os.Stat(s.secretPath(id))
	return err == nil && info.Mode().IsRegular()
}

// readSecretLocked returns the stored secret, or "" when there is none.
func (s *DestinationService) readSecretLocked(id string) (string, error) {
	if !destinationIDPattern.MatchString(id) {
		return "", nil
	}
	data, err := os.ReadFile(s.secretPath(id))
	if os.IsNotExist(err) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("read the stored secret for destination %s: %w", id, err)
	}
	return string(data), nil
}

func (s *DestinationService) writeSecretLocked(id, secret string) error {
	dir := filepath.Join(s.dataDir, destinationSecretsDir)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("create %s: %w", destinationSecretsDir, err)
	}
	return WritePrivateDataFile(dir, id+destinationSecretExt, []byte(secret))
}

// Secret returns the stored secret access key of destination id, for the code that
// signs requests with it (the upload block). It is the one way the
// secret leaves this file, and nothing bound to the frontend calls it.
func (s *DestinationService) Secret(id string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.readSecretLocked(id)
}

// normalizeDestination trims the fields, defaults the region and checks what can
// be checked without the network. The returned value is what gets saved.
func normalizeDestination(d models.Destination) (models.Destination, error) {
	d.Name = strings.TrimSpace(d.Name)
	d.Endpoint = strings.TrimSpace(d.Endpoint)
	d.Region = strings.TrimSpace(d.Region)
	d.Bucket = strings.TrimSpace(d.Bucket)
	d.Prefix = strings.Trim(strings.TrimSpace(d.Prefix), "/")
	d.PublicBaseURL = strings.TrimRight(strings.TrimSpace(d.PublicBaseURL), "/")
	d.AccessKeyID = strings.TrimSpace(d.AccessKeyID)
	d.SecretSet = false
	if d.Region == "" {
		d.Region = destinationDefaultRegion
	}
	switch {
	case d.Name == "":
		return d, errors.New("name is required")
	case d.Endpoint == "":
		return d, errors.New("endpoint is required")
	case d.Bucket == "":
		return d, errors.New("bucket is required")
	case d.AccessKeyID == "":
		return d, errors.New("access key id is required")
	}
	// The client is the authority on what an endpoint and a bucket name may be.
	// A placeholder stands in for the secret, which is checked on its own.
	if _, err := NewS3Client(S3Config{
		Endpoint: d.Endpoint, Region: d.Region, Bucket: d.Bucket,
		AccessKeyID: d.AccessKeyID, SecretAccessKey: "x",
	}, nil); err != nil {
		return d, errors.New(strings.TrimPrefix(err.Error(), "s3: "))
	}
	if d.PublicBaseURL != "" {
		u, err := url.Parse(d.PublicBaseURL)
		if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil {
			return d, errors.New("public base URL must be an http(s) address")
		}
	}
	return d, nil
}

// Save adds a destination (empty ID) or replaces one. A blank secret keeps the
// stored one; a new destination needs a secret. It returns the saved
// destination, which never carries the secret.
func (s *DestinationService) Save(d models.Destination, secret string) (models.Destination, error) {
	d, err := normalizeDestination(d)
	if err != nil {
		return models.Destination{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	list, err := s.loadLocked()
	if err != nil {
		return models.Destination{}, err
	}
	at := -1
	for i, e := range list {
		if e.ID == d.ID && d.ID != "" {
			at = i
		}
		if e.ID != d.ID && strings.EqualFold(e.Name, d.Name) {
			return models.Destination{}, fmt.Errorf("a destination named %q already exists", e.Name)
		}
	}
	if d.ID != "" && at < 0 {
		return models.Destination{}, errors.New("destination not found")
	}
	if d.ID == "" {
		if d.ID, err = newDestinationID(); err != nil {
			return models.Destination{}, err
		}
	}
	if secret == "" && !s.hasSecretLocked(d.ID) {
		return models.Destination{}, errors.New("secret access key is required")
	}

	// The secret first: a failure here leaves the list as it was, and a secret
	// with no destination is inert.
	if secret != "" {
		if err := s.writeSecretLocked(d.ID, secret); err != nil {
			return models.Destination{}, err
		}
	}
	if at >= 0 {
		list[at] = d
	} else {
		list = append(list, d)
	}
	if err := s.storeLocked(list); err != nil {
		return models.Destination{}, err
	}
	d.SecretSet = true
	return d, nil
}

// Delete removes a destination and its secret file. Deleting one that is not
// there is not an error.
func (s *DestinationService) Delete(id string) error {
	if !destinationIDPattern.MatchString(id) {
		return errors.New("destination not found")
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	list, err := s.loadLocked()
	if err != nil {
		return err
	}
	// The secret first, so a failure leaves the destination listed and the delete
	// can be tried again, rather than an unlisted secret nobody can remove.
	if err := os.Remove(s.secretPath(id)); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("remove the stored secret for destination %s: %w", id, err)
	}
	kept := list[:0]
	for _, d := range list {
		if d.ID != id {
			kept = append(kept, d)
		}
	}
	if len(kept) == len(list) {
		return nil
	}
	return s.storeLocked(kept)
}

// Test checks a destination's settings against the bucket without writing to it.
// secret is what was typed in the form; blank means the stored secret of d.ID.
// The result is always a verdict, never an error, so the pane can show it.
func (s *DestinationService) Test(ctx context.Context, d models.Destination, secret string) models.DestinationTestResult {
	d, err := normalizeDestination(d)
	if err != nil {
		return invalidResult(err.Error())
	}
	if secret == "" {
		s.mu.Lock()
		stored, rerr := s.readSecretLocked(d.ID)
		s.mu.Unlock()
		if rerr != nil {
			return invalidResult("The stored secret could not be read. Enter it again.")
		}
		secret = stored
	}
	if secret == "" {
		return invalidResult("Enter the secret access key to test.")
	}
	client, err := NewS3Client(S3Config{
		Endpoint: d.Endpoint, Region: d.Region, Bucket: d.Bucket,
		AccessKeyID: d.AccessKeyID, SecretAccessKey: secret,
	}, s.httpClient)
	if err != nil {
		return invalidResult(strings.TrimPrefix(err.Error(), "s3: "))
	}
	if s.retryBase > 0 {
		client.backoff = s.retryBase
	}
	ctx, cancel := context.WithTimeout(ctx, destinationTestTimeout)
	defer cancel()
	return probeBucket(ctx, client, d)
}

func invalidResult(msg string) models.DestinationTestResult {
	return models.DestinationTestResult{Status: DestinationTestInvalid, Message: msg}
}

// probeBucket asks about a key nobody has written, which writes nothing. A signed
// HEAD tells a refused credential (403) from one that works (404 for the key).
// A 404 alone cannot tell a missing key from a missing bucket, so it is followed
// by a HEAD of the bucket itself.
func probeBucket(ctx context.Context, c *S3Client, d models.Destination) models.DestinationTestResult {
	suffix, err := newDestinationID()
	if err != nil {
		return models.DestinationTestResult{Status: DestinationTestError, Message: "Could not build a probe key."}
	}
	key := ".konnekt-probe-" + suffix
	if d.Prefix != "" {
		key = d.Prefix + "/" + key
	}
	host := c.base.Host

	_, _, err = c.HeadObject(ctx, key)
	if err != nil {
		return classifyProbeError(err, host)
	}

	resp, err := c.roundTrip(ctx, s3Call{op: "HeadBucket", method: http.MethodHead, payloadHash: s3EmptyHash})
	if err != nil {
		return classifyProbeError(err, host)
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, s3ErrorBodyLimit)) //nolint:errcheck // draining a response being discarded
	_ = resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return models.DestinationTestResult{
			Status:  DestinationTestBucket,
			Message: fmt.Sprintf("Bucket not found: %s has no bucket named %q.", host, d.Bucket),
		}
	}
	// A 403 here still proves the bucket exists, and the signed HEAD of the key
	// above was answered with a 404, which a bucket the caller cannot list
	// would not have been.
	return models.DestinationTestResult{
		OK:      true,
		Status:  DestinationTestOK,
		Message: "Connected. The bucket answered and the credentials work.",
	}
}

func classifyProbeError(err error, host string) models.DestinationTestResult {
	var se *S3Error
	if !errors.As(err, &se) || se.Status == 0 {
		return models.DestinationTestResult{
			Status:  DestinationTestUnreachable,
			Message: fmt.Sprintf("Could not reach %s. Check the endpoint and your connection.", host),
		}
	}
	switch {
	case se.Status == http.StatusForbidden || se.Status == http.StatusUnauthorized:
		return models.DestinationTestResult{
			Status:  DestinationTestCredentials,
			Message: fmt.Sprintf("Wrong credentials: %s refused the access key or secret (%d).", host, se.Status),
		}
	case se.Status >= 500:
		return models.DestinationTestResult{
			Status:  DestinationTestError,
			Message: fmt.Sprintf("%s answered with an error (status %d). Try again in a moment.", host, se.Status),
		}
	default:
		return models.DestinationTestResult{
			Status:  DestinationTestError,
			Message: fmt.Sprintf("%s rejected the check (status %d %s). Check the region and endpoint.", host, se.Status, se.Code),
		}
	}
}
