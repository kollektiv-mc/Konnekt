package services

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/md5" //nolint:gosec // Content-MD5 is S3's required integrity header on DeleteObjects, not a security use
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// A small S3 client for S3-compatible storage (Cloudflare R2 first, any S3 API
// second). It is a library for the scheduler's upload and snapshot blocks: it has
// no bound method, no settings and no UI of its own. Stdlib only; AWS Signature
// Version 4 is HMAC-SHA256 over a canonical request, which crypto/hmac covers.
//
// Requests are path-style (https://<endpoint>/<bucket>/<key>), which R2 and every
// self-hosted S3 implementation accept. Later calls (GetObject, multipart, list,
// delete, copy) are methods on S3Client that go through roundTrip and so share the
// signer and the retry loop without changing either.

const (
	// s3MaxSinglePutBytes is S3's limit for one PUT. A larger file needs multipart
	// upload of local bytes, which this client does not do.
	s3MaxSinglePutBytes int64 = 5 << 30

	s3Service     = "s3"
	s3Algorithm   = "AWS4-HMAC-SHA256"
	s3AmzDate     = "20060102T150405Z"
	s3ScopeDate   = "20060102"
	s3MaxAttempts = 4
	s3RetryBase   = 500 * time.Millisecond

	// s3ErrorBodyLimit caps how much of an error response is read to find its Code
	// and Message.
	s3ErrorBodyLimit = 64 << 10

	// s3GetBodyLimit caps how much of an object GetObject reads into memory. The
	// objects it exists for are small JSON documents (a snapshot's index.json is
	// tens of KB even for a 20 GB database, one line per 8 MiB part), so a few
	// MiB is generous, and a larger object is refused rather than truncated.
	s3GetBodyLimit = 4 << 20

	// s3ListBodyLimit caps one page of a listing. A page holds at most 1000
	// entries of at most 1024 bytes of key each, with the metadata S3 adds to
	// every one, which stays far under this; a larger body is refused rather than
	// read in part.
	s3ListBodyLimit = 8 << 20

	// s3MaxDeleteKeys is S3's limit on the keys of one DeleteObjects request.
	s3MaxDeleteKeys = 1000

	s3Redacted = "[redacted]"
)

// ErrS3TooLarge is returned, before any request is sent, for a file over the
// single-PUT limit.
var ErrS3TooLarge = errors.New("file is over the 5 GiB single upload limit")

// S3Config names one bucket and the credentials that reach it. The secret is
// never printed: String, GoString and LogValue all redact it.
type S3Config struct {
	Endpoint        string // https://<account>.r2.cloudflarestorage.com, no path
	Region          string // "auto" for R2
	Bucket          string
	AccessKeyID     string
	SecretAccessKey string
}

func (c S3Config) String() string {
	return fmt.Sprintf("S3Config{endpoint=%s region=%s bucket=%s accessKeyID=%s secret=%s}",
		c.Endpoint, c.Region, c.Bucket, c.AccessKeyID, s3Redacted)
}

func (c S3Config) GoString() string { return c.String() }

func (c S3Config) LogValue() slog.Value {
	return slog.GroupValue(
		slog.String("endpoint", c.Endpoint),
		slog.String("region", c.Region),
		slog.String("bucket", c.Bucket),
		slog.String("accessKeyID", c.AccessKeyID),
		slog.String("secret", s3Redacted),
	)
}

// S3ObjectInfo is what HeadObject learns about an object.
type S3ObjectInfo struct {
	Size int64
	ETag string // without the surrounding quotes
}

// S3ListedObject is one entry of a listing: an object's key and its size.
type S3ListedObject struct {
	Key  string
	Size int64
}

// S3PutOptions are the optional parts of a PutObject.
type S3PutOptions struct {
	// IfNoneMatch sends "If-None-Match: *", so an object that already exists is
	// left alone and the call fails with a 412 (S3Error.PreconditionFailed).
	IfNoneMatch bool
}

// S3Client signs and sends requests to one bucket. Use it by pointer.
type S3Client struct {
	cfg     S3Config
	base    *url.URL
	http    *http.Client
	now     func() time.Time
	backoff time.Duration // first retry delay; doubles each attempt
}

