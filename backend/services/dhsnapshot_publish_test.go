package services

import (
	"bytes"
	"context"
	"encoding/xml"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"
)

// ─── The publish run (#565) ────────────────────────────────────────────────
//
// runDHPublish is driven against the in-memory bucket of upload_test.go, which
// answers the multipart calls and really assembles what they copy, so a test can
// compare a finished object with the database it came from. The databases are
// byte files; nothing here is SQLite.

const (
	dhPubCreated1  = "20261011T040000Z"
	dhPubCreated2  = "20261018T040000Z"
	dhPubOverworld = "pfx@minecraft@@overworld"
	dhPubNether    = "pfx@minecraft@@the_nether"
)

var (
	dhPubTime1 = time.Date(2026, 10, 11, 4, 0, 0, 0, time.UTC)
	dhPubTime2 = time.Date(2026, 10, 18, 4, 0, 0, 0, time.UTC)
)

// dhPubDBs are the two databases of a snapshot: the overworld is four parts (the
// last short) and the nether two.
func dhPubDBs() map[string][]byte {
	return map[string][]byte{
		dhPubOverworld: dhBytes(3*dhTestPart+100, 1),
		dhPubNether:    dhBytes(2*dhTestPart, 2),
	}
}

type dhPublishFixture struct {
	t         *testing.T
	bucket    *fakeBucket
	client    *S3Client
	plan      dhPublishPlan
	narration []string
}

func newDHPublishFixture(t *testing.T) *dhPublishFixture {
	t.Helper()
	b := newFakeBucket(t)
	f := &dhPublishFixture{t: t, bucket: b, client: newTestS3Client(t, b.s3TestServer)}
	f.plan = dhPublishPlan{
		Store: f.client, Label: `"R2"`, KeyPrefix: "dh",
		Narrate: func(line string) { f.narration = append(f.narration, line) },
	}
	return f
}

// stage stages dbs as a snapshot taken at created, against prev, into a fresh
// folder, and returns the folder and the index it wrote. Like the snapshot block,
// it copies only the parts prev lacks.
func (f *dhPublishFixture) stage(dbs map[string][]byte, prev *DHIndex, created time.Time) (string, DHIndex) {
	f.t.Helper()
	keys, err := snapshotKeys("dh", "", created)
	if err != nil {
		f.t.Fatal(err)
	}
	dir := f.t.TempDir()
	ix, _, err := stageDHSnapshot(dhSource(f.t, dbs), prev, dir, keys, dhTestPart)
	if err != nil {
		f.t.Fatal(err)
	}
	data, err := ix.Marshal()
	if err != nil {
		f.t.Fatal(err)
	}
	dhWrite(f.t, dir, dhIndexFile, data)
	return dir, ix
}

func (f *dhPublishFixture) publish(dir string) (dhPublishResult, error) {
	f.plan.StageDir = dir
	return runDHPublish(context.Background(), f.plan)
}

func (f *dhPublishFixture) narrated() string { return strings.Join(f.narration, "\n") }

// wireReq is one request the bucket saw, with the bucket's name taken off.
type wireReq struct {
	Method string
	Key    string
	Query  url.Values
	Header http.Header
	Body   []byte
}

func (f *dhPublishFixture) wire() []wireReq {
	f.t.Helper()
	var out []wireReq
	for _, r := range f.bucket.recorded() {
		u, err := url.Parse(r.RequestURI)
		if err != nil {
			f.t.Fatal(err)
		}
		out = append(out, wireReq{Method: r.Method, Key: strings.TrimPrefix(u.Path, "/snapshots/"), Query: u.Query(), Header: r.Header, Body: r.Body})
	}
	return out
}

func (f *dhPublishFixture) reset() {
	srv := f.bucket.s3TestServer
	srv.mu.Lock()
	srv.reqs = nil
	srv.mu.Unlock()
}

func (r wireReq) isCreate() bool   { return r.Method == http.MethodPost && r.Query.Has("uploads") }
func (r wireReq) isCopy() bool     { return r.Method == http.MethodPut && r.Query.Has("partNumber") }
func (r wireReq) isComplete() bool { return r.Method == http.MethodPost && r.Query.Has("uploadId") }
func (r wireReq) isAbort() bool    { return r.Method == http.MethodDelete }
func (r wireReq) isMultipart() bool {
	return r.isCreate() || r.isCopy() || r.isComplete() || r.isAbort()
}

// partPuts are the requests that sent a part.
func partPuts(reqs []wireReq) []wireReq {
	var out []wireReq
	for _, r := range reqs {
		if r.Method == http.MethodPut && !r.isMultipart() && strings.Contains(r.Key, "/parts/") {
			out = append(out, r)
		}
	}
	return out
}

func ofKind(reqs []wireReq, pred func(wireReq) bool) []wireReq {
	var out []wireReq
	for _, r := range reqs {
		if pred(r) {
			out = append(out, r)
		}
	}
	return out
}

func assembledKey(stamp, folder string) string {
	return "dh/snapshots/" + stamp + "/" + folder + "/" + dhDatabaseName
}

func partKey(sum string) string { return "dh/parts/" + sum }

// --- a first publish ---

