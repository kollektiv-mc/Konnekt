package services

import (
	"context"
	"encoding/xml"
	"errors"
	"net/http"
	"strings"
	"testing"
)

// --- multipart assembly and the calls beside it (#565) ---

func signedHeaders(t *testing.T, r recordedRequest) []string {
	t.Helper()
	auth := r.Header.Get("Authorization")
	_, rest, ok := strings.Cut(auth, "SignedHeaders=")
	if !ok {
		t.Fatalf("not a signed request: %q", auth)
	}
	list, _, _ := strings.Cut(rest, ",")
	return strings.Split(list, ";")
}

func contains(list []string, want string) bool {
	for _, s := range list {
		if s == want {
			return true
		}
	}
	return false
}

func TestS3CreateMultipartUpload(t *testing.T) {
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`<?xml version="1.0"?><InitiateMultipartUploadResult><Bucket>snapshots</Bucket><Key>a/b.sqlite</Key><UploadId>up-1</UploadId></InitiateMultipartUploadResult>`))
	})
	id, err := newTestS3Client(t, s).CreateMultipartUpload(context.Background(), "dh/a@@b/DistantHorizons.sqlite")
	if err != nil || id != "up-1" {
		t.Fatalf("id=%q err=%v", id, err)
	}
	r := s.recorded()[0]
	if r.Method != http.MethodPost || r.RequestURI != "/snapshots/dh/a%40%40b/DistantHorizons.sqlite?uploads=" {
		t.Errorf("request = %s %s", r.Method, r.RequestURI)
	}
	if len(r.Body) != 0 || r.Header.Get("X-Amz-Content-Sha256") != s3EmptyHash {
		t.Errorf("body %q, payload hash %q: starting an upload sends no data", r.Body, r.Header.Get("X-Amz-Content-Sha256"))
	}
	if got := r.Header.Get("Content-Type"); got != "application/octet-stream" {
		t.Errorf("content type = %q, want the key's type", got)
	}
}

func TestS3CreateMultipartUploadWithoutAnIdIsAnError(t *testing.T) {
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`<InitiateMultipartUploadResult></InitiateMultipartUploadResult>`))
	})
	if _, err := newTestS3Client(t, s).CreateMultipartUpload(context.Background(), "k"); err == nil {
		t.Fatal("a response with no upload id was accepted")
	}
}

func TestS3UploadPartCopySendsNoDataAndNamesTheSource(t *testing.T) {
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`<CopyPartResult><ETag>&quot;e-1&quot;</ETag><LastModified>2026-10-11T04:00:00Z</LastModified></CopyPartResult>`))
	})
	c := newTestS3Client(t, s)

	etag, err := c.UploadPartCopy(context.Background(), "dh/snap/db.sqlite", "up 1", 3, "dh/parts/ab cd", nil)
	if err != nil || etag != "e-1" {
		t.Fatalf("etag=%q err=%v", etag, err)
	}
	r := s.recorded()[0]
	if r.Method != http.MethodPut || r.RequestURI != "/snapshots/dh/snap/db.sqlite?partNumber=3&uploadId=up%201" {
		t.Errorf("request = %s %s", r.Method, r.RequestURI)
	}
	if got := r.Header.Get("X-Amz-Copy-Source"); got != "/snapshots/dh/parts/ab%20cd" {
		t.Errorf("x-amz-copy-source = %q, want /<bucket>/<encoded key>", got)
	}
	if got := r.Header.Get("X-Amz-Copy-Source-Range"); got != "" {
		t.Errorf("a whole-object copy sent the range %q", got)
	}
	if len(r.Body) != 0 {
		t.Errorf("body %q: a copy carries no data", r.Body)
	}
	signed := signedHeaders(t, r)
	if !contains(signed, "x-amz-copy-source") {
		t.Errorf("signed headers = %v: the copy source must be signed", signed)
	}

	if _, err := c.UploadPartCopy(context.Background(), "k", "u", 1, "src", &[2]int64{0, 1023}); err != nil {
		t.Fatal(err)
	}
	r = s.recorded()[1]
	if got := r.Header.Get("X-Amz-Copy-Source-Range"); got != "bytes=0-1023" {
		t.Errorf("range = %q", got)
	}
	if !contains(signedHeaders(t, r), "x-amz-copy-source-range") {
		t.Errorf("signed headers = %v: the range must be signed", signedHeaders(t, r))
	}
}