// NewS3Client validates cfg. httpClient may be nil, which gives a client with
// connection timeouts but no overall one (an upload can legitimately take hours);
// tests pass one pointed at an httptest.Server.
func NewS3Client(cfg S3Config, httpClient *http.Client) (*S3Client, error) {
	cfg.Endpoint = strings.TrimSpace(cfg.Endpoint)
	if cfg.Endpoint == "" || cfg.Region == "" || cfg.Bucket == "" || cfg.AccessKeyID == "" || cfg.SecretAccessKey == "" {
		return nil, errors.New("s3: endpoint, region, bucket, access key id and secret are all required")
	}
	if !strings.Contains(cfg.Endpoint, "://") {
		cfg.Endpoint = "https://" + cfg.Endpoint
	}
	base, err := url.Parse(cfg.Endpoint)
	if err != nil || base.Host == "" || (base.Scheme != "https" && base.Scheme != "http") {
		return nil, errors.New("s3: endpoint must be an http(s) address")
	}
	if p := strings.Trim(base.Path, "/"); p != "" || base.RawQuery != "" || base.User != nil {
		return nil, errors.New("s3: endpoint must be a host only, without a path or credentials")
	}
	if strings.Contains(cfg.Bucket, "/") {
		return nil, errors.New("s3: bucket name must not contain a slash")
	}
	if httpClient == nil {
		httpClient = defaultS3HTTPClient()
	}
	return &S3Client{
		cfg:     cfg,
		base:    &url.URL{Scheme: base.Scheme, Host: base.Host},
		http:    httpClient,
		now:     func() time.Time { return time.Now().UTC() },
		backoff: s3RetryBase,
	}, nil
}

func defaultS3HTTPClient() *http.Client {
	t := http.DefaultTransport.(*http.Transport).Clone()
	t.TLSHandshakeTimeout = 15 * time.Second
	// Counts from the end of the request body, so it bounds the wait for S3 to
	// answer a finished upload rather than the upload itself.
	t.ResponseHeaderTimeout = 5 * time.Minute
	return &http.Client{Transport: t}
}

func (c *S3Client) String() string { return "S3Client{" + c.cfg.String() + "}" }

func (c *S3Client) GoString() string { return c.String() }

// --- errors ---

// S3Error is a failed call. It carries the operation, the key, the HTTP status and
// S3's own Code and Message, and nothing from the request: never the secret and
// never the Authorization header.
type S3Error struct {
	Op      string
	Key     string
	Status  int    // 0 when no response arrived
	Code    string // S3's error code, e.g. AccessDenied
	Message string
	Err     error // the transport error, when there was no response
	detail  string
}

func (e *S3Error) Error() string {
	var b strings.Builder
	b.WriteString("s3 " + e.Op)
	if e.Key != "" {
		b.WriteString(" " + e.Key)
	}
	if e.Status != 0 {
		fmt.Fprintf(&b, ": status %d", e.Status)
	}
	if e.Code != "" {
		b.WriteString(" " + e.Code)
	}
	if e.Message != "" {
		b.WriteString(": " + e.Message)
	}
	if e.detail != "" {
		b.WriteString(": " + e.detail)
	}
	return b.String()
}

func (e *S3Error) Unwrap() error { return e.Err }

// PreconditionFailed reports a 412, which is what an If-None-Match PUT of an
// object that already exists gets back.
func (e *S3Error) PreconditionFailed() bool { return e.Status == http.StatusPreconditionFailed }

// scrub removes the secret from text before it can reach an error string or a log.
func (c *S3Client) scrub(s string) string {
	return strings.ReplaceAll(s, c.cfg.SecretAccessKey, s3Redacted)
}

func (c *S3Client) transportError(op, key string, err error) *S3Error {
	return &S3Error{Op: op, Key: key, Err: err, detail: c.scrub(err.Error())}
}

// responseError reads the S3 XML error out of resp (closing it) without echoing
// the raw body.
func (c *S3Client) responseError(op, key string, resp *http.Response) *S3Error {
	defer func() { _ = resp.Body.Close() }()
	e := &S3Error{Op: op, Key: key, Status: resp.StatusCode}
	body, err := io.ReadAll(io.LimitReader(resp.Body, s3ErrorBodyLimit))
	if err == nil && len(body) > 0 {
		var doc struct {
			Code    string `xml:"Code"`
			Message string `xml:"Message"`
		}
		if xml.Unmarshal(body, &doc) == nil {
			e.Code, e.Message = c.scrub(doc.Code), c.scrub(doc.Message)
		}
	}
	if e.Code == "" {
		e.Code = http.StatusText(resp.StatusCode)
	}
	return e
}

// --- calls ---