func TestDHPublishFirstRunSendsAllAndWritesLatestLast(t *testing.T) {
	f := newDHPublishFixture(t)
	dbs := dhPubDBs()
	dir, ix := f.stage(dbs, nil, dhPubTime1)

	res, err := f.publish(dir)
	if err != nil {
		t.Fatal(err)
	}
	var wantBytes int64
	for _, l := range ix.Levels {
		wantBytes += l.Size
	}
	if res.PartsUploaded != 6 || res.PartsSkipped != 0 || res.BytesSent != wantBytes || res.LevelsAssembled != 2 {
		t.Errorf("result = %+v, want 6 parts and %d bytes sent, 2 levels assembled", res, wantBytes)
	}
	if want := f.client.ObjectURL("dh/latest.json"); res.URL != want {
		t.Errorf("url = %q, want the bucket's own address %q when the destination has no public base", res.URL, want)
	}

	reqs := f.wire()
	// Every part went up with If-None-Match, once.
	puts := partPuts(reqs)
	if len(puts) != 6 {
		t.Fatalf("%d part PUTs, want 6", len(puts))
	}
	for _, r := range puts {
		if r.Header.Get("If-None-Match") != "*" {
			t.Errorf("%s was sent without If-None-Match", r.Key)
		}
	}
	for _, l := range ix.Levels {
		for _, part := range l.Parts {
			if !bytes.Equal(f.bucket.object(partKey(part.SHA256)), dbs[l.Folder][partOffset(l, part):][:part.Size]) {
				t.Errorf("part %s in the bucket is not the database's bytes", part.SHA256)
			}
		}
	}

	// Each level: create, one copy per part in index order with part numbers from
	// 1, complete. No request of the assembly carries data.
	pos := 0
	for _, l := range ix.Levels {
		for pos < len(reqs) && !reqs[pos].isMultipart() {
			pos++
		}
		if pos >= len(reqs) || !reqs[pos].isCreate() || reqs[pos].Key != assembledKey(dhPubCreated1, l.Folder) {
			t.Fatalf("level %s: request %d is not its create: %+v", l.Folder, pos, reqs[pos])
		}
		pos++
		for i, part := range l.Parts {
			r := reqs[pos]
			if !r.isCopy() || r.Key != assembledKey(dhPubCreated1, l.Folder) {
				t.Fatalf("level %s: request %d is not a copy into the level: %+v", l.Folder, pos, r)
			}
			if r.Query.Get("partNumber") != strconv.Itoa(i+1) || r.Header.Get("X-Amz-Copy-Source") != "/snapshots/"+partKey(part.SHA256) {
				t.Errorf("level %s part %d: number %q, source %q", l.Folder, i+1, r.Query.Get("partNumber"), r.Header.Get("X-Amz-Copy-Source"))
			}
			if len(r.Body) != 0 || r.Header.Get("X-Amz-Copy-Source-Range") != "" {
				t.Errorf("level %s part %d: body %d bytes, range %q", l.Folder, i+1, len(r.Body), r.Header.Get("X-Amz-Copy-Source-Range"))
			}
			pos++
		}
		if !reqs[pos].isComplete() || reqs[pos].Key != assembledKey(dhPubCreated1, l.Folder) {
			t.Fatalf("level %s: request %d is not its complete: %+v", l.Folder, pos, reqs[pos])
		}
		var doc struct {
			Parts []struct{ PartNumber int } `xml:"Part"`
		}
		if err := xml.Unmarshal(reqs[pos].Body, &doc); err != nil || len(doc.Parts) != len(l.Parts) {
			t.Errorf("level %s: complete body %q (%v)", l.Folder, reqs[pos].Body, err)
		}
		pos++
		if !bytes.Equal(f.bucket.object(assembledKey(dhPubCreated1, l.Folder)), dbs[l.Folder]) {
			t.Errorf("level %s: the assembled object is not the database", l.Folder)
		}
	}
	if n := len(ofKind(reqs, wireReq.isAbort)); n != 0 {
		t.Errorf("%d aborts in a clean run", n)
	}
	if n := f.bucket.openUploads(); n != 0 {
		t.Errorf("%d uploads left open", n)
	}
	var data int
	for _, r := range ofKind(reqs, wireReq.isMultipart) {
		data += len(r.Body)
	}
	if data > 1000 {
		t.Errorf("assembly requests carried %d body bytes: they are lists, not data", data)
	}

	// The index and the page, then latest.json as the very last request.
	indexKey, pageKey := "dh/snapshots/"+dhPubCreated1+"/index.json", "dh/snapshots/"+dhPubCreated1+"/index.html"
	order := map[string]int{}
	for i, r := range reqs {
		if r.Method == http.MethodPut && !r.isMultipart() {
			order[r.Key] = i
		}
	}
	last := reqs[len(reqs)-1]
	if last.Method != http.MethodPut || last.Key != "dh/latest.json" {
		t.Fatalf("the last request is %s %s, want the PUT of dh/latest.json", last.Method, last.Key)
	}
	for _, k := range []string{indexKey, pageKey} {
		if i, ok := order[k]; !ok || i > order["dh/latest.json"] {
			t.Errorf("%s was written at %d, latest.json at %d", k, i, order["dh/latest.json"])
		}
	}
	lastComplete := -1
	for i, r := range reqs {
		if r.isComplete() {
			lastComplete = i
		}
	}
	if order[indexKey] < lastComplete || order[pageKey] < lastComplete {
		t.Error("the index or the page was written before an assembly finished")
	}

	// What was written.
	staged, err := os.ReadFile(filepath.Join(dir, dhIndexFile))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(f.bucket.object(indexKey), staged) {
		t.Error("the index in the bucket is not the staged bytes")
	}
	page, err := renderDHPage(ix)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(f.bucket.object(pageKey), page) || f.bucket.contentType(pageKey) != "text/html; charset=utf-8" {
		t.Errorf("page: equal=%v, content type %q", bytes.Equal(f.bucket.object(pageKey), page), f.bucket.contentType(pageKey))
	}
	if f.bucket.contentType(indexKey) != "application/json" || f.bucket.contentType("dh/latest.json") != "application/json" {
		t.Errorf("content types: index %q, latest %q", f.bucket.contentType(indexKey), f.bucket.contentType("dh/latest.json"))
	}
	latest, err := parseDHLatest(f.bucket.object("dh/latest.json"))
	if err != nil || latest.CreatedAt != ix.CreatedAt || latest.Index != "snapshots/"+dhPubCreated1+"/index.json" {
		t.Errorf("latest.json = %+v (%v)", latest, err)
	}
	got := f.narrated()
	for _, want := range []string{"first publish", "Uploading 6 part(s)", "Upload finished: 6 sent", "Assembling " + dhPubOverworld, "from its 4 part(s)", "Writing dh/latest.json, the last object", "Published: "} {
		if !strings.Contains(got, want) {
			t.Errorf("narration lacks %q:\n%s", want, got)
		}
	}
}

