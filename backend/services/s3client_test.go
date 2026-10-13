package services

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// --- the signer against AWS's published vectors ---

type awsVector struct {
	Name             string              `json:"name"`
	Source           string              `json:"source"`
	Method           string              `json:"method"`
	Path             string              `json:"path"`
	Query            map[string][]string `json:"query"`
	Headers          map[string]string   `json:"headers"`
	Body             *string             `json:"body"`
	PayloadHash      string              `json:"payloadHash"`
	CanonicalRequest []string            `json:"canonicalRequest"`
	StringToSignHash string              `json:"stringToSignHash"`
	Signature        string              `json:"signature"`
	Authorization    string              `json:"authorization"`
}

type awsVectorFile struct {
	Credentials struct {
		AccessKeyID     string `json:"accessKeyId"`
		SecretAccessKey string `json:"secretAccessKey"`
		Region          string `json:"region"`
		AmzDate         string `json:"amzDate"`
	} `json:"credentials"`
	Vectors []awsVector `json:"vectors"`
}

// testdata/aws-sigv4-vectors.json holds the worked examples from
// https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
func TestS3SignerReproducesAWSVectors(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "aws-sigv4-vectors.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f awsVectorFile
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	if len(f.Vectors) < 4 {
		t.Fatalf("expected the four AWS examples, got %d", len(f.Vectors))
	}
	at, err := time.Parse(s3AmzDate, f.Credentials.AmzDate)
	if err != nil {
		t.Fatal(err)
	}
	cfg := S3Config{Region: f.Credentials.Region, AccessKeyID: f.Credentials.AccessKeyID, SecretAccessKey: f.Credentials.SecretAccessKey}

	for _, v := range f.Vectors {
		t.Run(v.Name, func(t *testing.T) {
			if v.Body != nil {
				sum := sha256.Sum256([]byte(*v.Body))
				if got := hex.EncodeToString(sum[:]); got != v.PayloadHash {
					t.Fatalf("payload hash = %s, want %s", got, v.PayloadHash)
				}
			}
			canonical, signed := s3CanonicalRequest(v.Method, v.Path, url.Values(v.Query), v.Headers, v.PayloadHash)
			if want := strings.Join(v.CanonicalRequest, "\n"); canonical != want {
				t.Errorf("canonical request:\n%s\nwant:\n%s", canonical, want)
			}

			scope := s3Scope(at, cfg.Region)
			if scope != "20130524/us-east-1/s3/aws4_request" {
				t.Errorf("scope = %s", scope)
			}
			sts := s3StringToSign(at, scope, canonical)
			wantSTS := "AWS4-HMAC-SHA256\n20130524T000000Z\n20130524/us-east-1/s3/aws4_request\n" + v.StringToSignHash
			if sts != wantSTS {
				t.Errorf("string to sign:\n%s\nwant:\n%s", sts, wantSTS)
			}

			if got := s3Signature(s3SigningKey(cfg.SecretAccessKey, at, cfg.Region), sts); got != v.Signature {
				t.Errorf("signature = %s, want %s", got, v.Signature)
			}
			if got := s3Authorization(cfg, at, s3Signable{v.Method, v.Path, url.Values(v.Query), v.Headers, v.PayloadHash}); got != v.Authorization {
				t.Errorf("authorization = %s\nwant %s", got, v.Authorization)
			}
			if !strings.Contains(v.Authorization, "SignedHeaders="+signed+",") {
				t.Errorf("signed headers %q not in %s", signed, v.Authorization)
			}
		})
	}
}

func TestS3URIEncode(t *testing.T) {
	cases := []struct {
		in          string
		encodeSlash bool
		want        string
	}{
		{"photos/2013 06/a+b.jpg", false, "photos/2013%2006/a%2Bb.jpg"},
		{"photos/a", true, "photos%2Fa"},
		{"AZaz09-._~", true, "AZaz09-._~"},
		{"test$file.text", false, "test%24file.text"},
		{"é", false, "%C3%A9"},
	}
	for _, c := range cases {
		if got := s3URIEncode(c.in, c.encodeSlash); got != c.want {
			t.Errorf("s3URIEncode(%q, %v) = %q, want %q", c.in, c.encodeSlash, got, c.want)
		}
	}
}