// HeadObject reports whether key exists and, when it does, its size and ETag.
func (c *S3Client) HeadObject(ctx context.Context, key string) (S3ObjectInfo, bool, error) {
	const op = "HeadObject"
	resp, err := c.roundTrip(ctx, s3Call{op: op, method: http.MethodHead, key: key, payloadHash: s3EmptyHash})
	if err != nil {
		return S3ObjectInfo{}, false, err
	}
	defer func() { _ = resp.Body.Close() }()
	switch {
	case resp.StatusCode == http.StatusNotFound:
		return S3ObjectInfo{}, false, nil
	case resp.StatusCode/100 != 2:
		return S3ObjectInfo{}, false, c.responseError(op, key, resp)
	case resp.ContentLength < 0:
		return S3ObjectInfo{}, false, &S3Error{Op: op, Key: key, Status: resp.StatusCode, Message: "response has no Content-Length"}
	}
	return S3ObjectInfo{Size: resp.ContentLength, ETag: strings.Trim(resp.Header.Get("ETag"), `"`)}, true, nil
}

// GetObject reads the whole of key into memory. found is false, with no error, for
// a key that does not exist; a bucket that does not exist is an error, since
// reading "no previous snapshot" out of a mistyped bucket name would be wrong in
// a way nothing downstream could notice. An object over s3GetBodyLimit is an
// error and is not returned in part: the callers parse what they get, and half a
// document is worse than none.
func (c *S3Client) GetObject(ctx context.Context, key string) ([]byte, bool, error) {
	const op = "GetObject"
	resp, err := c.roundTrip(ctx, s3Call{op: op, method: http.MethodGet, key: key, payloadHash: s3EmptyHash})
	if err != nil {
		return nil, false, err
	}
	defer func() { _ = resp.Body.Close() }()
	switch {
	case resp.StatusCode == http.StatusNotFound:
		if se := c.responseError(op, key, resp); se.Code == "NoSuchBucket" {
			return nil, false, se
		}
		return nil, false, nil
	case resp.StatusCode/100 != 2:
		return nil, false, c.responseError(op, key, resp)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, s3GetBodyLimit+1))
	if err != nil {
		return nil, false, c.transportError(op, key, err)
	}
	if len(body) > s3GetBodyLimit {
		return nil, false, &S3Error{Op: op, Key: key, Status: resp.StatusCode,
			Message: fmt.Sprintf("object is over the %s this client reads into memory", fmtBytes(s3GetBodyLimit))}
	}
	return body, true, nil
}

// PutObject uploads the file at localPath as key in one PUT. The body is streamed
// from disk, never held in memory, and sent with its length and the SHA-256 of its
// content, so S3 verifies what arrived. A file over 5 GiB is refused before any
// request.
func (c *S3Client) PutObject(ctx context.Context, key, localPath string, opts S3PutOptions) error {
	info, err := os.Stat(localPath)
	if err != nil {
		return fmt.Errorf("s3 PutObject %s: %w", key, err)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("s3 PutObject %s: %s is not a regular file", key, info.Name())
	}
	return c.putSource(ctx, key, info.Size(), func() (io.ReadCloser, error) { return os.Open(localPath) }, opts)
}

// putSource is PutObject past the file system: a body of a known size that can be
// opened again for each attempt.
func (c *S3Client) putSource(ctx context.Context, key string, size int64, open func() (io.ReadCloser, error), opts S3PutOptions) error {
	const op = "PutObject"
	if size > s3MaxSinglePutBytes {
		return fmt.Errorf("s3 %s %s: %d bytes: %w; split it or wait for multipart upload", op, key, size, ErrS3TooLarge)
	}
	hash, err := hashReader(open, size)
	if err != nil {
		return fmt.Errorf("s3 %s %s: %w", op, key, err)
	}
	headers := map[string]string{"content-type": s3ContentType(key)}
	if opts.IfNoneMatch {
		headers["if-none-match"] = "*"
	}
	resp, err := c.roundTrip(ctx, s3Call{
		op: op, method: http.MethodPut, key: key, headers: headers,
		payloadHash: hash, size: size, body: open,
	})
	if err != nil {
		return err
	}
	if resp.StatusCode/100 != 2 {
		return c.responseError(op, key, resp)
	}
	_, _ = io.Copy(io.Discard, resp.Body) //nolint:errcheck // draining a finished response so the connection is reused
	return resp.Body.Close()
}