func partOffset(l DHIndexLevel, part DHPart) int {
	off := 0
	for _, p := range l.Parts {
		if p.SHA256 == part.SHA256 {
			return off
		}
		off += int(p.Size)
	}
	return -1
}

func TestDHPublishURLUsesThePublicBaseWhenTheDestinationHasOne(t *testing.T) {
	f := newDHPublishFixture(t)
	f.plan.PublicBaseURL = "https://dl.example.com/"
	dir, _ := f.stage(dhPubDBs(), nil, dhPubTime1)
	res, err := f.publish(dir)
	if err != nil {
		t.Fatal(err)
	}
	if res.URL != "https://dl.example.com/dh/latest.json" {
		t.Errorf("url = %q", res.URL)
	}

	// A prefixed bucket root: the key is the whole path.
	f2 := newDHPublishFixture(t)
	f2.plan.PublicBaseURL = "https://dl.example.com/files"
	dir, _ = f2.stage(dhPubDBs(), nil, dhPubTime1)
	if res, err = f2.publish(dir); err != nil || res.URL != "https://dl.example.com/files/dh/latest.json" {
		t.Errorf("url = %q (%v)", res.URL, err)
	}
}

// --- a second publish ---

func TestDHPublishSecondRunSendsOnlyChangedParts(t *testing.T) {
	shrinkCopyRange(t, 1500)
	f := newDHPublishFixture(t)
	dbs := dhPubDBs()
	dir1, ix1 := f.stage(dbs, nil, dhPubTime1)
	if _, err := f.publish(dir1); err != nil {
		t.Fatal(err)
	}

	// One byte in the overworld's second part changes. The nether is untouched.
	dbs2 := dhPubDBs()
	dbs2[dhPubOverworld] = append([]byte(nil), dbs2[dhPubOverworld]...)
	dbs2[dhPubOverworld][dhTestPart+5] ^= 0xFF
	dir2, ix2 := f.stage(dbs2, &ix1, dhPubTime2)
	f.reset()
	f.narration = nil

	res, err := f.publish(dir2)
	if err != nil {
		t.Fatal(err)
	}
	if res.PartsUploaded != 1 || res.PartsSkipped != 5 || res.BytesSent != dhTestPart || res.LevelsAssembled != 2 {
		t.Fatalf("result = %+v, want 1 part sent (%d bytes), 5 skipped, 2 levels assembled", res, dhTestPart)
	}
	reqs := f.wire()
	if puts := partPuts(reqs); len(puts) != 1 {
		t.Fatalf("%d part PUTs, want only the changed one", len(puts))
	}
	for _, r := range reqs {
		if r.Method == http.MethodHead && strings.Contains(r.Key, "/parts/") {
			t.Errorf("HEAD %s: a part the previous index names needs no check", r.Key)
		}
	}

	// The overworld changed, so it is built from its parts.
	overworld := ofKind(reqs, func(r wireReq) bool { return r.isCopy() && r.Key == assembledKey(dhPubCreated2, dhPubOverworld) })
	if len(overworld) != 4 {
		t.Fatalf("%d copies for the overworld, want one per part", len(overworld))
	}
	for i, r := range overworld {
		if want := "/snapshots/" + partKey(ix2.Levels[0].Parts[i].SHA256); r.Header.Get("X-Amz-Copy-Source") != want || r.Header.Get("X-Amz-Copy-Source-Range") != "" {
			t.Errorf("overworld copy %d: source %q, range %q", i+1, r.Header.Get("X-Amz-Copy-Source"), r.Header.Get("X-Amz-Copy-Source-Range"))
		}
	}
	// The nether did not, so it is copied in ranges from last week's file.
	nether := ofKind(reqs, func(r wireReq) bool { return r.isCopy() && r.Key == assembledKey(dhPubCreated2, dhPubNether) })
	if len(nether) != 2 {
		t.Fatalf("%d copies for the nether, want 2 ranges of 1500 bytes over a 2048 byte file", len(nether))
	}
	wantSource := "/snapshots/" + s3URIEncode(assembledKey(dhPubCreated1, dhPubNether), false)
	for i, wantRange := range []string{"bytes=0-1499", "bytes=1500-2047"} {
		r := nether[i]
		if r.Header.Get("X-Amz-Copy-Source") != wantSource || r.Header.Get("X-Amz-Copy-Source-Range") != wantRange || r.Query.Get("partNumber") != strconv.Itoa(i+1) || len(r.Body) != 0 {
			t.Errorf("nether copy %d: source %q, range %q, part %q", i+1, r.Header.Get("X-Amz-Copy-Source"), r.Header.Get("X-Amz-Copy-Source-Range"), r.Query.Get("partNumber"))
		}
	}
	if !strings.Contains(f.narrated(), "by copying the previous snapshot's file in 2 range(s)") {
		t.Errorf("narration:\n%s", f.narrated())
	}

	for folder, want := range dbs2 {
		if !bytes.Equal(f.bucket.object(assembledKey(dhPubCreated2, folder)), want) {
			t.Errorf("level %s: the new assembled object is not the new database", folder)
		}
	}
	// Last week's snapshot is whole, and latest.json now points at this one.
	for folder, want := range dbs {
		if !bytes.Equal(f.bucket.object(assembledKey(dhPubCreated1, folder)), want) {
			t.Errorf("level %s: the previous snapshot's file changed", folder)
		}
	}
	latest, err := parseDHLatest(f.bucket.object("dh/latest.json"))
	if err != nil || latest.Index != "snapshots/"+dhPubCreated2+"/index.json" {
		t.Errorf("latest.json = %+v (%v)", latest, err)
	}
}

