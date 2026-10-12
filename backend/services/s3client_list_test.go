package services

import (
	"context"
	"crypto/md5"
	"encoding/base64"
	"encoding/xml"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

// --- ListObjects and DeleteObjects (snapshot retention, #560) ---

func listPage(truncated bool, next string, keys ...string) string {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0"?><ListBucketResult><Name>snapshots</Name>`)
	fmt.Fprintf(&b, "<IsTruncated>%t</IsTruncated>", truncated)
	if next != "" {
		fmt.Fprintf(&b, "<NextContinuationToken>%s</NextContinuationToken>", next)
	}
	for i, k := range keys {
		fmt.Fprintf(&b, "<Contents><Key>%s</Key><ETag>&quot;e&quot;</ETag><Size>%d</Size></Contents>", k, 10*(i+1))
	}
	b.WriteString("</ListBucketResult>")
	return b.String()
}

func TestS3ListObjectsFollowsEveryPageOfAThreePageListing(t *testing.T) {
	pages := map[string]string{
		"":        listPage(true, "tok/1 +", "dh/a", "dh/b"),
		"tok/1 +": listPage(true, "tok2", "dh/c", "dh/d"),
		"tok2":    listPage(false, "", "dh/e"),
	}
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(pages[r.URL.Query().Get("continuation-token")]))
	})
	got, err := newTestS3Client(t, s).ListObjects(context.Background(), "dh/")
	if err != nil {
		t.Fatal(err)
	}
	var keys []string
	for _, o := range got {
		keys = append(keys, o.Key)
	}
	if strings.Join(keys, ",") != "dh/a,dh/b,dh/c,dh/d,dh/e" {
		t.Errorf("keys = %v: a page was skipped or repeated", keys)
	}
	if got[1].Size != 20 || got[4].Size != 10 {
		t.Errorf("sizes = %+v", got)
	}
	reqs := s.recorded()
	if len(reqs) != 3 {
		t.Fatalf("%d requests, want one per page", len(reqs))
	}
	for i, wantToken := range []string{"", "tok/1 +", "tok2"} {
		u, err := url.Parse(reqs[i].RequestURI)
		if err != nil {
			t.Fatal(err)
		}
		q := u.Query()
		if reqs[i].Method != http.MethodGet || u.Path != "/snapshots" || q.Get("list-type") != "2" || q.Get("prefix") != "dh/" || q.Get("continuation-token") != wantToken {
			t.Errorf("request %d = %s %s, want a v2 listing of dh/ at token %q", i, reqs[i].Method, reqs[i].RequestURI, wantToken)
		}
		if wantToken == "" && q.Has("continuation-token") {
			t.Errorf("the first request already carries a token: %s", reqs[i].RequestURI)
		}
		if reqs[i].Header.Get("X-Amz-Content-Sha256") != s3EmptyHash || !strings.HasPrefix(reqs[i].Header.Get("Authorization"), s3Algorithm) {
			t.Errorf("request %d is not signed", i)
		}
	}
}

func TestS3ListObjectsEmptyAndTruncatedWithoutATokenAreDistinguished(t *testing.T) {
	body := listPage(false, "")
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(body)) })
	c := newTestS3Client(t, s)
	got, err := c.ListObjects(context.Background(), "none/")
	if err != nil || len(got) != 0 {
		t.Fatalf("got=%v err=%v: an empty listing is an empty list", got, err)
	}
	body = listPage(true, "", "a")
	if _, err := c.ListObjects(context.Background(), "x/"); err == nil || !strings.Contains(err.Error(), "no next page") {
		t.Errorf("err = %v: a truncated listing with nowhere to go on is not a complete one", err)
	}
	body = listPage(true, "same", "a")
	n := 0
	s2 := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) {
		n++
		_, _ = w.Write([]byte(body))
	})
	if _, err := newTestS3Client(t, s2).ListObjects(context.Background(), "x/"); err == nil || n > 2 {
		t.Errorf("err = %v after %d requests: a token that does not advance must end the loop", err, n)
	}
}

func TestS3ListObjectsRetriesA5xxAndNamesTheFailure(t *testing.T) {
	s := newS3TestServer(t, func(n int, w http.ResponseWriter, _ *http.Request) {
		if n < 3 {
			s3XMLError(w, http.StatusServiceUnavailable, "SlowDown", "Reduce your request rate")
			return
		}
		_, _ = w.Write([]byte(listPage(false, "", "dh/a")))
	})
	got, err := newTestS3Client(t, s).ListObjects(context.Background(), "dh/")
	if err != nil || len(got) != 1 || len(s.recorded()) != 3 {
		t.Fatalf("got=%v err=%v requests=%d: a 503 is retried like every other call", got, err, len(s.recorded()))
	}

	denied := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) {
		s3XMLError(w, http.StatusForbidden, "AccessDenied", "no "+testSecret)
	})
	_, err = newTestS3Client(t, denied).ListObjects(context.Background(), "dh/")
	var se *S3Error
	if !errors.As(err, &se) || se.Op != "ListObjects" || se.Status != 403 || se.Code != "AccessDenied" || strings.Contains(err.Error(), testSecret) {
		t.Errorf("err = %v", err)
	}
	if n := len(denied.recorded()); n != 1 {
		t.Errorf("a 403 was retried: %d requests", n)
	}
}