func TestS3UploadPartCopyRefusesWhatS3WouldBeforeAnyRequest(t *testing.T) {
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) {})
	c := newTestS3Client(t, s)
	for name, call := range map[string]func() error{
		"part zero":  func() error { _, err := c.UploadPartCopy(context.Background(), "k", "u", 0, "s", nil); return err },
		"part 10001": func() error { _, err := c.UploadPartCopy(context.Background(), "k", "u", 10001, "s", nil); return err },
		"a backwards": func() error {
			_, err := c.UploadPartCopy(context.Background(), "k", "u", 1, "s", &[2]int64{9, 3})
			return err
		},
		"a negative": func() error {
			_, err := c.UploadPartCopy(context.Background(), "k", "u", 1, "s", &[2]int64{-1, 3})
			return err
		},
	} {
		if err := call(); err == nil {
			t.Errorf("%s was accepted", name)
		}
	}
	if n := len(s.recorded()); n != 0 {
		t.Errorf("%d requests went out", n)
	}
}

// S3 starts answering a copy before the work is done, and reports a late failure
// as an Error document inside a 200.
func TestS3CopyAndCompleteTreatAnErrorBodyInA200AsAFailure(t *testing.T) {
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`<?xml version="1.0"?><Error><Code>InternalError</Code><Message>We encountered an internal error. Please try again. ` + testSecret + `</Message></Error>`))
	})
	c := newTestS3Client(t, s)
	_, err := c.UploadPartCopy(context.Background(), "k", "u", 1, "s", nil)
	var se *S3Error
	if !errors.As(err, &se) || se.Code != "InternalError" || se.Op != "UploadPartCopy" || strings.Contains(err.Error(), testSecret) {
		t.Fatalf("copy: err = %v", err)
	}
	err = c.CompleteMultipartUpload(context.Background(), "k", "u", []string{"e"})
	if !errors.As(err, &se) || se.Code != "InternalError" || se.Op != "CompleteMultipartUpload" || strings.Contains(err.Error(), testSecret) {
		t.Fatalf("complete: err = %v", err)
	}
}

func TestS3CompleteMultipartUploadSendsTheOrderedPartListAndNoData(t *testing.T) {
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`<CompleteMultipartUploadResult><Key>k</Key></CompleteMultipartUploadResult>`))
	})
	if err := newTestS3Client(t, s).CompleteMultipartUpload(context.Background(), "dh/db.sqlite", "up-9", []string{"aa", `"bb"`, "cc"}); err != nil {
		t.Fatal(err)
	}
	r := s.recorded()[0]
	if r.Method != http.MethodPost || r.RequestURI != "/snapshots/dh/db.sqlite?uploadId=up-9" {
		t.Errorf("request = %s %s", r.Method, r.RequestURI)
	}
	if got := r.Header.Get("Content-Type"); got != "application/xml" {
		t.Errorf("content type = %q", got)
	}
	var doc struct {
		Parts []struct {
			PartNumber int    `xml:"PartNumber"`
			ETag       string `xml:"ETag"`
		} `xml:"Part"`
	}
	if err := xml.Unmarshal(r.Body, &doc); err != nil {
		t.Fatalf("body %q: %v", r.Body, err)
	}
	if len(doc.Parts) != 3 {
		t.Fatalf("parts = %+v", doc.Parts)
	}
	for i, want := range []string{`"aa"`, `"bb"`, `"cc"`} {
		if doc.Parts[i].PartNumber != i+1 || doc.Parts[i].ETag != want {
			t.Errorf("part %d = %+v, want number %d etag %s", i, doc.Parts[i], i+1, want)
		}
	}
	if len(r.Body) > 400 {
		t.Errorf("the body is %d bytes: it is a list, not object data", len(r.Body))
	}
	if r.Header.Get("X-Amz-Content-Sha256") == s3EmptyHash || r.Header.Get("X-Amz-Content-Sha256") == "" {
		t.Errorf("the body's hash is not in the signature: %q", r.Header.Get("X-Amz-Content-Sha256"))
	}
}