func shrinkCopyRange(t *testing.T, n int64) {
	t.Helper()
	old := dhCopyRangeBytes
	dhCopyRangeBytes = n
	t.Cleanup(func() { dhCopyRangeBytes = old })
}

// A previous file that cannot be confirmed is built from parts.
func TestDHPublishUnconfirmedPreviousFileIsBuiltFromParts(t *testing.T) {
	for name, damage := range map[string]func(f *dhPublishFixture){
		"missing from the bucket": func(f *dhPublishFixture) {
			f.bucket.mu.Lock()
			delete(f.bucket.objects, assembledKey(dhPubCreated1, dhPubNether))
			f.bucket.mu.Unlock()
		},
		"a different size": func(f *dhPublishFixture) { f.bucket.put(assembledKey(dhPubCreated1, dhPubNether), []byte("short")) },
	} {
		t.Run(name, func(t *testing.T) {
			f := newDHPublishFixture(t)
			dir1, ix1 := f.stage(dhPubDBs(), nil, dhPubTime1)
			if _, err := f.publish(dir1); err != nil {
				t.Fatal(err)
			}
			damage(f)
			dir2, _ := f.stage(dhPubDBs(), &ix1, dhPubTime2)
			f.reset()
			f.narration = nil

			res, err := f.publish(dir2)
			if err != nil || res.LevelsAssembled != 2 || res.PartsUploaded != 0 {
				t.Fatalf("result = %+v (%v)", res, err)
			}
			for _, r := range ofKind(f.wire(), func(r wireReq) bool { return r.isCopy() && r.Key == assembledKey(dhPubCreated2, dhPubNether) }) {
				if strings.Contains(r.Header.Get("X-Amz-Copy-Source"), "/snapshots/dh/snapshots/") || r.Header.Get("X-Amz-Copy-Source-Range") != "" {
					t.Errorf("copy from %q range %q: the previous file was not confirmed", r.Header.Get("X-Amz-Copy-Source"), r.Header.Get("X-Amz-Copy-Source-Range"))
				}
			}
			if !strings.Contains(f.narrated(), "could not be confirmed") {
				t.Errorf("narration:\n%s", f.narrated())
			}
			if !bytes.Equal(f.bucket.object(assembledKey(dhPubCreated2, dhPubNether)), dhPubDBs()[dhPubNether]) {
				t.Error("the nether was not assembled from parts")
			}
		})
	}
}

func TestDHPublishPreviousFileHeadErrorFallsBackToParts(t *testing.T) {
	f := newDHPublishFixture(t)
	dir1, ix1 := f.stage(dhPubDBs(), nil, dhPubTime1)
	if _, err := f.publish(dir1); err != nil {
		t.Fatal(err)
	}
	dir2, _ := f.stage(dhPubDBs(), &ix1, dhPubTime2)
	f.plan.Store = headFails{dhPublishStore: f.client, key: assembledKey(dhPubCreated1, dhPubNether)}
	res, err := f.publish(dir2)
	if err != nil || res.LevelsAssembled != 2 {
		t.Fatalf("result = %+v (%v): a HEAD that fails is a fallback, not a failure", res, err)
	}
}

// headFails makes the HEAD of one key fail, as a network error would.
type headFails struct {
	dhPublishStore
	key string
}

func (h headFails) HeadObject(ctx context.Context, key string) (S3ObjectInfo, bool, error) {
	if key == h.key {
		return S3ObjectInfo{}, false, fmt.Errorf("connection reset")
	}
	return h.dhPublishStore.HeadObject(ctx, key)
}

// An earlier run that was cut off had already sent two parts. The listing
// finds them, so they are never PUT again: R2 can answer such a PUT's 412
// before reading the body, and Go's transport may report the cut-off write
// instead (golang/go#11745), which failed real resumed runs.
func TestDHPublishSkipsPartsTheBucketAlreadyHas(t *testing.T) {
	f := newDHPublishFixture(t)
	dbs := dhPubDBs()
	dir, ix := f.stage(dbs, nil, dhPubTime1)
	for _, part := range ix.Levels[0].Parts[:2] {
		f.bucket.put(partKey(part.SHA256), dbs[dhPubOverworld][partOffset(ix.Levels[0], part):][:part.Size])
	}

	res, err := f.publish(dir)
	if err != nil {
		t.Fatal(err)
	}
	if res.PartsUploaded != 4 || res.PartsSkipped != 2 {
		t.Fatalf("result = %+v, want 4 sent and 2 skipped", res)
	}
	if want := int64(dhTestPart + 100 + 2*dhTestPart); res.BytesSent != want {
		t.Errorf("bytes sent = %d, want %d", res.BytesSent, want)
	}
	if n := len(partPuts(f.wire())); n != 4 {
		t.Errorf("%d part PUTs, want only the 4 the bucket does not list", n)
	}
}

// Without the listing the run still finishes: every part is offered with
// If-None-Match, and the bucket's 412 marks the ones it has.
func TestDHPublishARefusedListingFallsBackToIfNoneMatch(t *testing.T) {
	f := newDHPublishFixture(t)
	dbs := dhPubDBs()
	dir, ix := f.stage(dbs, nil, dhPubTime1)
	for _, part := range ix.Levels[0].Parts[:2] {
		f.bucket.put(partKey(part.SHA256), dbs[dhPubOverworld][partOffset(ix.Levels[0], part):][:part.Size])
	}
	f.bucket.failList = func() (int, string) { return 403, "AccessDenied" }

	res, err := f.publish(dir)
	if err != nil {
		t.Fatal(err)
	}
	if res.PartsUploaded != 4 || res.PartsSkipped != 2 {
		t.Fatalf("result = %+v, want 4 sent and 2 skipped", res)
	}
	if n := len(partPuts(f.wire())); n != 6 {
		t.Errorf("%d part PUTs, want all 6 offered with If-None-Match", n)
	}
	if !slices.ContainsFunc(f.narration, func(l string) bool { return strings.HasPrefix(l, "Could not list the parts") }) {
		t.Errorf("the refused listing was not narrated: %q", f.narration)
	}
}