func TestS3ContentType(t *testing.T) {
	cases := map[string]string{
		"index.json":             "application/json",
		"INDEX.JSON":             "application/json",
		"a/b/page.html":          "text/html; charset=utf-8",
		"DistantHorizons.sqlite": "application/octet-stream",
		"parts/0123abcd":         "application/octet-stream",
		"backup.zip":             "application/octet-stream",
	}
	for key, want := range cases {
		if got := s3ContentType(key); got != want {
			t.Errorf("s3ContentType(%q) = %q, want %q", key, got, want)
		}
	}
}

func TestNewS3ClientValidates(t *testing.T) {
	ok := S3Config{Endpoint: "https://acct.r2.cloudflarestorage.com", Region: "auto", Bucket: "b", AccessKeyID: "id", SecretAccessKey: "s"}
	if _, err := NewS3Client(ok, nil); err != nil {
		t.Fatalf("valid config rejected: %v", err)
	}
	bare := ok
	bare.Endpoint = "acct.r2.cloudflarestorage.com/"
	c, err := NewS3Client(bare, nil)
	if err != nil || c.base.String() != "https://acct.r2.cloudflarestorage.com" {
		t.Fatalf("bare host: %v %v", c, err)
	}
	mutations := map[string]func(*S3Config){
		"no endpoint":  func(c *S3Config) { c.Endpoint = "" },
		"no region":    func(c *S3Config) { c.Region = "" },
		"no bucket":    func(c *S3Config) { c.Bucket = "" },
		"no key id":    func(c *S3Config) { c.AccessKeyID = "" },
		"no secret":    func(c *S3Config) { c.SecretAccessKey = "" },
		"ftp":          func(c *S3Config) { c.Endpoint = "ftp://x.example" },
		"path":         func(c *S3Config) { c.Endpoint = "https://x.example/bucket" },
		"credentials":  func(c *S3Config) { c.Endpoint = "https://u:p@x.example" },
		"slash bucket": func(c *S3Config) { c.Bucket = "a/b" },
		"no host":      func(c *S3Config) { c.Endpoint = "https://" },
	}
	for name, mutate := range mutations {
		cfg := ok
		mutate(&cfg)
		if _, err := NewS3Client(cfg, nil); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}

// --- the client against an httptest server ---

const testSecret = "SECRET-d34db33f-do-not-leak"

// recordedRequest is what the server saw, kept whole so a test can search it.
type recordedRequest struct {
	Method, RequestURI, Host string
	Header                   http.Header
	Body                     []byte
}

type s3TestServer struct {
	*httptest.Server
	mu   sync.Mutex
	reqs []recordedRequest
}

func (s *s3TestServer) recorded() []recordedRequest {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]recordedRequest(nil), s.reqs...)
}

func newS3TestServer(t *testing.T, handler func(n int, w http.ResponseWriter, r *http.Request)) *s3TestServer {
	t.Helper()
	s := &s3TestServer{}
	s.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("server read body: %v", err)
		}
		s.mu.Lock()
		s.reqs = append(s.reqs, recordedRequest{r.Method, r.RequestURI, r.Host, r.Header.Clone(), body})
		n := len(s.reqs)
		s.mu.Unlock()
		handler(n, w, r)
	}))
	t.Cleanup(s.Close)
	return s
}

func newTestS3Client(t *testing.T, s *s3TestServer) *S3Client {
	t.Helper()
	c, err := NewS3Client(S3Config{
		Endpoint: s.URL, Region: "auto", Bucket: "snapshots",
		AccessKeyID: "AKIATESTKEY", SecretAccessKey: testSecret,
	}, s.Client())
	if err != nil {
		t.Fatal(err)
	}
	c.backoff = time.Millisecond
	return c
}

func s3XMLError(w http.ResponseWriter, status int, code, msg string) {
	w.WriteHeader(status)
	fmt.Fprintf(w, `<?xml version="1.0" encoding="UTF-8"?><Error><Code>%s</Code><Message>%s</Message></Error>`, code, msg)
}