func hashReader(open func() (io.ReadCloser, error), size int64) (string, error) {
	r, err := open()
	if err != nil {
		return "", err
	}
	defer func() { _ = r.Close() }()
	h := sha256.New()
	n, err := io.Copy(h, io.LimitReader(r, size))
	if err != nil {
		return "", err
	}
	if n != size {
		return "", fmt.Errorf("file changed while it was read: expected %d bytes, read %d", size, n)
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// s3ContentType picks the Content-Type from the key's extension. R2 serves an
// object stored without one as a download, so the snapshot's page needs html.
func s3ContentType(key string) string {
	switch strings.ToLower(path.Ext(key)) {
	case ".json":
		return "application/json"
	case ".html":
		return "text/html; charset=utf-8"
	default:
		return "application/octet-stream"
	}
}

// PutObjectBytes uploads data as key in one PUT, for the small documents a
// caller builds in memory (an index, a page, a pointer file). It is PutObject
// without the file: the same checksum, content type and size limit.
func (c *S3Client) PutObjectBytes(ctx context.Context, key string, data []byte, opts S3PutOptions) error {
	return c.putSource(ctx, key, int64(len(data)), bytesBody(data), opts)
}

// bytesBody opens data afresh for each attempt.
func bytesBody(data []byte) func() (io.ReadCloser, error) {
	return func() (io.ReadCloser, error) { return io.NopCloser(bytes.NewReader(data)), nil }
}

// ObjectURL is the address of key on the endpoint, path-style like every request
// this client makes. It carries no credential: it names the object and nothing
// more, and so only opens for a bucket that serves objects publicly.
func (c *S3Client) ObjectURL(key string) string {
	u := *c.base
	u.Path = "/" + c.cfg.Bucket + "/" + key
	u.RawPath = s3URIEncode(u.Path, false)
	return u.String()
}

// --- multipart assembly ---
//
// These four calls exist to build one big object out of objects already in the
// bucket (UploadPartCopy), so no data leaves the machine for it. They are not a
// multipart upload of local bytes, which this client still does not do.

// s3MaxMultipartParts is S3's limit on the parts of one multipart upload.
const s3MaxMultipartParts = 10000

// CreateMultipartUpload starts a multipart upload of key and returns its id. The
// object's Content-Type is set here, from the key, as PutObject sets it.
func (c *S3Client) CreateMultipartUpload(ctx context.Context, key string) (string, error) {
	const op = "CreateMultipartUpload"
	resp, err := c.roundTrip(ctx, s3Call{
		op: op, method: http.MethodPost, key: key, query: url.Values{"uploads": {""}},
		headers: map[string]string{"content-type": s3ContentType(key)}, payloadHash: s3EmptyHash,
	})
	if err != nil {
		return "", err
	}
	var out struct {
		UploadID string `xml:"UploadId"`
	}
	if err := c.decodeXMLResult(op, key, resp, &out); err != nil {
		return "", err
	}
	if out.UploadID == "" {
		return "", &S3Error{Op: op, Key: key, Status: resp.StatusCode, Message: "response names no upload id"}
	}
	return out.UploadID, nil
}

// UploadPartCopy adds part number partNumber (from 1) to an upload, copying it
// from sourceKey in the same bucket: the whole object, or byteRange (first and
// last byte, inclusive) of it. It returns the part's ETag for the final
// CompleteMultipartUpload. No data bytes are in the request.
func (c *S3Client) UploadPartCopy(ctx context.Context, key, uploadID string, partNumber int, sourceKey string, byteRange *[2]int64) (string, error) {
	const op = "UploadPartCopy"
	if partNumber < 1 || partNumber > s3MaxMultipartParts {
		return "", fmt.Errorf("s3 %s %s: part number %d is outside 1 to %d", op, key, partNumber, s3MaxMultipartParts)
	}
	headers := map[string]string{"x-amz-copy-source": "/" + c.cfg.Bucket + "/" + s3URIEncode(sourceKey, false)}
	if byteRange != nil {
		if byteRange[0] < 0 || byteRange[1] < byteRange[0] {
			return "", fmt.Errorf("s3 %s %s: byte range %d-%d is not valid", op, key, byteRange[0], byteRange[1])
		}
		headers["x-amz-copy-source-range"] = fmt.Sprintf("bytes=%d-%d", byteRange[0], byteRange[1])
	}
	resp, err := c.roundTrip(ctx, s3Call{
		op: op, method: http.MethodPut, key: key, headers: headers, payloadHash: s3EmptyHash,
		query: url.Values{"partNumber": {strconv.Itoa(partNumber)}, "uploadId": {uploadID}},
	})
	if err != nil {
		return "", err
	}
	var out struct {
		ETag string `xml:"ETag"`
	}
	if err := c.decodeXMLResult(op, key, resp, &out); err != nil {
		return "", err
	}
	etag := strings.Trim(strings.TrimSpace(out.ETag), `"`)
	if etag == "" {
		return "", &S3Error{Op: op, Key: key, Status: resp.StatusCode, Message: "response names no ETag"}
	}
	return etag, nil
}

type s3CompletePart struct {
	PartNumber int    `xml:"PartNumber"`
	ETag       string `xml:"ETag"`
}

type s3CompleteBody struct {
	XMLName xml.Name         `xml:"CompleteMultipartUpload"`
	Parts   []s3CompletePart `xml:"Part"`
}

// CompleteMultipartUpload finishes an upload from the ETags UploadPartCopy
// returned, in part order: etags[0] is part 1. The request body is the list of
// parts and their ETags, never object data.
func (c *S3Client) CompleteMultipartUpload(ctx context.Context, key, uploadID string, etags []string) error {
	const op = "CompleteMultipartUpload"
	if len(etags) == 0 || len(etags) > s3MaxMultipartParts {
		return fmt.Errorf("s3 %s %s: %d parts is outside 1 to %d", op, key, len(etags), s3MaxMultipartParts)
	}
	doc := s3CompleteBody{Parts: make([]s3CompletePart, len(etags))}
	for i, etag := range etags {
		doc.Parts[i] = s3CompletePart{PartNumber: i + 1, ETag: `"` + strings.Trim(etag, `"`) + `"`}
	}
	body, err := xml.Marshal(doc)
	if err != nil {
		return fmt.Errorf("s3 %s %s: %w", op, key, err)
	}
	sum := sha256.Sum256(body)
	resp, err := c.roundTrip(ctx, s3Call{
		op: op, method: http.MethodPost, key: key, query: url.Values{"uploadId": {uploadID}},
		headers:     map[string]string{"content-type": "application/xml"},
		payloadHash: hex.EncodeToString(sum[:]), size: int64(len(body)), body: bytesBody(body),
	})
	if err != nil {
		return err
	}
	return c.decodeXMLResult(op, key, resp, nil)
}

// AbortMultipartUpload discards an upload and the parts it holds, so nothing
// half built is kept or billed. An upload that is already gone is not an error.
func (c *S3Client) AbortMultipartUpload(ctx context.Context, key, uploadID string) error {
	const op = "AbortMultipartUpload"
	resp, err := c.roundTrip(ctx, s3Call{
		op: op, method: http.MethodDelete, key: key, query: url.Values{"uploadId": {uploadID}}, payloadHash: s3EmptyHash,
	})
	if err != nil {
		return err
	}
	if resp.StatusCode/100 != 2 && resp.StatusCode != http.StatusNotFound {
		return c.responseError(op, key, resp)
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, s3ErrorBodyLimit)) //nolint:errcheck // draining a finished response so the connection is reused
	return resp.Body.Close()
}

// --- listing and deleting ---

// ListObjects returns every object whose key starts with prefix, in the order S3
// lists them (by key). It follows the continuation token until S3 says the
// listing is complete, so a bucket of any size is read in full; a listing that
// claims more to come without saying where is an error, never a short answer
// taken for a whole one.
func (c *S3Client) ListObjects(ctx context.Context, prefix string) ([]S3ListedObject, error) {
	const op = "ListObjects"
	var out []S3ListedObject
	token := ""
	for {
		q := url.Values{"list-type": {"2"}, "prefix": {prefix}}
		if token != "" {
			q.Set("continuation-token", token)
		}
		resp, err := c.roundTrip(ctx, s3Call{op: op, method: http.MethodGet, query: q, payloadHash: s3EmptyHash})
		if err != nil {
			return nil, err
		}
		var page struct {
			IsTruncated           bool   `xml:"IsTruncated"`
			NextContinuationToken string `xml:"NextContinuationToken"`
			Contents              []struct {
				Key  string `xml:"Key"`
				Size int64  `xml:"Size"`
			} `xml:"Contents"`
		}
		if err := c.decodeXMLResultLimit(op, prefix, resp, &page, s3ListBodyLimit); err != nil {
			return nil, err
		}
		for _, o := range page.Contents {
			out = append(out, S3ListedObject{Key: o.Key, Size: o.Size})
		}
		if !page.IsTruncated {
			return out, nil
		}
		if page.NextContinuationToken == "" || page.NextContinuationToken == token {
			return nil, &S3Error{Op: op, Key: prefix, Status: resp.StatusCode, Message: "listing is truncated but names no next page"}
		}
		token = page.NextContinuationToken
	}
}

type s3DeleteObject struct {
	Key string `xml:"Key"`
}

type s3DeleteBody struct {
	XMLName xml.Name         `xml:"Delete"`
	Quiet   bool             `xml:"Quiet"`
	Objects []s3DeleteObject `xml:"Object"`
}

// DeleteObjects deletes keys with multi-object delete, at most 1000 to a request
// (a longer list is sent as several). A key that does not exist is not an error.
// The requests carry Content-MD5, which S3 and R2 require on this call, and ask
// for Quiet mode, so the response lists only what failed. A request that is
// refused outright ends the call at once; keys S3 reports as failed within a
// request that succeeded are counted across all the requests and reported as one
// error at the end, so one stuck key does not stop the others being deleted.
func (c *S3Client) DeleteObjects(ctx context.Context, keys []string) error {
	const op = "DeleteObjects"
	for _, k := range keys {
		// encoding/xml would turn a control character into U+FFFD, so the key
		// that went out would not be the key meant. Refuse it instead.
		if k == "" || !utf8.ValidString(k) || strings.ContainsFunc(k, unicode.IsControl) {
			return fmt.Errorf("s3 %s: %q is not a key that can be sent in a delete request", op, k)
		}
	}
	var failed int
	var first string
	for start := 0; start < len(keys); start += s3MaxDeleteKeys {
		chunk := keys[start:min(start+s3MaxDeleteKeys, len(keys))]
		n, firstErr, err := c.deleteChunk(ctx, chunk)
		if err != nil {
			return err
		}
		if failed == 0 {
			first = firstErr
		}
		failed += n
	}
	if failed > 0 {
		return &S3Error{Op: op, Message: fmt.Sprintf("%d of %d key(s) could not be deleted (first: %s)", failed, len(keys), first)}
	}
	return nil
}

// deleteChunk sends one DeleteObjects request and returns how many keys the
// response reports as failed, with the first of them described.
func (c *S3Client) deleteChunk(ctx context.Context, keys []string) (failed int, first string, err error) {
	const op = "DeleteObjects"
	doc := s3DeleteBody{Quiet: true, Objects: make([]s3DeleteObject, len(keys))}
	for i, k := range keys {
		doc.Objects[i] = s3DeleteObject{Key: k}
	}
	body, err := xml.Marshal(doc)
	if err != nil {
		return 0, "", fmt.Errorf("s3 %s: %w", op, err)
	}
	sha := sha256.Sum256(body)
	sum := md5.Sum(body) //nolint:gosec // see the import
	resp, err := c.roundTrip(ctx, s3Call{
		op: op, method: http.MethodPost, query: url.Values{"delete": {""}},
		headers: map[string]string{
			"content-type": "application/xml",
			"content-md5":  base64.StdEncoding.EncodeToString(sum[:]),
		},
		payloadHash: hex.EncodeToString(sha[:]), size: int64(len(body)), body: bytesBody(body),
	})
	if err != nil {
		return 0, "", err
	}
	var out struct {
		Errors []struct {
			Key     string `xml:"Key"`
			Code    string `xml:"Code"`
			Message string `xml:"Message"`
		} `xml:"Error"`
	}
	if err := c.decodeXMLResultLimit(op, "", resp, &out, s3ListBodyLimit); err != nil {
		return 0, "", err
	}
	if len(out.Errors) > 0 {
		e := out.Errors[0]
		first = fmt.Sprintf("%s: %s", c.scrub(e.Key), c.scrub(e.Code))
	}
	return len(out.Errors), first, nil
}

// decodeXMLResult reads a response whose body is an XML document into out (nil to
// ignore it), closing resp. A non-2xx status is an error, and so is a 2xx whose
// body is an Error document: S3 starts answering a copy or a complete before the
// work is done, and reports a late failure inside the body of a 200.
func (c *S3Client) decodeXMLResult(op, key string, resp *http.Response, out any) error {
	return c.decodeXMLResultLimit(op, key, resp, out, s3ErrorBodyLimit)
}

// decodeXMLResultLimit is decodeXMLResult for a body that may be larger than a
// small answer, a page of a listing. A body over limit is an error: a document
// cut short would not parse, and one that did parse would be missing entries.
func (c *S3Client) decodeXMLResultLimit(op, key string, resp *http.Response, out any, limit int64) error {
	if resp.StatusCode/100 != 2 {
		return c.responseError(op, key, resp)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return c.transportError(op, key, err)
	}
	if int64(len(body)) > limit {
		return &S3Error{Op: op, Key: key, Status: resp.StatusCode, Message: fmt.Sprintf("response is over the %s this client reads", fmtBytes(limit))}
	}
	var probe struct {
		XMLName xml.Name
		Code    string `xml:"Code"`
		Message string `xml:"Message"`
	}
	if xml.Unmarshal(body, &probe) == nil && probe.XMLName.Local == "Error" {
		return &S3Error{Op: op, Key: key, Status: resp.StatusCode, Code: c.scrub(probe.Code), Message: c.scrub(probe.Message)}
	}
	if out == nil {
		return nil
	}
	if err := xml.Unmarshal(body, out); err != nil {
		return &S3Error{Op: op, Key: key, Status: resp.StatusCode, Message: "response is not the XML document expected"}
	}
	return nil
}

// --- transport ---

// s3Call is one signed request. body, when set, yields the request body afresh
// for each attempt and is exactly size bytes long.
type s3Call struct {
	op          string
	method      string
	key         string // empty for a bucket-level call
	query       url.Values
	headers     map[string]string // lowercase names, signed along with the standard ones
	payloadHash string            // hex SHA-256 of the body, or s3EmptyHash
	size        int64
	body        func() (io.ReadCloser, error)
}

// roundTrip sends call with the retry policy: a 5xx or a timeout is retried with
// exponential backoff, a 4xx never is. It returns the response for any status
// below 500, which the caller closes and judges; a 5xx that outlasts the attempts
// comes back as an *S3Error.
func (c *S3Client) roundTrip(ctx context.Context, call s3Call) (*http.Response, error) {
	delay := c.backoff
	for attempt := 1; ; attempt++ {
		resp, err := c.attempt(ctx, call)
		var retry string
		switch {
		case err != nil:
			if ctx.Err() != nil || !isTimeout(err) {
				return nil, c.transportError(call.op, call.key, err)
			}
			retry = "timeout"
			if attempt == s3MaxAttempts {
				return nil, c.transportError(call.op, call.key, err)
			}
		case resp.StatusCode >= 500:
			retry = fmt.Sprintf("status %d", resp.StatusCode)
			if attempt == s3MaxAttempts {
				return nil, c.responseError(call.op, call.key, resp)
			}
			_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, s3ErrorBodyLimit)) //nolint:errcheck // draining a response being discarded
			_ = resp.Body.Close()
		default:
			return resp, nil
		}
		slog.Warn("s3: retrying", "op", call.op, "key", call.key, "attempt", attempt, "reason", retry)
		if err := sleepCtx(ctx, delay); err != nil {
			return nil, c.transportError(call.op, call.key, err)
		}
		delay *= 2
	}
}