func TestS3ListObjectsReadsAPageLargerThanASmallAnswer(t *testing.T) {
	keys := make([]string, 1000)
	for i := range keys {
		keys[i] = fmt.Sprintf("dh/parts/%064d", i)
	}
	body := listPage(false, "", keys...)
	if len(body) <= s3ErrorBodyLimit {
		t.Fatalf("the page is %d bytes: not larger than the %d a small answer is read to", len(body), s3ErrorBodyLimit)
	}
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(body)) })
	got, err := newTestS3Client(t, s).ListObjects(context.Background(), "dh/parts/")
	if err != nil || len(got) != 1000 {
		t.Fatalf("%d keys, err %v", len(got), err)
	}
}

func TestS3ListObjectsRefusesAPageOverTheLimitRatherThanReadingPartOfIt(t *testing.T) {
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(strings.Repeat(" ", s3ListBodyLimit+1)))
	})
	if _, err := newTestS3Client(t, s).ListObjects(context.Background(), "dh/"); err == nil || !strings.Contains(err.Error(), "over the") {
		t.Errorf("err = %v", err)
	}
}

func TestS3DeleteObjectsSendsTheKeysWithItsMD5InQuietMode(t *testing.T) {
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`<?xml version="1.0"?><DeleteResult></DeleteResult>`))
	})
	keys := []string{"dh/snapshots/a/index.json", "dh/parts/ab&cd", "dh/with space/é"}
	if err := newTestS3Client(t, s).DeleteObjects(context.Background(), keys); err != nil {
		t.Fatal(err)
	}
	r := s.recorded()[0]
	if r.Method != http.MethodPost || r.RequestURI != "/snapshots?delete=" {
		t.Errorf("request = %s %s", r.Method, r.RequestURI)
	}
	sum := md5.Sum(r.Body)
	if got := r.Header.Get("Content-MD5"); got != base64.StdEncoding.EncodeToString(sum[:]) {
		t.Errorf("Content-MD5 = %q, want the base64 of the body's MD5", got)
	}
	if !contains(signedHeaders(t, r), "content-md5") {
		t.Errorf("signed headers %v do not cover content-md5", signedHeaders(t, r))
	}
	if h := r.Header.Get("X-Amz-Content-Sha256"); h == s3EmptyHash || h == "" {
		t.Errorf("the body's hash is not in the signature: %q", h)
	}
	var doc struct {
		Quiet   bool `xml:"Quiet"`
		Objects []struct {
			Key string `xml:"Key"`
		} `xml:"Object"`
	}
	if err := xml.Unmarshal(r.Body, &doc); err != nil {
		t.Fatalf("body %q: %v", r.Body, err)
	}
	if !doc.Quiet || len(doc.Objects) != 3 {
		t.Fatalf("body = %s", r.Body)
	}
	for i, k := range keys {
		if doc.Objects[i].Key != k {
			t.Errorf("object %d = %q, want %q", i, doc.Objects[i].Key, k)
		}
	}
}

func TestS3DeleteObjectsSplitsALongListAt1000(t *testing.T) {
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`<DeleteResult></DeleteResult>`))
	})
	keys := make([]string, 2500)
	for i := range keys {
		keys[i] = fmt.Sprintf("dh/parts/%04d", i)
	}
	if err := newTestS3Client(t, s).DeleteObjects(context.Background(), keys); err != nil {
		t.Fatal(err)
	}
	var sizes []int
	var seen []string
	for _, r := range s.recorded() {
		var doc struct {
			Objects []struct {
				Key string `xml:"Key"`
			} `xml:"Object"`
		}
		if err := xml.Unmarshal(r.Body, &doc); err != nil {
			t.Fatal(err)
		}
		sizes = append(sizes, len(doc.Objects))
		for _, o := range doc.Objects {
			seen = append(seen, o.Key)
		}
	}
	if fmt.Sprint(sizes) != "[1000 1000 500]" {
		t.Errorf("request sizes = %v, want [1000 1000 500]", sizes)
	}
	if strings.Join(seen, ",") != strings.Join(keys, ",") {
		t.Error("the chunks do not add up to the list, in order")
	}
	exact := keys[:1000]
	s2 := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`<DeleteResult/>`)) })
	if err := newTestS3Client(t, s2).DeleteObjects(context.Background(), exact); err != nil || len(s2.recorded()) != 1 {
		t.Errorf("1000 keys: err %v, %d requests, want one", err, len(s2.recorded()))
	}
}