func writeTemp(t *testing.T, name string, data []byte) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(p, data, 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestS3HeadObjectFound(t *testing.T) {
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("ETag", `"abc123"`)
		w.Header().Set("Content-Length", "4096")
	})
	c := newTestS3Client(t, s)
	info, found, err := c.HeadObject(context.Background(), "parts/ab12")
	if err != nil || !found {
		t.Fatalf("found=%v err=%v", found, err)
	}
	if info.Size != 4096 || info.ETag != "abc123" {
		t.Errorf("info = %+v", info)
	}
	r := s.recorded()[0]
	if r.Method != http.MethodHead || r.RequestURI != "/snapshots/parts/ab12" {
		t.Errorf("request = %s %s", r.Method, r.RequestURI)
	}
	if got := r.Header.Get("X-Amz-Content-Sha256"); got != s3EmptyHash {
		t.Errorf("x-amz-content-sha256 = %q", got)
	}
	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "AWS4-HMAC-SHA256 Credential=AKIATESTKEY/") || !strings.Contains(auth, "/auto/s3/aws4_request,SignedHeaders=host;x-amz-content-sha256;x-amz-date,Signature=") {
		t.Errorf("authorization = %q", auth)
	}
}

func TestS3HeadObjectNotFound(t *testing.T) {
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNotFound) })
	_, found, err := newTestS3Client(t, s).HeadObject(context.Background(), "missing")
	if err != nil || found {
		t.Fatalf("found=%v err=%v", found, err)
	}
	if n := len(s.recorded()); n != 1 {
		t.Errorf("a 404 was retried: %d requests", n)
	}
}

func TestS3HeadObjectErrorStatus(t *testing.T) {
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusForbidden) })
	_, _, err := newTestS3Client(t, s).HeadObject(context.Background(), "k")
	var se *S3Error
	if !errors.As(err, &se) || se.Status != 403 || se.Code != "Forbidden" {
		t.Fatalf("err = %v", err)
	}
}

func TestS3PutObjectStreamsFileWithHeaders(t *testing.T) {
	body := bytes.Repeat([]byte("kapital"), 100_000) // 700 kB
	path := writeTemp(t, "ignored-name.bin", body)
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	c := newTestS3Client(t, s)

	cases := []struct{ key, contentType string }{
		{"parts/9f86d081", "application/octet-stream"},
		{"index.json", "application/json"},
		{"snapshot/index.html", "text/html; charset=utf-8"},
		{"DistantHorizons.sqlite", "application/octet-stream"},
	}
	for _, tc := range cases {
		if err := c.PutObject(context.Background(), tc.key, path, S3PutOptions{}); err != nil {
			t.Fatalf("%s: %v", tc.key, err)
		}
	}
	sum := sha256.Sum256(body)
	for i, tc := range cases {
		r := s.recorded()[i]
		if r.Method != http.MethodPut || r.RequestURI != "/snapshots/"+tc.key {
			t.Errorf("%s: request = %s %s", tc.key, r.Method, r.RequestURI)
		}
		if got := r.Header.Get("Content-Type"); got != tc.contentType {
			t.Errorf("%s: content-type = %q, want %q", tc.key, got, tc.contentType)
		}
		if got := r.Header.Get("Content-Length"); got != fmt.Sprint(len(body)) {
			t.Errorf("%s: content-length = %q", tc.key, got)
		}
		if got := r.Header.Get("X-Amz-Content-Sha256"); got != hex.EncodeToString(sum[:]) {
			t.Errorf("%s: x-amz-content-sha256 = %q", tc.key, got)
		}
		if !bytes.Equal(r.Body, body) {
			t.Errorf("%s: body of %d bytes differs from the file", tc.key, len(r.Body))
		}
		if r.Header.Get("If-None-Match") != "" {
			t.Errorf("%s: If-None-Match sent without being asked", tc.key)
		}
		if a := r.Header.Get("Authorization"); !strings.Contains(a, "SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date,") {
			t.Errorf("%s: authorization = %q", tc.key, a)
		}
	}
}

func TestS3PutObjectKeyIsEncodedOnTheWire(t *testing.T) {
	path := writeTemp(t, "f", []byte("x"))
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) {})
	c := newTestS3Client(t, s)
	if err := c.PutObject(context.Background(), "my world/a+b$c.json", path, S3PutOptions{}); err != nil {
		t.Fatal(err)
	}
	// The path the server receives is the one the signature covers.
	want := "/snapshots/my%20world/a%2Bb%24c.json"
	if got := s.recorded()[0].RequestURI; got != want {
		t.Errorf("request uri = %q, want %q", got, want)
	}
}