func TestDHPublishRepeatedPartsAreSentOnceAndCopiedEachTime(t *testing.T) {
	f := newDHPublishFixture(t)
	zeros := bytes.Repeat([]byte{7}, 3*dhTestPart)
	dir, ix := f.stage(map[string][]byte{dhPubOverworld: zeros}, nil, dhPubTime1)
	if len(ix.Levels[0].Parts) != 3 || ix.Levels[0].Parts[0] != ix.Levels[0].Parts[2] {
		t.Fatalf("fixture parts = %+v", ix.Levels[0].Parts)
	}
	res, err := f.publish(dir)
	if err != nil {
		t.Fatal(err)
	}
	if res.PartsUploaded != 1 || res.BytesSent != dhTestPart {
		t.Errorf("result = %+v, want the one distinct part sent once", res)
	}
	if n := len(ofKind(f.wire(), wireReq.isCopy)); n != 3 {
		t.Errorf("%d copies, want one per occurrence", n)
	}
	if !bytes.Equal(f.bucket.object(assembledKey(dhPubCreated1, dhPubOverworld)), zeros) {
		t.Error("the assembled object is not the database")
	}
}

// A part that is not staged is fine when the bucket has it at the right size.
func TestDHPublishUnstagedPartIsFineIfInBucket(t *testing.T) {
	f := newDHPublishFixture(t)
	dbs := dhPubDBs()
	dir1, ix1 := f.stage(dbs, nil, dhPubTime1)
	// The first snapshot's parts reach the bucket by another route (a cut-off
	// publish), but no latest.json names them.
	for _, l := range ix1.Levels {
		for _, part := range l.Parts {
			f.bucket.put(partKey(part.SHA256), dbs[l.Folder][partOffset(l, part):][:part.Size])
		}
	}
	// A second snapshot staged against the first has nothing staged for them.
	dir2, _ := f.stage(dbs, &ix1, dhPubTime2)
	_ = dir1
	res, err := f.publish(dir2)
	if err != nil || res.PartsUploaded != 0 || res.PartsSkipped != 6 || res.LevelsAssembled != 2 {
		t.Fatalf("result = %+v (%v)", res, err)
	}
	var heads int
	for _, r := range f.wire() {
		if r.Method == http.MethodHead && strings.Contains(r.Key, "/parts/") {
			heads++
		}
	}
	if heads != 6 {
		t.Errorf("%d HEADs of parts, want one for each part that is neither staged nor named by a previous index", heads)
	}
}

// --- a part that is neither staged nor up ---

func TestDHPublishPartNeitherStagedNorUpFailsBeforeAnythingIsSent(t *testing.T) {
	for name, setup := range map[string]func(f *dhPublishFixture, ix1 DHIndex, dbs map[string][]byte){
		"absent from the bucket": func(*dhPublishFixture, DHIndex, map[string][]byte) {},
		"in the bucket at another size": func(f *dhPublishFixture, ix1 DHIndex, _ map[string][]byte) {
			f.bucket.put(partKey(ix1.Levels[1].Parts[0].SHA256), []byte("short"))
		},
	} {
		t.Run(name, func(t *testing.T) {
			f := newDHPublishFixture(t)
			dbs := dhPubDBs()
			_, ix1 := f.stage(dbs, nil, dhPubTime1)
			// The second snapshot was staged against the first, whose publish never
			// happened: only the changed part is staged, and the rest is nowhere.
			dbs2 := dhPubDBs()
			dbs2[dhPubOverworld] = append([]byte(nil), dbs2[dhPubOverworld]...)
			dbs2[dhPubOverworld][5] ^= 0xFF
			dir2, _ := f.stage(dbs2, &ix1, dhPubTime2)
			setup(f, ix1, dbs)

			res, err := f.publish(dir2)
			if err == nil {
				t.Fatal("a snapshot with parts nowhere was published")
			}
			for _, want := range []string{"neither staged nor in the bucket", "run the snapshot again"} {
				if !strings.Contains(err.Error(), want) {
					t.Errorf("err = %q, want %q", err, want)
				}
			}
			for _, r := range f.wire() {
				if r.Method != http.MethodHead && r.Method != http.MethodGet {
					t.Errorf("%s %s: nothing but reads may precede the refusal", r.Method, r.Key)
				}
			}
			if res.PartsUploaded != 0 || len(f.bucket.keys()) > 1 {
				t.Errorf("result %+v, objects %v", res, f.bucket.keys())
			}
			if _, ok := f.bucket.snapshot()["dh/latest.json"]; ok {
				t.Error("latest.json was written")
			}
		})
	}
}

// --- failure during the assembly ---

