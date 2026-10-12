package services

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"testing"
)

// --- GetObject (reads latest.json for the Distant Horizons snapshot, #481) ---

func TestS3GetObjectFound(t *testing.T) {
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"format":1}`))
	})
	body, found, err := newTestS3Client(t, s).GetObject(context.Background(), "dh/latest.json")
	if err != nil || !found || string(body) != `{"format":1}` {
		t.Fatalf("body=%q found=%v err=%v", body, found, err)
	}
	r := s.recorded()[0]
	if r.Method != http.MethodGet || r.RequestURI != "/snapshots/dh/latest.json" {
		t.Errorf("request = %s %s", r.Method, r.RequestURI)
	}
	if got := r.Header.Get("X-Amz-Content-Sha256"); got != s3EmptyHash {
		t.Errorf("payload hash = %s, want the empty hash", got)
	}
	if !strings.HasPrefix(r.Header.Get("Authorization"), s3Algorithm) {
		t.Errorf("request is not signed: %q", r.Header.Get("Authorization"))
	}
}

func TestS3GetObjectNotFoundIsNotAnError(t *testing.T) {
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) {
		s3XMLError(w, http.StatusNotFound, "NoSuchKey", "The specified key does not exist.")
	})
	body, found, err := newTestS3Client(t, s).GetObject(context.Background(), "missing")
	if err != nil || found || body != nil {
		t.Fatalf("body=%q found=%v err=%v", body, found, err)
	}
	if n := len(s.recorded()); n != 1 {
		t.Errorf("a 404 was retried: %d requests", n)
	}
}

func TestS3GetObjectMissingBucketIsAnError(t *testing.T) {
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) {
		s3XMLError(w, http.StatusNotFound, "NoSuchBucket", "The specified bucket does not exist")
	})
	_, found, err := newTestS3Client(t, s).GetObject(context.Background(), "k")
	var se *S3Error
	if found || !errors.As(err, &se) || se.Code != "NoSuchBucket" || se.Status != 404 {
		t.Fatalf("found=%v err=%v: a mistyped bucket must not read as a first snapshot", found, err)
	}
}

func TestS3GetObjectRetriesA5xxThenSucceeds(t *testing.T) {
	s := newS3TestServer(t, func(n int, w http.ResponseWriter, _ *http.Request) {
		if n < 3 {
			s3XMLError(w, http.StatusServiceUnavailable, "SlowDown", "Reduce your request rate")
			return
		}
		_, _ = w.Write([]byte("ok"))
	})
	body, found, err := newTestS3Client(t, s).GetObject(context.Background(), "k")
	if err != nil || !found || string(body) != "ok" {
		t.Fatalf("body=%q found=%v err=%v", body, found, err)
	}
	if n := len(s.recorded()); n != 3 {
		t.Errorf("requests = %d, want 3", n)
	}
}

func TestS3GetObjectGivesUpAfterTheAttempts(t *testing.T) {
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) {
		s3XMLError(w, http.StatusInternalServerError, "InternalError", "We encountered an internal error")
	})
	_, _, err := newTestS3Client(t, s).GetObject(context.Background(), "k")
	var se *S3Error
	if !errors.As(err, &se) || se.Status != 500 {
		t.Fatalf("err = %v", err)
	}
	if n := len(s.recorded()); n != s3MaxAttempts {
		t.Errorf("requests = %d, want %d", n, s3MaxAttempts)
	}
}

func TestS3GetObjectDoesNotRetryA403(t *testing.T) {
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) {
		s3XMLError(w, http.StatusForbidden, "AccessDenied", "Access Denied")
	})
	_, found, err := newTestS3Client(t, s).GetObject(context.Background(), "k")
	var se *S3Error
	if found || !errors.As(err, &se) || se.Status != 403 || se.Code != "AccessDenied" || se.Op != "GetObject" {
		t.Fatalf("found=%v err=%v", found, err)
	}
	if n := len(s.recorded()); n != 1 {
		t.Errorf("a 403 was retried: %d requests", n)
	}
}

func TestS3GetObjectBodyCap(t *testing.T) {
	t.Run("an object at the cap is returned whole", func(t *testing.T) {
		big := bytes.Repeat([]byte("a"), s3GetBodyLimit)
		s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(big) })
		body, found, err := newTestS3Client(t, s).GetObject(context.Background(), "k")
		if err != nil || !found || len(body) != s3GetBodyLimit {
			t.Fatalf("len=%d found=%v err=%v", len(body), found, err)
		}
	})
	t.Run("one byte over is refused, not truncated", func(t *testing.T) {
		big := bytes.Repeat([]byte("a"), s3GetBodyLimit+1)
		s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(big) })
		body, found, err := newTestS3Client(t, s).GetObject(context.Background(), "k")
		if err == nil || found || body != nil || !strings.Contains(err.Error(), "MB this client reads") {
			t.Fatalf("len=%d found=%v err=%v", len(body), found, err)
		}
	})
}

func TestS3GetObjectCancelled(t *testing.T) {
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) {})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, err := newTestS3Client(t, s).GetObject(ctx, "k"); err == nil {
		t.Fatal("a cancelled context was ignored")
	}
}

func TestS3GetObjectNeverLeaksTheSecret(t *testing.T) {
	logs := &captureHandler{}
	prev := slog.Default()
	slog.SetDefault(slog.New(logs))
	t.Cleanup(func() { slog.SetDefault(prev) })

	s := newS3TestServer(t, func(n int, w http.ResponseWriter, _ *http.Request) {
		if n == 1 {
			s3XMLError(w, http.StatusBadGateway, "BadGateway", "upstream said "+testSecret)
			return
		}
		s3XMLError(w, http.StatusForbidden, "SignatureDoesNotMatch", "bad key "+testSecret)
	})
	c := newTestS3Client(t, s)
	_, _, err := c.GetObject(context.Background(), "k")
	if err == nil {
		t.Fatal("expected an error")
	}
	if strings.Contains(err.Error(), testSecret) {
		t.Errorf("error leaks the secret: %v", err)
	}
	if !strings.Contains(err.Error(), s3Redacted) {
		t.Errorf("the echoed secret was dropped rather than marked: %v", err)
	}
	if strings.Contains(logs.buf.String(), testSecret) {
		t.Errorf("log leaks the secret:\n%s", logs.buf.String())
	}
	for i, r := range s.recorded() {
		var sb strings.Builder
		sb.WriteString(r.Method + " " + r.RequestURI + " " + r.Host + "\n")
		for k, vs := range r.Header {
			sb.WriteString(k + ": " + strings.Join(vs, ",") + "\n")
		}
		if strings.Contains(sb.String(), testSecret) {
			t.Errorf("request %d carries the secret", i)
		}
	}
}