func TestS3PutObjectEmptyFile(t *testing.T) {
	path := writeTemp(t, "empty", nil)
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) {})
	if err := newTestS3Client(t, s).PutObject(context.Background(), "empty", path, S3PutOptions{}); err != nil {
		t.Fatal(err)
	}
	r := s.recorded()[0]
	if r.Header.Get("Content-Length") != "0" || r.Header.Get("X-Amz-Content-Sha256") != s3EmptyHash {
		t.Errorf("headers = %v", r.Header)
	}
}

func TestS3PutObjectIfNoneMatch(t *testing.T) {
	path := writeTemp(t, "part", []byte("data"))
	s := newS3TestServer(t, func(n int, w http.ResponseWriter, _ *http.Request) {
		if n == 1 {
			return
		}
		s3XMLError(w, http.StatusPreconditionFailed, "PreconditionFailed", "At least one of the pre-conditions you specified did not hold")
	})
	c := newTestS3Client(t, s)
	opts := S3PutOptions{IfNoneMatch: true}
	if err := c.PutObject(context.Background(), "parts/aa", path, opts); err != nil {
		t.Fatal(err)
	}
	err := c.PutObject(context.Background(), "parts/aa", path, opts)
	var se *S3Error
	if !errors.As(err, &se) || !se.PreconditionFailed() || se.Code != "PreconditionFailed" {
		t.Fatalf("second put: %v", err)
	}
	for i, r := range s.recorded() {
		if r.Header.Get("If-None-Match") != "*" {
			t.Errorf("request %d: If-None-Match = %q", i, r.Header.Get("If-None-Match"))
		}
		if !strings.Contains(r.Header.Get("Authorization"), "if-none-match") {
			t.Errorf("request %d: if-none-match is not signed", i)
		}
	}
	if n := len(s.recorded()); n != 2 {
		t.Errorf("a 412 was retried: %d requests", n)
	}
}

func TestS3PutObjectRetriesA5xxThenSucceeds(t *testing.T) {
	body := bytes.Repeat([]byte("retry"), 10_000)
	path := writeTemp(t, "f.bin", body)
	s := newS3TestServer(t, func(n int, w http.ResponseWriter, _ *http.Request) {
		if n < 3 {
			s3XMLError(w, http.StatusServiceUnavailable, "SlowDown", "Reduce your request rate")
		}
	})
	if err := newTestS3Client(t, s).PutObject(context.Background(), "k", path, S3PutOptions{}); err != nil {
		t.Fatal(err)
	}
	reqs := s.recorded()
	if len(reqs) != 3 {
		t.Fatalf("requests = %d, want 3", len(reqs))
	}
	for i, r := range reqs {
		if !bytes.Equal(r.Body, body) {
			t.Errorf("attempt %d sent %d bytes, want the whole file", i+1, len(r.Body))
		}
	}
}

func TestS3PutObjectGivesUpAfterTheAttempts(t *testing.T) {
	path := writeTemp(t, "f", []byte("x"))
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) {
		s3XMLError(w, http.StatusInternalServerError, "InternalError", "We encountered an internal error")
	})
	err := newTestS3Client(t, s).PutObject(context.Background(), "k", path, S3PutOptions{})
	var se *S3Error
	if !errors.As(err, &se) || se.Status != 500 || se.Code != "InternalError" {
		t.Fatalf("err = %v", err)
	}
	if n := len(s.recorded()); n != s3MaxAttempts {
		t.Errorf("requests = %d, want %d", n, s3MaxAttempts)
	}
}

func TestS3DoesNotRetryA4xx(t *testing.T) {
	path := writeTemp(t, "f", []byte("x"))
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) {
		s3XMLError(w, http.StatusForbidden, "AccessDenied", "Access Denied")
	})
	err := newTestS3Client(t, s).PutObject(context.Background(), "k", path, S3PutOptions{})
	var se *S3Error
	if !errors.As(err, &se) || se.Status != 403 || se.Code != "AccessDenied" || se.Message != "Access Denied" {
		t.Fatalf("err = %v", err)
	}
	if n := len(s.recorded()); n != 1 {
		t.Errorf("a 403 was retried: %d requests", n)
	}
}

func TestS3RetriesATimeout(t *testing.T) {
	path := writeTemp(t, "f", []byte("x"))
	release := make(chan struct{})
	s := newS3TestServer(t, func(n int, w http.ResponseWriter, r *http.Request) {
		if n == 1 {
			select {
			case <-release:
			case <-r.Context().Done():
			case <-time.After(5 * time.Second):
			}
		}
	})
	t.Cleanup(func() { close(release) })
	c := newTestS3Client(t, s)
	c.http = &http.Client{Timeout: 100 * time.Millisecond}
	if err := c.PutObject(context.Background(), "k", path, S3PutOptions{}); err != nil {
		t.Fatal(err)
	}
	if n := len(s.recorded()); n != 2 {
		t.Errorf("requests = %d, want 2", n)
	}
}