func isTimeout(err error) bool {
	var ne net.Error
	return errors.As(err, &ne) && ne.Timeout()
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// attempt builds, signs and sends the request once.
func (c *S3Client) attempt(ctx context.Context, call s3Call) (*http.Response, error) {
	u := *c.base
	u.Path = "/" + c.cfg.Bucket
	if call.key != "" {
		u.Path += "/" + call.key
	}
	u.RawPath = s3URIEncode(u.Path, false)
	u.RawQuery = s3CanonicalQuery(call.query)

	var body io.ReadCloser = http.NoBody
	if call.body != nil && call.size > 0 {
		f, err := call.body()
		if err != nil {
			return nil, err
		}
		body = limitedBody{Reader: io.LimitReader(f, call.size), Closer: f}
	}
	req, err := http.NewRequestWithContext(ctx, call.method, u.String(), body)
	if err != nil {
		_ = body.Close()
		return nil, err
	}
	req.ContentLength = call.size
	for k, v := range call.headers {
		req.Header.Set(k, v)
	}
	c.sign(req, call.payloadHash)
	return c.http.Do(req)
}

type limitedBody struct {
	io.Reader
	io.Closer
}

// sign adds x-amz-date, x-amz-content-sha256 and Authorization to req. The signed
// headers are host, those two and whatever else the call set.
func (c *S3Client) sign(req *http.Request, payloadHash string) {
	now := c.now().UTC()
	req.Header.Set("X-Amz-Date", now.Format(s3AmzDate))
	req.Header.Set("X-Amz-Content-Sha256", payloadHash)
	headers := map[string]string{"host": req.URL.Host}
	for k, v := range req.Header {
		headers[strings.ToLower(k)] = strings.Join(v, ",")
	}
	req.Header.Set("Authorization", s3Authorization(c.cfg, now, s3Signable{req.Method, req.URL.Path, req.URL.Query(), headers, payloadHash}))
}

// --- signing (AWS Signature Version 4) ---
//
// Each step is its own function so the AWS test vectors can pin it separately.
// The algorithm is as documented at
// https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html

// s3EmptyHash is the SHA-256 of an empty body.
const s3EmptyHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

// s3URIEncode percent-encodes everything but A-Z a-z 0-9 - . _ ~ with uppercase
// hex, and leaves "/" alone when encodeSlash is false (an object key's separators).
func s3URIEncode(s string, encodeSlash bool) string {
	const hexDigits = "0123456789ABCDEF"
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		ch := s[i]
		switch {
		case ch >= 'A' && ch <= 'Z', ch >= 'a' && ch <= 'z', ch >= '0' && ch <= '9',
			ch == '-', ch == '.', ch == '_', ch == '~':
			b.WriteByte(ch)
		case ch == '/' && !encodeSlash:
			b.WriteByte(ch)
		default:
			b.WriteByte('%')
			b.WriteByte(hexDigits[ch>>4])
			b.WriteByte(hexDigits[ch&15])
		}
	}
	return b.String()
}