func TestDHPublishAssemblyFailureLeavesLatestAlone(t *testing.T) {
	for name, failAt := range map[string]struct {
		op string
		n  int
	}{
		"a copy part-way through the first level": {"copy", 3},
		"a copy of the second level":              {"copy", 6},
		"the complete of the first level":         {"complete", 1},
	} {
		t.Run(name, func(t *testing.T) {
			f := newDHPublishFixture(t)
			dir, _ := f.stage(dhPubDBs(), nil, dhPubTime1)
			f.bucket.setFailMultipart(func(op string, n int) (int, string) {
				if op == failAt.op && n == failAt.n {
					return http.StatusForbidden, "AccessDenied"
				}
				return 0, ""
			})

			res, err := f.publish(dir)
			if err == nil {
				t.Fatal("the failure was not reported")
			}
			if strings.Contains(err.Error(), testSecret) || !strings.Contains(err.Error(), "AccessDenied") {
				t.Errorf("err = %q", err)
			}
			reqs := f.wire()
			aborts := ofKind(reqs, wireReq.isAbort)
			if len(aborts) != 1 {
				t.Fatalf("%d aborts, want one for the upload that failed", len(aborts))
			}
			if n := f.bucket.openUploads(); n != 0 {
				t.Errorf("%d uploads left open: a half-built one would be billed", n)
			}
			if aborts[0].Query.Get("uploadId") == "" {
				t.Error("the abort names no upload")
			}
			for _, k := range []string{"dh/latest.json", "dh/snapshots/" + dhPubCreated1 + "/index.json", "dh/snapshots/" + dhPubCreated1 + "/index.html"} {
				if _, ok := f.bucket.snapshot()[k]; ok {
					t.Errorf("%s was written after a failed assembly", k)
				}
			}
			if res.URL != "" {
				t.Errorf("a failed run reports the url %q", res.URL)
			}
			if failAt.op == "copy" && failAt.n == 3 && res.LevelsAssembled != 0 {
				t.Errorf("levels assembled = %d", res.LevelsAssembled)
			}
			if failAt.n == 6 && res.LevelsAssembled != 1 {
				t.Errorf("levels assembled = %d, want the first only", res.LevelsAssembled)
			}
		})
	}
}

func TestDHPublishAbortFailureIsReportedBesideTheFirstError(t *testing.T) {
	f := newDHPublishFixture(t)
	dir, _ := f.stage(dhPubDBs(), nil, dhPubTime1)
	f.bucket.setFailMultipart(func(op string, n int) (int, string) {
		switch op {
		case "copy":
			return http.StatusForbidden, "AccessDenied"
		case "abort":
			return http.StatusForbidden, "AbortDenied"
		}
		return 0, ""
	})
	_, err := f.publish(dir)
	if err == nil || !strings.Contains(err.Error(), "AccessDenied") || !strings.Contains(err.Error(), "could not be aborted either") || !strings.Contains(err.Error(), "AbortDenied") {
		t.Fatalf("err = %v", err)
	}
	if strings.Contains(err.Error(), testSecret) || strings.Contains(err.Error(), "\n") {
		t.Errorf("err = %q", err)
	}
}

func TestDHPublishACancelledRunStillAbortsItsOpenUpload(t *testing.T) {
	f := newDHPublishFixture(t)
	dir, _ := f.stage(dhPubDBs(), nil, dhPubTime1)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	f.bucket.setFailMultipart(func(op string, n int) (int, string) {
		if op == "copy" && n == 2 {
			cancel()
		}
		return 0, ""
	})
	f.plan.StageDir = dir
	_, err := runDHPublish(ctx, f.plan)
	if err == nil {
		t.Fatal("a cancelled run reported success")
	}
	if n := len(ofKind(f.wire(), wireReq.isAbort)); n != 1 || f.bucket.openUploads() != 0 {
		t.Errorf("%d aborts, %d uploads open: the abort has to outlive the run's own context", n, f.bucket.openUploads())
	}
	if _, ok := f.bucket.snapshot()["dh/latest.json"]; ok {
		t.Error("latest.json was written")
	}
}

// --- what is refused before anything is sent ---