func TestS3CompleteMultipartUploadRefusesNoPartsAndTooMany(t *testing.T) {
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) {})
	c := newTestS3Client(t, s)
	if err := c.CompleteMultipartUpload(context.Background(), "k", "u", nil); err == nil {
		t.Error("no parts was accepted")
	}
	if err := c.CompleteMultipartUpload(context.Background(), "k", "u", make([]string, s3MaxMultipartParts+1)); err == nil {
		t.Error("10001 parts was accepted")
	}
	if n := len(s.recorded()); n != 0 {
		t.Errorf("%d requests went out", n)
	}
}

func TestS3AbortMultipartUpload(t *testing.T) {
	status := http.StatusNoContent
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) {
		if status == http.StatusForbidden {
			s3XMLError(w, status, "AccessDenied", "no")
			return
		}
		w.WriteHeader(status)
	})
	c := newTestS3Client(t, s)
	if err := c.AbortMultipartUpload(context.Background(), "dh/db.sqlite", "up-9"); err != nil {
		t.Fatal(err)
	}
	r := s.recorded()[0]
	if r.Method != http.MethodDelete || r.RequestURI != "/snapshots/dh/db.sqlite?uploadId=up-9" {
		t.Errorf("request = %s %s", r.Method, r.RequestURI)
	}
	status = http.StatusNotFound
	if err := c.AbortMultipartUpload(context.Background(), "k", "gone"); err != nil {
		t.Errorf("an upload that is already gone is not a failure: %v", err)
	}
	status = http.StatusForbidden
	var se *S3Error
	if err := c.AbortMultipartUpload(context.Background(), "k", "u"); !errors.As(err, &se) || se.Code != "AccessDenied" {
		t.Errorf("err = %v", err)
	}
}

func TestS3MultipartCallsRetryA5xx(t *testing.T) {
	s := newS3TestServer(t, func(n int, w http.ResponseWriter, _ *http.Request) {
		if n < 3 {
			s3XMLError(w, http.StatusServiceUnavailable, "SlowDown", "Reduce your request rate")
			return
		}
		_, _ = w.Write([]byte(`<CompleteMultipartUploadResult></CompleteMultipartUploadResult>`))
	})
	if err := newTestS3Client(t, s).CompleteMultipartUpload(context.Background(), "k", "u", []string{"e"}); err != nil {
		t.Fatal(err)
	}
	reqs := s.recorded()
	if len(reqs) != 3 || string(reqs[0].Body) != string(reqs[2].Body) || len(reqs[2].Body) == 0 {
		t.Errorf("requests = %d: the body must be sent again whole on each attempt", len(reqs))
	}
}

func TestS3PutObjectBytes(t *testing.T) {
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) {})
	c := newTestS3Client(t, s)
	if err := c.PutObjectBytes(context.Background(), "dh/snapshots/x/index.html", []byte("<html></html>"), S3PutOptions{}); err != nil {
		t.Fatal(err)
	}
	if err := c.PutObjectBytes(context.Background(), "dh/latest.json", []byte("{}"), S3PutOptions{IfNoneMatch: true}); err != nil {
		t.Fatal(err)
	}
	reqs := s.recorded()
	if string(reqs[0].Body) != "<html></html>" || reqs[0].Header.Get("Content-Type") != "text/html; charset=utf-8" {
		t.Errorf("page: body %q, type %q", reqs[0].Body, reqs[0].Header.Get("Content-Type"))
	}
	if reqs[1].Header.Get("Content-Type") != "application/json" || reqs[1].Header.Get("If-None-Match") != "*" {
		t.Errorf("json: type %q, if-none-match %q", reqs[1].Header.Get("Content-Type"), reqs[1].Header.Get("If-None-Match"))
	}
	if reqs[0].Header.Get("X-Amz-Content-Sha256") == s3EmptyHash {
		t.Error("the body's hash is not in the signature")
	}
	if err := c.PutObjectBytes(context.Background(), "empty", nil, S3PutOptions{}); err != nil {
		t.Errorf("empty body: %v", err)
	}
}

func TestS3ObjectURL(t *testing.T) {
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) {})
	c := newTestS3Client(t, s)
	if got, want := c.ObjectURL("dh/a b/latest.json"), s.URL+"/snapshots/dh/a%20b/latest.json"; got != want {
		t.Errorf("ObjectURL = %q, want %q", got, want)
	}
	if strings.Contains(c.ObjectURL("k"), testSecret) || strings.Contains(c.ObjectURL("k"), "AKIATESTKEY") {
		t.Error("the URL carries a credential")
	}
}