// s3CanonicalQuery encodes names and values, then sorts the pairs by encoded name
// (and value). A bare subresource such as ?lifecycle becomes lifecycle=.
func s3CanonicalQuery(q url.Values) string {
	pairs := make([]string, 0, len(q))
	for k, vs := range q {
		for _, v := range vs {
			pairs = append(pairs, s3URIEncode(k, true)+"="+s3URIEncode(v, true))
		}
	}
	sort.Strings(pairs)
	return strings.Join(pairs, "&")
}

// s3CanonicalRequest builds the canonical request and the signed-headers list.
// headers are lowercase names; the path is the unencoded object path.
func s3CanonicalRequest(method, urlPath string, query url.Values, headers map[string]string, payloadHash string) (canonical, signedHeaders string) {
	names := make([]string, 0, len(headers))
	for k := range headers {
		names = append(names, k)
	}
	sort.Strings(names)
	var hb strings.Builder
	for _, k := range names {
		hb.WriteString(k + ":" + strings.Join(strings.Fields(headers[k]), " ") + "\n")
	}
	signedHeaders = strings.Join(names, ";")
	canonical = strings.Join([]string{
		method,
		s3URIEncode(urlPath, false),
		s3CanonicalQuery(query),
		hb.String(), // ends with a newline, which makes the blank line
		signedHeaders,
		payloadHash,
	}, "\n")
	return canonical, signedHeaders
}