func TestDHPublishRefusesBeforeSendingAnything(t *testing.T) {
	tests := []struct {
		name  string
		setup func(t *testing.T, f *dhPublishFixture, dir string, ix DHIndex)
		want  []string
	}{
		{"no staged index", func(t *testing.T, _ *dhPublishFixture, dir string, _ DHIndex) {
			if err := os.Remove(filepath.Join(dir, dhIndexFile)); err != nil {
				t.Fatal(err)
			}
		}, []string{"no index.json", "run a Distant Horizons snapshot first"}},
		{"an index that is not json", func(t *testing.T, _ *dhPublishFixture, dir string, _ DHIndex) {
			dhWrite(t, dir, dhIndexFile, []byte("<html>"))
		}, []string{"index.json", "parse index"}},
		{"an index that is a folder", func(t *testing.T, _ *dhPublishFixture, dir string, _ DHIndex) {
			if err := os.Remove(filepath.Join(dir, dhIndexFile)); err != nil {
				t.Fatal(err)
			}
			if err := os.Mkdir(filepath.Join(dir, dhIndexFile), 0o755); err != nil {
				t.Fatal(err)
			}
		}, []string{"not a regular file"}},
		{"an index too large to read back", func(t *testing.T, _ *dhPublishFixture, dir string, _ DHIndex) {
			dhWrite(t, dir, dhIndexFile, bytes.Repeat([]byte(" "), s3GetBodyLimit+1))
		}, []string{"over the", "a snapshot index may be"}},
		{"an index with no levels", func(t *testing.T, _ *dhPublishFixture, dir string, ix DHIndex) {
			ix.Levels = []DHIndexLevel{}
			rewriteIndex(t, dir, ix)
		}, []string{"no levels"}},
		{"a layout the keys do not match", func(t *testing.T, _ *dhPublishFixture, dir string, ix DHIndex) {
			ix.PartsBase = "../../../parts/"
			rewriteIndex(t, dir, ix)
		}, []string{"different layout", "../../../parts/"}},
		{"a part whose name is a path", func(t *testing.T, _ *dhPublishFixture, dir string, ix DHIndex) {
			ix.Levels[0].Parts[1].SHA256 = "../../../../etc/passwd"
			rewriteIndex(t, dir, ix)
		}, []string{"not a sha256"}},
		{"a level folder that is a path", func(t *testing.T, _ *dhPublishFixture, dir string, ix DHIndex) {
			ix.Levels[0].Folder = "../escape"
			rewriteIndex(t, dir, ix)
		}, []string{"level folder"}},
		{"a staged part of the wrong size", func(t *testing.T, _ *dhPublishFixture, dir string, ix DHIndex) {
			dhWrite(t, dir, "parts/"+ix.Levels[0].Parts[0].SHA256, []byte("truncated"))
		}, []string{"staged part", "run the snapshot again"}},
		{"a createdAt that is not a time", func(t *testing.T, _ *dhPublishFixture, dir string, ix DHIndex) {
			ix.CreatedAt = "last week"
			rewriteIndex(t, dir, ix)
		}, []string{"createdAt"}},
		{"a latest.json that points out of its folder", func(t *testing.T, f *dhPublishFixture, _ string, _ DHIndex) {
			f.bucket.put("dh/latest.json", []byte(`{"format":1,"createdAt":"x","index":"../../etc/index.json"}`))
		}, []string{"cannot read the previous snapshot", "'..'"}},
		{"a latest.json that is an absolute URL", func(t *testing.T, f *dhPublishFixture, _ string, _ DHIndex) {
			f.bucket.put("dh/latest.json", []byte(`{"format":1,"createdAt":"x","index":"https://evil.example/index.json"}`))
		}, []string{"cannot read the previous snapshot", "scheme"}},
		{"a latest.json that is an absolute path", func(t *testing.T, f *dhPublishFixture, _ string, _ DHIndex) {
			f.bucket.put("dh/latest.json", []byte(`{"format":1,"createdAt":"x","index":"/index.json"}`))
		}, []string{"cannot read the previous snapshot", "relative"}},
		{"a latest.json that names a missing index", func(t *testing.T, f *dhPublishFixture, _ string, _ DHIndex) {
			f.bucket.put("dh/latest.json", []byte(`{"format":1,"createdAt":"x","index":"snapshots/gone/index.json"}`))
		}, []string{"cannot read the previous snapshot", "not in the bucket"}},
		{"the bucket refusing the read", func(t *testing.T, f *dhPublishFixture, _ string, _ DHIndex) {
			f.bucket.setFailGet(func(string) (int, string) { return http.StatusForbidden, "AccessDenied" })
		}, []string{"cannot read the previous snapshot", "403"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			f := newDHPublishFixture(t)
			dir, ix := f.stage(dhPubDBs(), nil, dhPubTime1)
			tc.setup(t, f, dir, ix)
			f.reset()

			_, err := f.publish(dir)
			if err == nil {
				t.Fatal("the publish was not refused")
			}
			for _, w := range tc.want {
				if !strings.Contains(err.Error(), w) {
					t.Errorf("err = %q, want it to contain %q", err, w)
				}
			}
			if strings.Contains(err.Error(), testSecret) {
				t.Errorf("err carries the secret: %q", err)
			}
			for _, r := range f.wire() {
				if r.Method != http.MethodGet {
					t.Errorf("%s %s was sent before the refusal", r.Method, r.Key)
				}
			}
			if _, ok := f.bucket.snapshot()["dh/snapshots/"+dhPubCreated1+"/index.json"]; ok {
				t.Error("an index was written")
			}
		})
	}
}

func rewriteIndex(t *testing.T, dir string, ix DHIndex) {
	t.Helper()
	data, err := ix.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	dhWrite(t, dir, dhIndexFile, data)
}

func TestDHPublishRefusesAStagedPartThatIsALink(t *testing.T) {
	f := newDHPublishFixture(t)
	dir, ix := f.stage(dhPubDBs(), nil, dhPubTime1)
	target := filepath.Join(t.TempDir(), "secret.txt")
	if err := os.WriteFile(target, bytes.Repeat([]byte("s"), dhTestPart), 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "parts", ix.Levels[0].Parts[0].SHA256)
	if err := os.Remove(link); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symlinks unavailable here: %v", err)
	}
	_, err := f.publish(dir)
	if err == nil || !strings.Contains(err.Error(), "not a regular file") {
		t.Fatalf("err = %v", err)
	}
	if n := len(f.bucket.keys()); n != 0 {
		t.Errorf("%d objects were written: a link must not be followed out of the staged folder", n)
	}
}

func TestDHPublishFailedPartUploadStopsTheRunBeforeAssembly(t *testing.T) {
	f := newDHPublishFixture(t)
	dir, _ := f.stage(dhPubDBs(), nil, dhPubTime1)
	f.bucket.setFail(func(_ string, puts int) (int, string) {
		if puts == 3 {
			return http.StatusForbidden, "AccessDenied"
		}
		return 0, ""
	})
	res, err := f.publish(dir)
	if err == nil || !strings.Contains(err.Error(), "refused the upload") || strings.Contains(err.Error(), testSecret) {
		t.Fatalf("err = %v", err)
	}
	if res.PartsUploaded != 2 || res.LevelsAssembled != 0 {
		t.Errorf("result = %+v", res)
	}
	if n := len(ofKind(f.wire(), wireReq.isMultipart)); n != 0 {
		t.Errorf("%d multipart requests after a failed part", n)
	}
}

func TestDHPublishResumesAfterACutOffRun(t *testing.T) {
	f := newDHPublishFixture(t)
	dir, _ := f.stage(dhPubDBs(), nil, dhPubTime1)
	f.bucket.setFail(func(_ string, puts int) (int, string) {
		if puts == 4 {
			return http.StatusForbidden, "AccessDenied"
		}
		return 0, ""
	})
	if _, err := f.publish(dir); err == nil {
		t.Fatal("the first run did not fail")
	}
	f.bucket.setFail(nil)
	f.reset()
	res, err := f.publish(dir)
	if err != nil {
		t.Fatal(err)
	}
	if res.PartsUploaded != 3 || res.PartsSkipped != 3 || res.LevelsAssembled != 2 {
		t.Errorf("result = %+v: the three parts already sent are skipped, the other three sent", res)
	}
	if _, ok := f.bucket.snapshot()["dh/latest.json"]; !ok {
		t.Error("latest.json was not written by the resumed run")
	}
}