func TestS3RetriesAConnectionDroppedMidRequest(t *testing.T) {
	path := writeTemp(t, "f", []byte("x"))
	s := newS3TestServer(t, func(n int, w http.ResponseWriter, _ *http.Request) {
		if n == 1 {
			// What a reset or a corrupted TLS record looks like to the client:
			// the connection ends with no response.
			conn, _, err := http.NewResponseController(w).Hijack()
			if err != nil {
				t.Error(err)
				return
			}
			_ = conn.Close()
		}
	})
	if err := newTestS3Client(t, s).PutObject(context.Background(), "k", path, S3PutOptions{}); err != nil {
		t.Fatal(err)
	}
	if n := len(s.recorded()); n != 2 {
		t.Errorf("requests = %d, want 2", n)
	}
}

func TestS3DoesNotRetryAnUntrustedCertificate(t *testing.T) {
	path := writeTemp(t, "f", []byte("x"))
	var conns atomic.Int32
	ts := httptest.NewUnstartedServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	ts.Config.ConnState = func(_ net.Conn, st http.ConnState) {
		if st == http.StateNew {
			conns.Add(1)
		}
	}
	ts.Config.ErrorLog = log.New(io.Discard, "", 0) // the refused handshake
	ts.StartTLS()
	t.Cleanup(ts.Close)

	// The default client trusts the system roots, not the test certificate.
	c, err := NewS3Client(S3Config{
		Endpoint: ts.URL, Region: "auto", Bucket: "snapshots",
		AccessKeyID: "AKIATESTKEY", SecretAccessKey: testSecret,
	}, &http.Client{})
	if err != nil {
		t.Fatal(err)
	}
	c.backoff = time.Millisecond
	if err := c.PutObject(context.Background(), "k", path, S3PutOptions{}); err == nil {
		t.Fatal("PutObject trusted an unknown certificate")
	}
	if n := conns.Load(); n != 1 {
		t.Errorf("connections = %d, want 1", n)
	}
}

func TestS3CancelStopsRetrying(t *testing.T) {
	path := writeTemp(t, "f", []byte("x"))
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	})
	c := newTestS3Client(t, s)
	c.backoff = time.Hour
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()
	err := c.PutObject(ctx, "k", path, S3PutOptions{})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
}

func TestS3PutObjectRefusesOver5GiBBeforeAnyRequest(t *testing.T) {
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) {})
	c := newTestS3Client(t, s)
	opened := false
	open := func() (io.ReadCloser, error) { opened = true; return io.NopCloser(strings.NewReader("")), nil }

	err := c.putSource(context.Background(), "big.zip", s3MaxSinglePutBytes+1, open, S3PutOptions{})
	if !errors.Is(err, ErrS3TooLarge) {
		t.Fatalf("err = %v, want ErrS3TooLarge", err)
	}
	if !strings.Contains(err.Error(), "5 GiB") {
		t.Errorf("message does not say the limit: %v", err)
	}
	if opened || len(s.recorded()) != 0 {
		t.Errorf("opened=%v requests=%d, want neither", opened, len(s.recorded()))
	}
}

func TestS3PutObjectMissingFile(t *testing.T) {
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) {})
	c := newTestS3Client(t, s)
	if err := c.PutObject(context.Background(), "k", filepath.Join(t.TempDir(), "nope"), S3PutOptions{}); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("missing file: %v", err)
	}
	if err := c.PutObject(context.Background(), "k", t.TempDir(), S3PutOptions{}); err == nil || !strings.Contains(err.Error(), "not a regular file") {
		t.Errorf("directory: %v", err)
	}
	if n := len(s.recorded()); n != 0 {
		t.Errorf("requests = %d, want 0", n)
	}
}

func TestS3PutObjectFileChangedWhileHashing(t *testing.T) {
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) {})
	open := func() (io.ReadCloser, error) { return io.NopCloser(strings.NewReader("short")), nil }
	err := newTestS3Client(t, s).putSource(context.Background(), "k", 100, open, S3PutOptions{})
	if err == nil || !strings.Contains(err.Error(), "changed while it was read") {
		t.Errorf("err = %v", err)
	}
	if len(s.recorded()) != 0 {
		t.Error("a request went out for a file that changed")
	}
}