func TestS3DeleteObjectsOfNothingSendsNothing(t *testing.T) {
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) {})
	c := newTestS3Client(t, s)
	if err := c.DeleteObjects(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	if err := c.DeleteObjects(context.Background(), []string{}); err != nil || len(s.recorded()) != 0 {
		t.Errorf("err %v, %d requests: an empty list is a no-op", err, len(s.recorded()))
	}
}

func TestS3DeleteObjectsRefusesAKeyXMLCouldNotCarryBeforeAnyRequest(t *testing.T) {
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) {})
	c := newTestS3Client(t, s)
	for _, bad := range []string{"", "dh/a\x01b", "dh/\xff"} {
		if err := c.DeleteObjects(context.Background(), []string{"dh/ok", bad}); err == nil {
			t.Errorf("%q was accepted", bad)
		}
	}
	if n := len(s.recorded()); n != 0 {
		t.Errorf("%d requests went out: the good key must not be deleted either", n)
	}
}

func TestS3DeleteObjectsCountsPerKeyErrorsAcrossRequestsIntoOneError(t *testing.T) {
	s := newS3TestServer(t, func(n int, w http.ResponseWriter, _ *http.Request) {
		if n == 1 {
			_, _ = fmt.Fprintf(w, `<DeleteResult><Error><Key>dh/parts/0003</Key><Code>AccessDenied</Code><Message>Access Denied %s</Message></Error><Error><Key>dh/parts/0004</Key><Code>InternalError</Code><Message>x</Message></Error></DeleteResult>`, testSecret)
			return
		}
		_, _ = w.Write([]byte(`<DeleteResult></DeleteResult>`))
	})
	keys := make([]string, 1500)
	for i := range keys {
		keys[i] = fmt.Sprintf("dh/parts/%04d", i)
	}
	err := newTestS3Client(t, s).DeleteObjects(context.Background(), keys)
	var se *S3Error
	if !errors.As(err, &se) || se.Op != "DeleteObjects" {
		t.Fatalf("err = %v", err)
	}
	if !strings.Contains(err.Error(), "2 of 1500 key(s) could not be deleted") || !strings.Contains(err.Error(), "dh/parts/0003: AccessDenied") {
		t.Errorf("err = %v: want how many failed, of how many, and the first", err)
	}
	if strings.Contains(err.Error(), testSecret) {
		t.Errorf("the error carries the secret: %v", err)
	}
	if n := len(s.recorded()); n != 2 {
		t.Errorf("%d requests: the second chunk must still be sent after the first reported a stuck key", n)
	}
}

func TestS3DeleteObjectsRetriesA5xxWithTheSameBody(t *testing.T) {
	s := newS3TestServer(t, func(n int, w http.ResponseWriter, _ *http.Request) {
		if n < 3 {
			s3XMLError(w, http.StatusServiceUnavailable, "SlowDown", "Reduce your request rate")
			return
		}
		_, _ = w.Write([]byte(`<DeleteResult></DeleteResult>`))
	})
	if err := newTestS3Client(t, s).DeleteObjects(context.Background(), []string{"a", "b"}); err != nil {
		t.Fatal(err)
	}
	reqs := s.recorded()
	if len(reqs) != 3 || string(reqs[0].Body) != string(reqs[2].Body) || len(reqs[2].Body) == 0 {
		t.Fatalf("requests = %d: the body must be sent whole on each attempt", len(reqs))
	}
	if reqs[0].Header.Get("Content-MD5") != reqs[2].Header.Get("Content-MD5") || reqs[2].Header.Get("Content-MD5") == "" {
		t.Error("Content-MD5 changed or went missing between attempts")
	}
}

func TestS3DeleteObjectsRefusedOutrightEndsAtOnceAndNeverLeaksTheSecret(t *testing.T) {
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) {
		s3XMLError(w, http.StatusForbidden, "AccessDenied", "no "+testSecret)
	})
	keys := make([]string, 1200)
	for i := range keys {
		keys[i] = fmt.Sprintf("k%d", i)
	}
	err := newTestS3Client(t, s).DeleteObjects(context.Background(), keys)
	var se *S3Error
	if !errors.As(err, &se) || se.Status != 403 || strings.Contains(err.Error(), testSecret) {
		t.Fatalf("err = %v", err)
	}
	if n := len(s.recorded()); n != 1 {
		t.Errorf("%d requests: a 403 is not retried and the next chunk is not tried", n)
	}
}

func TestS3DeleteObjectsTreatsAnErrorBodyInA200AsAFailure(t *testing.T) {
	s := newS3TestServer(t, func(_ int, w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`<Error><Code>InternalError</Code><Message>late failure</Message></Error>`))
	})
	err := newTestS3Client(t, s).DeleteObjects(context.Background(), []string{"a"})
	var se *S3Error
	if !errors.As(err, &se) || se.Code != "InternalError" {
		t.Errorf("err = %v", err)
	}
}
