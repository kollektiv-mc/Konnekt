package services

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"testing"
)

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

const testLinkToken = "abcdefghijklmnopqrstuvwxyz"

func TestS3AlsoRedactReplacesTheTokenInKeysErrorsAndLogs(t *testing.T) {
	logs := &captureHandler{}
	prev := slog.Default()
	slog.SetDefault(slog.New(logs))
	t.Cleanup(func() { slog.SetDefault(prev) })

	s := newS3TestServer(t, func(n int, w http.ResponseWriter, _ *http.Request) {
		if n == 1 {
			s3XMLError(w, http.StatusServiceUnavailable, "SlowDown", "later")
			return
		}
		s3XMLError(w, http.StatusForbidden, "AccessDenied", "no access to dh/"+testLinkToken+"/latest.json")
	})
	c := newTestS3Client(t, s)
	c.AlsoRedact("") // ignored: replacing "" would mark between every character
	c.AlsoRedact(testLinkToken)
	c.AlsoRedact(testLinkToken) // once

	if got := c.scrub("a" + testSecret + "b " + testLinkToken); got != "a[redacted]b [redacted]" {
		t.Errorf("scrub = %q", got)
	}
	if len(c.redact) != 1 {
		t.Errorf("redact = %v", c.redact)
	}

	key := "dh/" + testLinkToken + "/latest.json"
	err := c.PutObjectBytes(context.Background(), key, []byte("{}"), S3PutOptions{})
	if err == nil || strings.Contains(err.Error(), testLinkToken) || !strings.Contains(err.Error(), "dh/[redacted]/latest.json") {
		t.Fatalf("err = %v: the key's token must read [redacted]", err)
	}
	var se *S3Error
	if !errors.As(err, &se) || strings.Contains(se.Key, testLinkToken) {
		t.Errorf("the error's own Key carries the token: %+v", se)
	}
	if strings.Contains(logs.buf.String(), testLinkToken) || !strings.Contains(logs.buf.String(), "retrying") {
		t.Errorf("the retry log:\n%s", logs.buf.String())
	}

	// A client with nothing added behaves as before.
	plain := newTestS3Client(t, s)
	if got := plain.scrub("x " + testLinkToken); got != "x "+testLinkToken {
		t.Errorf("a client with nothing added scrubbed %q", got)
	}
}
