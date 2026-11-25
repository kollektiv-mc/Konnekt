package services

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"testing"
)

// ─── CopyObject and the redaction of a key's secret part (#561) ────────────

func TestS3CopyObjectNamesTheSourceSendsNoDataAndSignsTheHeader(t *testing.T) {
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`<CopyObjectResult><ETag>&quot;e&quot;</ETag><LastModified>2026-10-11T04:00:00Z</LastModified></CopyObjectResult>`))
	})
	c := newTestS3Client(t, s)

	if err := c.CopyObject(context.Background(), "dh/tok/snapshots/s/index.html", "dh/snapshots/s/index ä.html"); err != nil {
		t.Fatal(err)
	}
	r := s.recorded()[0]
	if r.Method != http.MethodPut || r.RequestURI != "/snapshots/dh/tok/snapshots/s/index.html" {
		t.Errorf("request = %s %s", r.Method, r.RequestURI)
	}
	if got := r.Header.Get("X-Amz-Copy-Source"); got != "/snapshots/dh/snapshots/s/index%20%C3%A4.html" {
		t.Errorf("x-amz-copy-source = %q, want /<bucket>/<encoded key>", got)
	}
	if len(r.Body) != 0 || r.Header.Get("X-Amz-Content-Sha256") != s3EmptyHash {
		t.Errorf("body %q, content sha %q: a copy carries no data", r.Body, r.Header.Get("X-Amz-Content-Sha256"))
	}
	if !contains(signedHeaders(t, r), "x-amz-copy-source") {
		t.Errorf("signed headers = %v: the copy source must be signed", signedHeaders(t, r))
	}
	if r.Header.Get("X-Amz-Copy-Source-Range") != "" {
		t.Error("a whole-object copy sent a range")
	}
}

// S3 starts answering a copy before the work is done, and reports a late failure
// as an Error document inside a 200.
func TestS3CopyObjectTreatsAnErrorBodyInA200AsAFailure(t *testing.T) {
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`<?xml version="1.0"?><Error><Code>InternalError</Code><Message>try again ` + testSecret + `</Message></Error>`))
	})
	err := newTestS3Client(t, s).CopyObject(context.Background(), "d", "s")
	var se *S3Error
	if !errors.As(err, &se) || se.Op != "CopyObject" || se.Code != "InternalError" || se.Status != 200 {
		t.Fatalf("err = %v", err)
	}
	if strings.Contains(err.Error(), testSecret) {
		t.Errorf("the secret is in the error: %v", err)
	}
}

func TestS3CopyObjectReportsAMissingSourceAndRetriesAServerError(t *testing.T) {
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) {
		s3XMLError(w, http.StatusNotFound, "NoSuchKey", "The specified key does not exist.")
	})
	err := newTestS3Client(t, s).CopyObject(context.Background(), "d", "s")
	var se *S3Error
	if !errors.As(err, &se) || se.Status != 404 || se.Code != "NoSuchKey" {
		t.Fatalf("err = %v", err)
	}
	if n := len(s.recorded()); n != 1 {
		t.Errorf("a 404 was retried: %d requests", n)
	}

	flaky := newS3TestServer(t, func(n int, w http.ResponseWriter, _ *http.Request) {
		if n < 3 {
			s3XMLError(w, http.StatusServiceUnavailable, "SlowDown", "later")
			return
		}
		_, _ = w.Write([]byte(`<CopyObjectResult/>`))
	})
	if err := newTestS3Client(t, flaky).CopyObject(context.Background(), "d", "s"); err != nil {
		t.Fatalf("a 503 that clears was not retried through: %v", err)
	}
	if n := len(flaky.recorded()); n != 3 {
		t.Errorf("%d attempts, want 3", n)
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
	err := c.CopyObject(context.Background(), key, "dh/latest.json")
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