// --- redaction ---

type captureHandler struct {
	mu  sync.Mutex
	buf strings.Builder
}

func (h *captureHandler) Enabled(context.Context, slog.Level) bool { return true }
func (h *captureHandler) Handle(_ context.Context, r slog.Record) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.buf.WriteString(r.Message)
	r.Attrs(func(a slog.Attr) bool {
		fmt.Fprintf(&h.buf, " %s=%v", a.Key, a.Value.Resolve())
		return true
	})
	h.buf.WriteString("\n")
	return nil
}
func (h *captureHandler) WithAttrs([]slog.Attr) slog.Handler { return h }
func (h *captureHandler) WithGroup(string) slog.Handler      { return h }

func TestS3SecretNeverAppearsOutsideTheSignature(t *testing.T) {
	logs := &captureHandler{}
	prev := slog.Default()
	slog.SetDefault(slog.New(logs))
	t.Cleanup(func() { slog.SetDefault(prev) })

	path := writeTemp(t, "f", []byte("payload"))
	// An S3 that echoes the secret back in an error, to prove scrubbing as well as omission.
	s := newS3TestServer(t, func(n int, w http.ResponseWriter, _ *http.Request) {
		switch n {
		case 1, 2:
			s3XMLError(w, http.StatusBadGateway, "BadGateway", "upstream said "+testSecret)
		default:
			s3XMLError(w, http.StatusForbidden, "SignatureDoesNotMatch", "bad key "+testSecret)
		}
	})
	c := newTestS3Client(t, s)

	var errs []error
	errs = append(errs, c.PutObject(context.Background(), "k", path, S3PutOptions{}))
	_, _, headErr := c.HeadObject(context.Background(), "k")
	errs = append(errs, headErr)
	// A transport error: the server is gone.
	s.Close()
	errs = append(errs, c.PutObject(context.Background(), "k", path, S3PutOptions{}))

	for i, err := range errs {
		if err == nil {
			t.Fatalf("call %d succeeded", i)
		}
		if strings.Contains(err.Error(), testSecret) || strings.Contains(fmt.Sprintf("%+v %#v", err, err), testSecret) {
			t.Errorf("error %d leaks the secret: %v", i, err)
		}
		if strings.Contains(strings.ToLower(err.Error()), "authorization") || strings.Contains(err.Error(), "AWS4-HMAC") {
			t.Errorf("error %d leaks the Authorization header: %v", i, err)
		}
	}
	if !strings.Contains(errs[0].Error(), s3Redacted) {
		t.Errorf("the echoed secret was dropped silently rather than marked: %v", errs[0])
	}

	if out := logs.buf.String(); !strings.Contains(out, "s3: retrying") || strings.Contains(out, testSecret) {
		t.Errorf("log output (want a retry line and no secret):\n%s", out)
	}

	for i, r := range s.recorded() {
		var sb strings.Builder
		sb.WriteString(r.Method + " " + r.RequestURI + " " + r.Host + "\n")
		for k, vs := range r.Header {
			sb.WriteString(k + ": " + strings.Join(vs, ",") + "\n")
		}
		sb.Write(r.Body)
		if strings.Contains(sb.String(), testSecret) {
			t.Errorf("request %d carries the secret:\n%s", i, sb.String())
		}
	}
}

func TestS3ConfigPrintsRedacted(t *testing.T) {
	cfg := S3Config{Endpoint: "https://x.example", Region: "auto", Bucket: "b", AccessKeyID: "AKIA", SecretAccessKey: testSecret}
	c, err := NewS3Client(cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	var sb strings.Builder
	for _, v := range []any{cfg, &cfg, c} {
		fmt.Fprintf(&sb, "%v|%+v|%#v|%s\n", v, v, v, v)
	}
	h := &captureHandler{}
	slog.New(h).Info("cfg", "config", cfg)
	sb.WriteString(h.buf.String())

	if strings.Contains(sb.String(), testSecret) {
		t.Errorf("a printed config leaks the secret:\n%s", sb.String())
	}
	if !strings.Contains(sb.String(), "bucket=b") {
		t.Errorf("the redacted form dropped the other fields:\n%s", sb.String())
	}
}