func s3Scope(t time.Time, region string) string {
	return t.UTC().Format(s3ScopeDate) + "/" + region + "/" + s3Service + "/aws4_request"
}

func s3StringToSign(t time.Time, scope, canonicalRequest string) string {
	sum := sha256.Sum256([]byte(canonicalRequest))
	return s3Algorithm + "\n" + t.UTC().Format(s3AmzDate) + "\n" + scope + "\n" + hex.EncodeToString(sum[:])
}

func hmacSHA256(key []byte, msg string) []byte {
	m := hmac.New(sha256.New, key)
	m.Write([]byte(msg)) //nolint:errcheck // hash.Hash.Write never returns an error
	return m.Sum(nil)
}

func s3SigningKey(secret string, t time.Time, region string) []byte {
	k := hmacSHA256([]byte("AWS4"+secret), t.UTC().Format(s3ScopeDate))
	k = hmacSHA256(k, region)
	k = hmacSHA256(k, s3Service)
	return hmacSHA256(k, "aws4_request")
}

func s3Signature(signingKey []byte, stringToSign string) string {
	return hex.EncodeToString(hmacSHA256(signingKey, stringToSign))
}

// s3Signable is the part of a request the signature covers: the unencoded path,
// the query, the lowercase-named headers to sign and the payload hash.
type s3Signable struct {
	method      string
	path        string
	query       url.Values
	headers     map[string]string
	payloadHash string
}

// s3Authorization returns the Authorization header value for a request.
func s3Authorization(cfg S3Config, t time.Time, r s3Signable) string {
	canonical, signed := s3CanonicalRequest(r.method, r.path, r.query, r.headers, r.payloadHash)
	scope := s3Scope(t, cfg.Region)
	sig := s3Signature(s3SigningKey(cfg.SecretAccessKey, t, cfg.Region), s3StringToSign(t, scope, canonical))
	return s3Algorithm + " Credential=" + cfg.AccessKeyID + "/" + scope + ",SignedHeaders=" + signed + ",Signature=" + sig
}