func TestDHPublishNeverWritesToTheStagedFolder(t *testing.T) {
	f := newDHPublishFixture(t)
	dir, _ := f.stage(dhPubDBs(), nil, dhPubTime1)
	before := dirListing(t, dir)
	if _, err := f.publish(dir); err != nil {
		t.Fatal(err)
	}
	if after := dirListing(t, dir); !slices.Equal(before, after) {
		t.Errorf("the staged folder changed:\nbefore %v\nafter  %v", before, after)
	}
}

func dirListing(t *testing.T, dir string) []string {
	t.Helper()
	var out []string
	err := filepath.Walk(dir, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		out = append(out, fmt.Sprintf("%s %d %s", p, info.Size(), info.ModTime().Format(time.RFC3339Nano)))
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestDHPublishProgressIsNarratedNoMoreOftenThanTheInterval(t *testing.T) {
	progress := func(f *dhPublishFixture) int {
		n := 0
		for _, l := range f.narration {
			if strings.HasPrefix(l, "Upload: ") || strings.HasPrefix(l, "Assembling ") && strings.Contains(l, " copied") {
				n++
			}
		}
		return n
	}
	f := newDHPublishFixture(t)
	dir, _ := f.stage(dhPubDBs(), nil, dhPubTime1)
	if _, err := f.publish(dir); err != nil {
		t.Fatal(err)
	}
	if n := progress(f); n != 0 {
		t.Errorf("%d progress lines inside the interval, want only the start and end lines", n)
	}

	old := uploadProgressEvery
	uploadProgressEvery = 0
	t.Cleanup(func() { uploadProgressEvery = old })
	f = newDHPublishFixture(t)
	dir, _ = f.stage(dhPubDBs(), nil, dhPubTime1)
	if _, err := f.publish(dir); err != nil {
		t.Fatal(err)
	}
	if n := progress(f); n == 0 {
		t.Errorf("no progress lines with a zero interval:\n%s", f.narrated())
	}
}

func TestDHPublishSecretIsInNoErrorOrNarration(t *testing.T) {
	f := newDHPublishFixture(t)
	dir, _ := f.stage(dhPubDBs(), nil, dhPubTime1)
	f.bucket.setFailMultipart(func(op string, n int) (int, string) {
		if op == "create" {
			return http.StatusForbidden, "SignatureDoesNotMatch"
		}
		return 0, ""
	})
	_, err := f.publish(dir)
	if err == nil {
		t.Fatal("expected a failure")
	}
	if strings.Contains(err.Error(), testSecret) || strings.Contains(f.narrated(), testSecret) {
		t.Errorf("secret leaked:\n%v\n%s", err, f.narrated())
	}
	if !strings.Contains(err.Error(), "redacted") {
		t.Errorf("the echoed secret was dropped rather than marked: %v", err)
	}
}

// --- the index check ---

func TestCheckDHIndexForPublish(t *testing.T) {
	good := func() DHIndex {
		return DHIndex{
			Format: 1, CreatedAt: "2026-10-11T04:00:00Z", PartsBase: "../../parts/", ServerFolder: "42_frang",
			Levels: []DHIndexLevel{{
				Folder: dhPubOverworld, Size: 2*dhTestPart + 10, SHA256: strings.Repeat("a", 64),
				Parts: []DHPart{{strings.Repeat("b", 64), dhTestPart}, {strings.Repeat("c", 64), dhTestPart}, {strings.Repeat("d", 64), 10}},
			}},
		}
	}
	if created, err := checkDHIndexForPublish(good()); err != nil || !created.Equal(dhPubTime1) {
		t.Fatalf("a good index: (%v, %v)", created, err)
	}
	tests := []struct {
		name   string
		mutate func(ix *DHIndex)
		want   string
	}{
		{"no levels", func(ix *DHIndex) { ix.Levels = nil }, "no levels"},
		{"a bad time", func(ix *DHIndex) { ix.CreatedAt = "x" }, "createdAt"},
		{"a bad server folder", func(ix *DHIndex) { ix.ServerFolder = "a/b" }, "serverFolder"},
		{"an empty server folder", func(ix *DHIndex) { ix.ServerFolder = "" }, "serverFolder"},
		{"a folder with a slash", func(ix *DHIndex) { ix.Levels[0].Folder = "a/b" }, "level folder"},
		{"a folder with a colon", func(ix *DHIndex) { ix.Levels[0].Folder = "a:b" }, "level folder"},
		{"a dot folder", func(ix *DHIndex) { ix.Levels[0].Folder = ".." }, "level folder"},
		{"a repeated folder", func(ix *DHIndex) { ix.Levels = append(ix.Levels, ix.Levels[0]) }, "listed twice"},
		{"no parts", func(ix *DHIndex) { ix.Levels[0].Parts = nil }, "no parts"},
		{"no whole hash", func(ix *DHIndex) { ix.Levels[0].SHA256 = "" }, "whole-file"},
		{"an upper case part name", func(ix *DHIndex) { ix.Levels[0].Parts[0].SHA256 = strings.Repeat("B", 64) }, "not a sha256"},
		{"a zero size part", func(ix *DHIndex) { ix.Levels[0].Parts[2].Size = 0 }, "has size 0"},
		{"parts of unequal length", func(ix *DHIndex) { ix.Levels[0].Parts[1].Size = dhTestPart - 1; ix.Levels[0].Size-- }, "same length"},
		{"a total that does not add up", func(ix *DHIndex) { ix.Levels[0].Size++ }, "add up"},
		{"more parts than one upload takes", func(ix *DHIndex) {
			l := &ix.Levels[0]
			l.Parts = make([]DHPart, s3MaxMultipartParts+1)
			for i := range l.Parts {
				l.Parts[i] = DHPart{strings.Repeat("e", 64), 1}
			}
			l.Size = int64(len(l.Parts))
		}, "over the 10000"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ix := good()
			tc.mutate(&ix)
			if _, err := checkDHIndexForPublish(ix); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("err = %v, want it to contain %q", err, tc.want)
			}
		})
	}
}
