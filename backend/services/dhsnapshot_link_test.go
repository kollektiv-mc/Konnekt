package services

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/xml"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"konnekt/backend/models"
)

// ─── The private snapshot link (#561) ──────────────────────────────────────
//
// The token and its file are tested here, then the three operations against the
// in-memory bucket of upload_test.go: a snapshot is really published, moved and
// read back, so what is asserted is the bucket's content and the order of the
// requests and not canned answers.

// --- the token ---

type failingReader struct{ err error }

func (r failingReader) Read([]byte) (int, error) { return 0, r.err }

func TestDHLinkTokenIs128BitsOfLowercaseBase32(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 2000; i++ {
		tok, err := newDHLinkToken(nil)
		if err != nil {
			t.Fatal(err)
		}
		if len(tok) != 26 || !reDHLinkToken.MatchString(tok) {
			t.Fatalf("token %q: want 26 characters of [a-z2-7]", tok)
		}
		if !reDHToken.MatchString(tok) {
			t.Fatalf("token %q is refused by snapshotKeys", tok)
		}
		if seen[tok] {
			t.Fatalf("token %q was made twice", tok)
		}
		seen[tok] = true
	}
}

func TestDHLinkTokenEncodesExactlyTheBytesItReads(t *testing.T) {
	// 16 zero bytes are 26 'a's in base32; 16 0xff bytes end in the padding bits.
	zero, err := newDHLinkToken(bytes.NewReader(make([]byte, 16)))
	if err != nil || zero != strings.Repeat("a", 26) {
		t.Errorf("zero bytes: %q, %v", zero, err)
	}
	full, err := newDHLinkToken(bytes.NewReader(bytes.Repeat([]byte{0xff}, 16)))
	if err != nil || len(full) != 26 || !reDHLinkToken.MatchString(full) {
		t.Errorf("0xff bytes: %q, %v", full, err)
	}
}

func TestDHLinkTokenReadFailureIsAnErrorNeverAFallback(t *testing.T) {
	boom := errors.New("entropy source gone")
	tok, err := newDHLinkToken(failingReader{boom})
	if err == nil || !errors.Is(err, boom) || tok != "" {
		t.Errorf("token %q, err %v: a failed read must be an error with no token", tok, err)
	}
	if tok, err = newDHLinkToken(bytes.NewReader([]byte{1, 2, 3})); err == nil || tok != "" {
		t.Errorf("a short read gave %q, %v", tok, err)
	}

	// Through the service: nothing is generated, nothing recorded, nothing moved.
	f := newLinkFixture(t)
	f.dests.randSource = failingReader{boom}
	f.publishPublic()
	f.reset()
	if _, err := f.dests.SetSnapshotLinkPrivate(context.Background(), f.dest.ID, true); err == nil || !strings.Contains(err.Error(), "generate a link token") {
		t.Fatalf("err = %v", err)
	}
	if n := len(f.bucket.recorded()); n != 0 {
		t.Errorf("%d requests went out after the token failed", n)
	}
	if tok, _ := f.dests.LinkToken(f.dest.ID); tok != "" {
		t.Errorf("token = %q after a failed generation", tok)
	}
}

// --- the file ---

func TestDHLinkFileIsOwnerOnlyBesideTheSecretAndNowhereElse(t *testing.T) {
	f := newLinkFixture(t)
	f.publishPublic()
	if _, err := f.dests.SetSnapshotLinkPrivate(context.Background(), f.dest.ID, true); err != nil {
		t.Fatal(err)
	}
	tok, err := f.dests.LinkToken(f.dest.ID)
	if err != nil || tok == "" {
		t.Fatalf("token %q, %v", tok, err)
	}
	path := filepath.Join(f.dests.dataDir, destinationSecretsDir, f.dest.ID+destinationLinkExt)
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0600 {
		t.Errorf("link file mode = %o, want 0600", info.Mode().Perm())
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var rec struct{ Token, Pending, Prefix string }
	if err := json.Unmarshal(data, &rec); err != nil || rec.Token != tok || rec.Pending != "" || rec.Prefix != "dh" {
		t.Errorf("link file = %s (%v)", data, err)
	}

	// No other file under the data dir holds it, and neither does anything a
	// listing returns.
	err = filepath.WalkDir(f.dests.dataDir, func(p string, d os.DirEntry, werr error) error {
		if werr != nil || d.IsDir() || p == path {
			return werr
		}
		b, rerr := os.ReadFile(p)
		if rerr != nil {
			return rerr
		}
		if strings.Contains(string(b), tok) {
			t.Errorf("%s holds the token", p)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	list, err := f.dests.List()
	if err != nil || len(list) != 1 || !list[0].PrivateLink {
		t.Fatalf("List = %+v, %v: PrivateLink must say the mode", list, err)
	}
	raw, err := json.Marshal(list)
	if err != nil || strings.Contains(string(raw), tok) {
		t.Errorf("the listing carries the token: %s", raw)
	}
	// Saving the destination again, as the form does, keeps the mode and writes
	// the flag nowhere.
	saved := mustSave(t, f.dests, list[0], "")
	if !saved.PrivateLink {
		t.Error("Save dropped the mode")
	}
	stored, err := os.ReadFile(filepath.Join(f.dests.dataDir, destinationsFile))
	if err != nil || strings.Contains(string(stored), "privateLink\": true") || strings.Contains(string(stored), tok) {
		t.Errorf("destinations.json = %s (%v)", stored, err)
	}
	forged := list[0]
	forged.PrivateLink = false
	if got := mustSave(t, f.dests, forged, ""); !got.PrivateLink {
		t.Error("a Save claiming the destination is public made it so")
	}
}

func TestDHLinkDeleteRemovesTheLinkFileWithTheSecret(t *testing.T) {
	f := newLinkFixture(t)
	if _, err := f.dests.SetSnapshotLinkPrivate(context.Background(), f.dest.ID, true); err != nil {
		t.Fatal(err)
	}
	if err := f.dests.Delete(f.dest.ID); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(filepath.Join(f.dests.dataDir, destinationSecretsDir))
	if err != nil || len(entries) != 0 {
		t.Errorf("secrets dir = %v (%v), want it empty", entries, err)
	}
	// A move that outlives the delete cannot bring the file back.
	if err := f.dests.RecordLinkPrefix(f.dest.ID, "dh"); err == nil {
		t.Error("RecordLinkPrefix wrote a link for a deleted destination")
	}
	if _, err := os.Stat(filepath.Join(f.dests.dataDir, destinationSecretsDir, f.dest.ID+destinationLinkExt)); err == nil {
		t.Error("the link file is back")
	}
}

func TestDHLinkDamagedFileIsAnErrorNotPublic(t *testing.T) {
	f := newLinkFixture(t)
	path := filepath.Join(f.dests.dataDir, destinationSecretsDir, f.dest.ID+destinationLinkExt)
	for name, body := range map[string]string{
		"not json":           "{",
		"a token not ours":   `{"token":"../../etc","prefix":"dh"}`,
		"a pending not ours": `{"pending":"UPPERCASE","prefix":"dh"}`,
		"a climbing prefix":  `{"prefix":"../x"}`,
		"a stale token":      `{"stale":[{"token":"nope","prefix":"dh"}]}`,
	} {
		t.Run(name, func(t *testing.T) {
			if err := os.WriteFile(path, []byte(body), 0600); err != nil {
				t.Fatal(err)
			}
			if tok, err := f.dests.LinkToken(f.dest.ID); err == nil || tok != "" {
				t.Errorf("LinkToken = %q, %v: a damaged file must not read as public", tok, err)
			}
			if _, err := f.dests.SetSnapshotLinkPrivate(context.Background(), f.dest.ID, true); err == nil {
				t.Error("a mode change went ahead on a damaged file")
			}
			if _, err := f.dests.GetSnapshotLink(f.dest.ID); err == nil {
				t.Error("GetSnapshotLink answered from a damaged file")
			}
			list, err := f.dests.List()
			if err != nil || len(list) != 1 || list[0].PrivateLink {
				t.Errorf("List = %+v, %v", list, err)
			}
		})
	}
	if _, err := f.dests.LinkToken("../x"); err == nil {
		t.Error("LinkToken accepted an id that is a path")
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if tok, err := f.dests.LinkToken(f.dest.ID); err != nil || tok != "" {
		t.Errorf("no file: token %q, %v, want public", tok, err)
	}
}

func TestDHLinkRecordLinkPrefix(t *testing.T) {
	f := newLinkFixture(t)
	if err := f.dests.RecordLinkPrefix(f.dest.ID, "/dh//snap/"); err != nil {
		t.Fatal(err)
	}
	rec := f.record()
	if rec.Prefix != "dh/snap" || rec.Token != "" {
		t.Errorf("record = %+v", rec)
	}
	if err := f.dests.RecordLinkPrefix(f.dest.ID, "../x"); err == nil {
		t.Error("a climbing prefix was recorded")
	}
	if err := f.dests.RecordLinkPrefix("0123456789abcdef", "dh"); err == nil {
		t.Error("a prefix was recorded for a destination that does not exist")
	}
	// Recording the same prefix again writes nothing.
	path := filepath.Join(f.dests.dataDir, destinationSecretsDir, f.dest.ID+destinationLinkExt)
	before, _ := os.Stat(path)
	time.Sleep(10 * time.Millisecond)
	if err := f.dests.RecordLinkPrefix(f.dest.ID, "dh/snap"); err != nil {
		t.Fatal(err)
	}
	after, _ := os.Stat(path)
	if !after.ModTime().Equal(before.ModTime()) {
		t.Error("an unchanged prefix rewrote the file")
	}
}

// --- the fixture ---

type linkFixture struct {
	*dhPublishFixture
	dests *DestinationService
	dest  models.Destination
}

func newLinkFixture(t *testing.T) *linkFixture {
	t.Helper()
	pf := newDHPublishFixture(t)
	dests := NewDestinationService()
	dests.SetDataDir(t.TempDir())
	dests.httpClient = pf.bucket.Client()
	dests.retryBase = time.Millisecond
	dest := mustSave(t, dests, models.Destination{
		Name: "R2", Endpoint: pf.bucket.URL, Region: "auto", Bucket: "snapshots",
		Prefix: "dh", AccessKeyID: "AKIATESTKEY",
	}, testSecret)
	return &linkFixture{dhPublishFixture: pf, dests: dests, dest: dest}
}

// publishPublic publishes the two-level snapshot at dhPubTime1 under the public
// layout and records where, as the block does.
func (f *linkFixture) publishPublic() DHIndex {
	f.t.Helper()
	dir, ix := f.stage(dhPubDBs(), nil, dhPubTime1)
	if _, err := f.publish(dir); err != nil {
		f.t.Fatal(err)
	}
	if err := f.dests.RecordLinkPrefix(f.dest.ID, "dh"); err != nil {
		f.t.Fatal(err)
	}
	return ix
}

func (f *linkFixture) record() dhLinkRecord {
	f.t.Helper()
	f.dests.mu.Lock()
	defer f.dests.mu.Unlock()
	rec, err := f.dests.readLinkLocked(f.dest.ID)
	if err != nil {
		f.t.Fatal(err)
	}
	return rec
}

func (f *linkFixture) token() string {
	f.t.Helper()
	tok, err := f.dests.LinkToken(f.dest.ID)
	if err != nil {
		f.t.Fatal(err)
	}
	return tok
}

func (f *linkFixture) set(private bool) (models.SnapshotLinkResult, error) {
	return f.dests.SetSnapshotLinkPrivate(context.Background(), f.dest.ID, private)
}

func (f *linkFixture) rotate() (models.SnapshotLinkResult, error) {
	return f.dests.RotateSnapshotLink(context.Background(), f.dest.ID)
}

func (f *linkFixture) has(key string) bool {
	_, ok := f.bucket.snapshot()[key]
	return ok
}

func (f *linkFixture) drop(key string) {
	f.bucket.mu.Lock()
	defer f.bucket.mu.Unlock()
	delete(f.bucket.objects, key)
}

// base is the key prefix of a layout: dh for the public one, dh/<token> for a
// private one.
func base(token string) string {
	if token == "" {
		return "dh"
	}
	return "dh/" + token
}

func snapshotFile(token, name string) string {
	return base(token) + "/snapshots/" + dhPubCreated1 + "/" + name
}

// assertSnapshotAt checks that the whole latest snapshot is readable under the
// layout token names: the pointer, the index with the right partsBase, the page,
// and each level's database byte for byte.
func (f *linkFixture) assertSnapshotAt(token string) {
	f.t.Helper()
	latest, err := parseDHLatest(f.bucket.object(base(token) + "/latest.json"))
	if err != nil {
		f.t.Fatalf("latest.json under %q: %v", base(token), err)
	}
	if want := "snapshots/" + dhPubCreated1 + "/index.json"; latest.Index != want {
		f.t.Errorf("latest.json points at %q, want %q", latest.Index, want)
	}
	ix, err := parseDHIndex(f.bucket.object(snapshotFile(token, "index.json")))
	if err != nil {
		f.t.Fatal(err)
	}
	want := "../../parts/"
	if token != "" {
		want = "../../../parts/"
	}
	if ix.PartsBase != want {
		f.t.Errorf("partsBase = %q, want %q", ix.PartsBase, want)
	}
	if latest.CreatedAt != ix.CreatedAt || ix.CreatedAt != formatDHCreatedAt(dhPubTime1) {
		f.t.Errorf("createdAt: latest %q, index %q", latest.CreatedAt, ix.CreatedAt)
	}
	page, err := renderDHPage(ix)
	if err != nil {
		f.t.Fatal(err)
	}
	if !bytes.Equal(f.bucket.object(snapshotFile(token, "index.html")), page) {
		f.t.Error("the page is not the one rendered for the index")
	}
	if f.bucket.contentType(snapshotFile(token, "index.html")) != "text/html; charset=utf-8" {
		f.t.Errorf("the page's content type is %q", f.bucket.contentType(snapshotFile(token, "index.html")))
	}
	dbs := dhPubDBs()
	for _, l := range ix.Levels {
		if !bytes.Equal(f.bucket.object(snapshotFile(token, l.Folder+"/"+dhDatabaseName)), dbs[l.Folder]) {
			f.t.Errorf("level %s under %q is not the database", l.Folder, base(token))
		}
		for _, p := range l.Parts {
			if len(f.bucket.object("dh/parts/"+p.SHA256)) == 0 {
				f.t.Errorf("part %s is gone", p.SHA256)
			}
		}
	}
}

// assertNothingAt checks that no object of the layout token names is left.
func (f *linkFixture) assertNothingAt(token string) {
	f.t.Helper()
	for k := range f.bucket.snapshot() {
		if token == "" {
			if k == "dh/latest.json" || strings.HasPrefix(k, "dh/snapshots/") {
				f.t.Errorf("%s is still in the bucket", k)
			}
		} else if strings.HasPrefix(k, "dh/"+token+"/") {
			f.t.Errorf("%s is still in the bucket", k)
		}
	}
}

// wireLabel is one request in words, for asserting an order.
func wireLabel(r wireReq) string {
	switch {
	case r.Method == http.MethodGet && r.Query.Has("list-type"):
		return "list " + r.Query.Get("prefix")
	case r.Method == http.MethodPost && r.Query.Has("delete"):
		var doc struct {
			Objects []struct{ Key string } `xml:"Object"`
		}
		_ = xml.Unmarshal(r.Body, &doc) //nolint:errcheck // a body that does not parse labels as empty and fails the assertion
		keys := make([]string, len(doc.Objects))
		for i, o := range doc.Objects {
			keys[i] = o.Key
		}
		return "delete " + strings.Join(keys, ",")
	case r.isCreate():
		return "create " + r.Key
	case r.isComplete():
		return "complete " + r.Key
	case r.isCopy():
		return "partcopy " + r.Key
	case r.Method == http.MethodPut && r.Header.Get("X-Amz-Copy-Source") != "":
		return "copy " + r.Key
	}
	return strings.ToLower(r.Method) + " " + r.Key
}

func (f *linkFixture) labels() []string {
	var out []string
	for _, r := range f.wire() {
		out = append(out, wireLabel(r))
	}
	return out
}

// first and last are the positions of the first and last label with the prefix,
// or -1.
func first(labels []string, prefix string) int {
	return slices.IndexFunc(labels, func(l string) bool { return strings.HasPrefix(l, prefix) })
}

func last(labels []string, prefix string) int {
	for i := len(labels) - 1; i >= 0; i-- {
		if strings.HasPrefix(labels[i], prefix) {
			return i
		}
	}
	return -1
}

// --- the move: public to private ---

func TestDHLinkPublicToPrivateMoveOrder(t *testing.T) {
	f := newLinkFixture(t)
	f.publishPublic()
	f.assertSnapshotAt("")
	partsBefore := partKeysOf(f.bucket.snapshot())

	// At the moment the old base is deleted the new token must already be the
	// committed one, and the new link must already answer.
	var tokenAtDelete string
	var newLatestAtDelete bool
	f.bucket.failDelete = func([]string) (int, string) {
		tokenAtDelete = f.token()
		// The handler holds the bucket's lock, so its map is read directly.
		_, newLatestAtDelete = f.bucket.objects["dh/"+tokenAtDelete+"/latest.json"]
		return 0, ""
	}
	f.reset()

	res, err := f.set(true)
	if err != nil {
		t.Fatal(err)
	}
	tok := f.token()
	if !res.Private || res.Link != "" || res.OldLinkStillWorks || !strings.Contains(res.Message, "private link") {
		t.Errorf("result = %+v: the link is never returned by a mode change", res)
	}
	if strings.Contains(res.Message, tok) {
		t.Errorf("the message carries the token: %q", res.Message)
	}
	if len(tok) != 26 || tokenAtDelete != tok || !newLatestAtDelete {
		t.Errorf("token at delete %q (new latest there: %v), token %q", tokenAtDelete, newLatestAtDelete, tok)
	}
	if rec := f.record(); rec.Token != tok || rec.Pending != "" || rec.Prefix != "dh" || len(rec.Stale) != 0 {
		t.Errorf("record = %+v", rec)
	}

	f.assertSnapshotAt(tok)
	f.assertNothingAt("")
	if got := partKeysOf(f.bucket.snapshot()); !slices.Equal(got, partsBefore) {
		t.Errorf("parts changed: %v -> %v", partsBefore, got)
	}

	labels := f.labels()
	newLatest := "put dh/" + tok + "/latest.json"
	order := []string{
		"get dh/latest.json",
		"get dh/snapshots/" + dhPubCreated1 + "/index.json",
		"copy " + snapshotFile(tok, "index.html"),
		"put " + snapshotFile(tok, "index.json"),
		"create " + snapshotFile(tok, dhPubOverworld+"/"+dhDatabaseName),
		"complete " + snapshotFile(tok, dhPubNether+"/"+dhDatabaseName),
		newLatest,
		"list dh/snapshots/",
		"delete dh/latest.json",
	}
	prev := -1
	for _, want := range order {
		at := first(labels, want)
		if at < 0 || at <= prev {
			t.Fatalf("%q is at %d, after %d: the order is wrong:\n%s", want, at, prev, strings.Join(labels, "\n"))
		}
		prev = at
	}
	if at, lastWrite := first(labels, newLatest), last(labels, "put "); at != lastWrite {
		t.Errorf("latest.json is request %d but the last write is %d: it must come last", at, lastWrite)
	}
	if lastComplete := last(labels, "complete "); lastComplete > first(labels, newLatest) {
		t.Error("a level was still being assembled when latest.json was written")
	}
	// No request but the index PUT carries data, and nothing touches a part.
	for _, r := range f.wire() {
		if strings.Contains(r.Key, "/parts/") && r.Method != http.MethodGet && !r.isCopy() {
			t.Errorf("%s %s: a part was touched", r.Method, r.Key)
		}
	}
	// The deletes: the pointer alone first, then the old snapshots folder, never a
	// part and never anything under the new token.
	deletes := ofKind(f.wire(), func(r wireReq) bool { return r.Method == http.MethodPost && r.Query.Has("delete") })
	if len(deletes) != 2 {
		t.Fatalf("%d delete requests, want 2", len(deletes))
	}
	if got := wireLabel(deletes[0]); got != "delete dh/latest.json" {
		t.Errorf("first delete = %s", got)
	}
	for _, k := range strings.Split(strings.TrimPrefix(wireLabel(deletes[1]), "delete "), ",") {
		if !strings.HasPrefix(k, "dh/snapshots/") || strings.Contains(k, tok) {
			t.Errorf("second delete names %s", k)
		}
	}
}

// copiesSoFar is how many UploadPartCopy requests the bucket has seen, so a
// failure can be aimed at the Nth one after now.
func (b *fakeBucket) copiesSoFar() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.multipartOps["copy"]
}

func partKeysOf(objs map[string][]byte) []string {
	var out []string
	for k := range objs {
		if strings.HasPrefix(k, "dh/parts/") {
			out = append(out, k)
		}
	}
	slices.Sort(out)
	return out
}

func TestDHLinkMovedIndexIsTheSameIndexWithOnlyPartsBaseRewritten(t *testing.T) {
	f := newLinkFixture(t)
	orig := f.publishPublic()
	if _, err := f.set(true); err != nil {
		t.Fatal(err)
	}
	moved, err := parseDHIndex(f.bucket.object(snapshotFile(f.token(), "index.json")))
	if err != nil {
		t.Fatal(err)
	}
	if moved.PartsBase != "../../../parts/" || orig.PartsBase != "../../parts/" {
		t.Fatalf("partsBase: moved %q, original %q", moved.PartsBase, orig.PartsBase)
	}
	moved.PartsBase = orig.PartsBase
	a, _ := moved.Marshal()
	b, _ := orig.Marshal()
	if !bytes.Equal(a, b) {
		t.Errorf("the moved index differs from the original beyond partsBase:\n%s\n%s", a, b)
	}
	// The parts the index names resolve from the moved index's own location.
	if _, ok := f.bucket.snapshot()["dh/parts/"+orig.Levels[0].Parts[0].SHA256]; !ok {
		t.Error("a part the moved index names is not where partsBase leads")
	}
}

// A move rebuilds levels from the old file in ranges, and from parts when it is gone.
func TestDHLinkMoveRebuildsLevelsFromRangesOrParts(t *testing.T) {
	shrinkCopyRange(t, 2*dhTestPart)
	f := newLinkFixture(t)
	f.publishPublic()
	// The nether's old file is gone: it must be rebuilt from its parts.
	f.drop(snapshotFile("", dhPubNether+"/"+dhDatabaseName))
	f.reset()
	if _, err := f.set(true); err != nil {
		t.Fatal(err)
	}
	tok := f.token()
	f.assertSnapshotAt(tok)

	over := assembledKey(dhPubCreated1, dhPubOverworld)
	var fromOld, fromParts int
	for _, r := range f.wire() {
		if !r.isCopy() {
			continue
		}
		src := r.Header.Get("X-Amz-Copy-Source")
		switch {
		case r.Key == snapshotFile(tok, dhPubOverworld+"/"+dhDatabaseName):
			if src != "/snapshots/"+s3URIEncode(over, false) || r.Header.Get("X-Amz-Copy-Source-Range") == "" {
				t.Errorf("overworld copy from %q range %q: want ranges of the old file", src, r.Header.Get("X-Amz-Copy-Source-Range"))
			}
			fromOld++
		case r.Key == snapshotFile(tok, dhPubNether+"/"+dhDatabaseName):
			if !strings.HasPrefix(src, "/snapshots/dh/parts/") || r.Header.Get("X-Amz-Copy-Source-Range") != "" {
				t.Errorf("nether copy from %q: want whole parts", src)
			}
			fromParts++
		}
	}
	// 3*1024+100 bytes in 2 KiB ranges is 2 ranges; the nether is 2 parts.
	if fromOld != 2 || fromParts != 2 {
		t.Errorf("%d copies from the old file and %d from parts, want 2 and 2", fromOld, fromParts)
	}
}

func TestDHLinkMoveNeverUsesCopyObjectForADatabase(t *testing.T) {
	f := newLinkFixture(t)
	f.publishPublic()
	f.bucket.mu.Lock()
	f.bucket.copies = nil
	f.bucket.mu.Unlock()
	if _, err := f.set(true); err != nil {
		t.Fatal(err)
	}
	f.bucket.mu.Lock()
	copies := append([]string(nil), f.bucket.copies...)
	f.bucket.mu.Unlock()
	if len(copies) != 1 || copies[0] != snapshotFile(f.token(), "index.html") {
		t.Errorf("CopyObject was used for %v, want only index.html (S3 caps one copy at 5 GiB)", copies)
	}
}

// --- private to public, and rotation ---

func TestDHLinkPrivateToPublicMovesBack(t *testing.T) {
	f := newLinkFixture(t)
	f.publishPublic()
	if _, err := f.set(true); err != nil {
		t.Fatal(err)
	}
	tok := f.token()
	f.reset()
	res, err := f.set(false)
	if err != nil {
		t.Fatal(err)
	}
	if res.Private || res.OldLinkStillWorks || f.token() != "" || !strings.Contains(res.Message, "public") {
		t.Errorf("result = %+v, token %q", res, f.token())
	}
	f.assertSnapshotAt("")
	f.assertNothingAt(tok)
	list, _ := f.dests.List()
	if list[0].PrivateLink {
		t.Error("the listing still says private")
	}
	if rec := f.record(); rec.Token != "" || rec.Prefix != "dh" || len(rec.Stale) != 0 {
		t.Errorf("record = %+v", rec)
	}
	// What was deleted is the old private base and nothing else.
	deletes := ofKind(f.wire(), func(r wireReq) bool { return r.Method == http.MethodPost && r.Query.Has("delete") })
	if len(deletes) != 2 {
		t.Fatalf("%d delete requests, want 2", len(deletes))
	}
	for _, d := range deletes {
		for _, k := range strings.Split(strings.TrimPrefix(wireLabel(d), "delete "), ",") {
			if !strings.HasPrefix(k, "dh/"+tok+"/") {
				t.Errorf("deleted %s, which is not under the old token", k)
			}
		}
	}
}

func TestDHLinkRotateMovesToANewTokenAndRevokesTheOldOne(t *testing.T) {
	f := newLinkFixture(t)
	f.publishPublic()
	if _, err := f.set(true); err != nil {
		t.Fatal(err)
	}
	old := f.token()
	f.reset()
	var tokenAtDelete string
	f.bucket.failDelete = func([]string) (int, string) { tokenAtDelete = f.token(); return 0, "" }

	res, err := f.rotate()
	if err != nil {
		t.Fatal(err)
	}
	tok := f.token()
	if tok == old || len(tok) != 26 || !res.Private || res.OldLinkStillWorks || res.Link != "" {
		t.Errorf("old %q new %q result %+v", old, tok, res)
	}
	if tokenAtDelete != tok {
		t.Errorf("the old base was deleted while the committed token was %q, not %q", tokenAtDelete, tok)
	}
	f.assertSnapshotAt(tok)
	f.assertNothingAt(old)

	labels := f.labels()
	for i, want := range []string{
		"get dh/" + old + "/latest.json",
		"copy " + snapshotFile(tok, "index.html"),
		"put " + snapshotFile(tok, "index.json"),
		"complete " + snapshotFile(tok, dhPubNether+"/"+dhDatabaseName),
		"put dh/" + tok + "/latest.json",
		"list dh/" + old + "/snapshots/",
		"delete dh/" + old + "/latest.json",
	} {
		if at := first(labels, want); at < 0 || (i > 0 && at < first(labels, "get dh/"+old+"/latest.json")) {
			t.Fatalf("%q missing or out of order:\n%s", want, strings.Join(labels, "\n"))
		}
	}
	if first(labels, "put dh/"+tok+"/latest.json") > first(labels, "delete ") {
		t.Error("the old link was deleted before the new one was live")
	}
	if first(labels, "put dh/"+tok+"/latest.json") != last(labels, "put ") {
		t.Error("latest.json is not the last write")
	}
}

func TestDHLinkRotateRefusesAPublicLink(t *testing.T) {
	f := newLinkFixture(t)
	f.publishPublic()
	f.reset()
	_, err := f.rotate()
	if err == nil || !strings.Contains(err.Error(), "public") {
		t.Fatalf("err = %v", err)
	}
	if n := len(f.bucket.recorded()); n != 0 {
		t.Errorf("%d requests went out", n)
	}
	if f.token() != "" {
		t.Error("a refused rotation made the link private")
	}
}

func TestDHLinkSettingTheModeItAlreadyHasMovesNothing(t *testing.T) {
	f := newLinkFixture(t)
	f.publishPublic()
	f.reset()
	res, err := f.set(false)
	if err != nil || res.Private || !strings.Contains(res.Message, "already public") {
		t.Errorf("result = %+v, %v", res, err)
	}
	if n := len(f.bucket.recorded()); n != 0 {
		t.Errorf("%d requests went out for a no-op", n)
	}
	if _, err := f.set(true); err != nil {
		t.Fatal(err)
	}
	tok := f.token()
	f.reset()
	res, err = f.set(true)
	if err != nil || !res.Private || !strings.Contains(res.Message, "already private") || f.token() != tok {
		t.Errorf("result = %+v, %v, token %q (was %q)", res, err, f.token(), tok)
	}
	if n := len(f.bucket.recorded()); n != 0 {
		t.Errorf("%d requests went out for a no-op", n)
	}
}

func TestDHLinkNeverPublishedChangesOnlyTheRecord(t *testing.T) {
	f := newLinkFixture(t)
	res, err := f.set(true)
	if err != nil || !res.Private || !strings.Contains(res.Message, "Nothing has been published here yet") {
		t.Fatalf("result = %+v, %v", res, err)
	}
	if f.token() == "" {
		t.Error("the link is not private")
	}
	if n := len(f.bucket.recorded()); n != 0 {
		t.Errorf("%d requests went out with nothing published", n)
	}
	first := f.token()
	if res, err = f.rotate(); err != nil || f.token() == first || !strings.Contains(res.Message, "Nothing has been published") {
		t.Errorf("rotate: %+v, %v", res, err)
	}
	if res, err = f.set(false); err != nil || res.Private || f.token() != "" {
		t.Errorf("public again: %+v, %v", res, err)
	}
	if n := len(f.bucket.recorded()); n != 0 {
		t.Errorf("%d requests went out with nothing published", n)
	}
}

// A recorded prefix with nothing under it is only a record change.
func TestDHLinkEmptyPrefixIsOnlyARecordChange(t *testing.T) {
	f := newLinkFixture(t)
	if err := f.dests.RecordLinkPrefix(f.dest.ID, "dh"); err != nil {
		t.Fatal(err)
	}
	res, err := f.set(true)
	if err != nil || !res.Private || !strings.Contains(res.Message, "Nothing was published under the previous link") {
		t.Fatalf("result = %+v, %v", res, err)
	}
	if got := f.labels(); len(got) != 1 || got[0] != "get dh/latest.json" {
		t.Errorf("requests = %v, want one read of the old latest.json", got)
	}
	if rec := f.record(); rec.Token == "" || len(rec.Stale) != 0 {
		t.Errorf("record = %+v: nothing was moved, so nothing is stale", rec)
	}
}

// --- failures ---

func TestDHLinkMoveCutOffKeepsOldLinkAndPendingToken(t *testing.T) {
	f := newLinkFixture(t)
	f.publishPublic()
	copies := f.bucket.copiesSoFar()
	f.bucket.setFailMultipart(func(op string, n int) (int, string) {
		if op == "copy" && n == copies+2 {
			return http.StatusForbidden, "SignatureDoesNotMatch"
		}
		return 0, ""
	})
	f.reset()
	_, err := f.set(true)
	if err == nil {
		t.Fatal("a failed assembly succeeded")
	}
	rec := f.record()
	pending := rec.Pending
	if len(pending) != 26 || rec.Token != "" {
		t.Fatalf("record = %+v: the token stays public and the pending one is recorded", rec)
	}
	for _, leak := range []string{testSecret, pending} {
		if strings.Contains(err.Error(), leak) {
			t.Errorf("the error carries %q: %v", leak, err)
		}
	}
	if !strings.Contains(err.Error(), "link is unchanged") || !strings.Contains(err.Error(), "dh/[redacted]/") {
		t.Errorf("err = %v", err)
	}
	// The old link still works and the new one does not exist yet.
	f.assertSnapshotAt("")
	if f.has("dh/" + pending + "/latest.json") {
		t.Error("the new latest.json was written by a failed move")
	}
	if f.bucket.openUploads() != 0 {
		t.Error("an upload was left open")
	}
	if n := len(f.bucket.deletedKeys()); n != 0 {
		t.Errorf("%d keys deleted by a failed move", n)
	}

	f.bucket.setFailMultipart(nil)
	if _, err := f.set(true); err != nil {
		t.Fatal(err)
	}
	if f.token() != pending {
		t.Errorf("the retry made a third token: pending %q, live %q", pending, f.token())
	}
	f.assertSnapshotAt(pending)
	f.assertNothingAt("")
	if rec := f.record(); rec.Pending != "" {
		t.Errorf("pending = %q after the commit", rec.Pending)
	}
}

// A rotation cut off midway reuses its pending token, and the old link keeps working.
func TestDHLinkRotationCutOffReusesPendingToken(t *testing.T) {
	f := newLinkFixture(t)
	f.publishPublic()
	if _, err := f.set(true); err != nil {
		t.Fatal(err)
	}
	old := f.token()
	f.bucket.setFailMultipart(func(op string, n int) (int, string) {
		if op == "complete" {
			return http.StatusInternalServerError, "InternalError"
		}
		return 0, ""
	})
	if _, err := f.rotate(); err == nil {
		t.Fatal("a failed rotation succeeded")
	}
	rec := f.record()
	if rec.Token != old || len(rec.Pending) != 26 || rec.Pending == old {
		t.Fatalf("record = %+v", rec)
	}
	f.assertSnapshotAt(old)
	pending := rec.Pending

	f.bucket.setFailMultipart(nil)
	if _, err := f.rotate(); err != nil {
		t.Fatal(err)
	}
	if f.token() != pending {
		t.Errorf("token %q, want the pending %q", f.token(), pending)
	}
	f.assertSnapshotAt(pending)
	f.assertNothingAt(old)
}

// A failed delete leaves the new link live and says the old one still works.
func TestDHLinkFailedDeleteKeepsNewLinkAndWarns(t *testing.T) {
	f := newLinkFixture(t)
	f.publishPublic()
	f.bucket.failDelete = func([]string) (int, string) { return http.StatusForbidden, "AccessDenied" }

	res, err := f.set(true)
	if err != nil {
		t.Fatalf("a failed delete is a reported condition, not an error: %v", err)
	}
	tok := f.token()
	if !res.Private || !res.OldLinkStillWorks || !strings.Contains(res.Message, "may still work") {
		t.Errorf("result = %+v", res)
	}
	if strings.Contains(res.Message, testSecret) || strings.Contains(res.Message, tok) {
		t.Errorf("the message carries a credential: %q", res.Message)
	}
	// The new link is live and committed; the old one is still there.
	f.assertSnapshotAt(tok)
	if !f.has("dh/latest.json") {
		t.Error("the old latest.json was deleted although the delete failed")
	}
	rec := f.record()
	if rec.Token != tok || len(rec.Stale) != 1 || rec.Stale[0] != (dhStaleBase{Token: "", Prefix: "dh"}) {
		t.Errorf("record = %+v: the old base must be on the list of what is still to delete", rec)
	}
	got, err := f.dests.GetSnapshotLink(f.dest.ID)
	if err != nil || !got.OldLinkStillWorks || !strings.Contains(got.Message, "may still work") {
		t.Errorf("GetSnapshotLink = %+v, %v: it must carry the warning", got, err)
	}

	// Setting the mode it already has finishes the job.
	f.bucket.failDelete = nil
	res, err = f.set(true)
	if err != nil || res.OldLinkStillWorks {
		t.Fatalf("result = %+v, %v", res, err)
	}
	f.assertNothingAt("")
	f.assertSnapshotAt(tok)
	if rec := f.record(); len(rec.Stale) != 0 {
		t.Errorf("record = %+v: the old base is deleted", rec)
	}
}

// When only the snapshots stay, the pointer is gone and the link is dead.
func TestDHLinkIsDeadWhenOnlySnapshotsRemain(t *testing.T) {
	f := newLinkFixture(t)
	f.publishPublic()
	f.bucket.failDelete = func(keys []string) (int, string) {
		if len(keys) == 1 && keys[0] == "dh/latest.json" {
			return 0, ""
		}
		return http.StatusInternalServerError, "InternalError"
	}
	res, err := f.set(true)
	if err != nil {
		t.Fatal(err)
	}
	if res.OldLinkStillWorks || !strings.Contains(res.Message, "link itself no longer works") {
		t.Errorf("result = %+v", res)
	}
	if f.has("dh/latest.json") {
		t.Error("the old pointer is still there")
	}
	if rec := f.record(); len(rec.Stale) != 1 {
		t.Errorf("record = %+v: the leftover files are still to delete", rec)
	}
	f.bucket.failDelete = nil
	if res, err = f.set(true); err != nil || res.OldLinkStillWorks {
		t.Fatalf("%+v, %v", res, err)
	}
	f.assertNothingAt("")
}

func TestDHLinkAStaleBaseThatBecomesLiveAgainIsNotDeleted(t *testing.T) {
	f := newLinkFixture(t)
	f.publishPublic()
	f.bucket.failDelete = func([]string) (int, string) { return http.StatusForbidden, "AccessDenied" }
	if _, err := f.set(true); err != nil {
		t.Fatal(err)
	}
	// The public base is stale; going public again writes it afresh, and it must
	// not then be deleted as stale.
	f.bucket.failDelete = nil
	f.reset()
	res, err := f.set(false)
	if err != nil || res.OldLinkStillWorks {
		t.Fatalf("%+v, %v", res, err)
	}
	f.assertSnapshotAt("")
	if rec := f.record(); len(rec.Stale) != 0 || rec.Token != "" {
		t.Errorf("record = %+v", rec)
	}
}

// A record that cannot be saved after the move leaves the old link in use.
func TestDHLinkUnsavedRecordAfterMoveKeepsOldLink(t *testing.T) {
	f := newLinkFixture(t)
	f.publishPublic()
	// The destination is deleted as the new latest.json is written, the last step
	// of the move: the commit then refuses, nothing is deleted, and the old link
	// is still the one in use.
	var once sync.Once
	f.bucket.setFail(func(key string, _ int) (int, string) {
		if strings.HasSuffix(key, "/latest.json") && key != "dh/latest.json" {
			once.Do(func() {
				if err := f.dests.Delete(f.dest.ID); err != nil {
					t.Errorf("Delete: %v", err)
				}
			})
		}
		return 0, ""
	})
	_, err := f.set(true)
	if err == nil || !strings.Contains(err.Error(), "destination not found") {
		t.Fatalf("err = %v: a commit for a deleted destination must fail", err)
	}
	if n := len(f.bucket.deletedKeys()); n != 0 {
		t.Errorf("%d keys deleted after a failed commit", n)
	}
	if !f.has("dh/latest.json") {
		t.Error("the old link was deleted")
	}
}

func TestDHLinkAMoveStopsWhenItsContextIsCancelled(t *testing.T) {
	f := newLinkFixture(t)
	f.publishPublic()
	ctx, cancel := context.WithCancel(context.Background())
	copies := f.bucket.copiesSoFar()
	f.bucket.setFailMultipart(func(op string, n int) (int, string) {
		if op == "copy" && n == copies+1 {
			cancel()
		}
		return 0, ""
	})
	if _, err := f.dests.SetSnapshotLinkPrivate(ctx, f.dest.ID, true); err == nil {
		t.Fatal("a cancelled move succeeded")
	}
	f.assertSnapshotAt("")
	if f.token() != "" {
		t.Error("a cancelled move committed")
	}
	if f.bucket.openUploads() != 0 {
		t.Error("an upload was left open by a cancelled move")
	}
}

// --- who may run at once ---

func TestDHLinkAMoveAndAPublishExcludeEachOther(t *testing.T) {
	f := newLinkFixture(t)
	f.publishPublic()

	release, err := f.dests.HoldLink(f.dest.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.set(true); err == nil || !strings.Contains(err.Error(), "being taken or published") {
		t.Errorf("a move under a publish: %v", err)
	}
	if _, err := f.rotate(); err == nil {
		t.Error("a rotation under a publish")
	}
	second, err := f.dests.HoldLink(f.dest.ID)
	if err != nil {
		t.Fatalf("two publishes may share a destination: %v", err)
	}
	release()
	release() // safe twice
	if _, err := f.set(true); err == nil {
		t.Error("a move went ahead while the second publish still held the link")
	}
	second()
	if f.token() != "" {
		t.Error("a refused move changed the link")
	}

	// And the other way round.
	end, err := f.dests.beginMove(f.dest.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.dests.HoldLink(f.dest.ID); err == nil || !strings.Contains(err.Error(), "being changed") {
		t.Errorf("a publish under a move: %v", err)
	}
	if _, err := f.dests.beginMove(f.dest.ID); err == nil {
		t.Error("two moves at once")
	}
	end()
	end()
	if release, err = f.dests.HoldLink(f.dest.ID); err != nil {
		t.Errorf("the hold after the move: %v", err)
	} else {
		release()
	}
	if _, err := f.set(true); err != nil {
		t.Errorf("a move after the holds: %v", err)
	}
}

func TestDHLinkRefusesAnIdThatIsNotADestination(t *testing.T) {
	f := newLinkFixture(t)
	for _, id := range []string{"", "../x", "0123456789abcdef"} {
		if _, err := f.dests.SetSnapshotLinkPrivate(context.Background(), id, true); err == nil {
			t.Errorf("Set accepted %q", id)
		}
		if _, err := f.dests.RotateSnapshotLink(context.Background(), id); err == nil {
			t.Errorf("Rotate accepted %q", id)
		}
		if _, err := f.dests.GetSnapshotLink(id); err == nil {
			t.Errorf("Get accepted %q", id)
		}
	}
}

// --- Copy link ---

func TestDHLinkGetSnapshotLinkIsTheLatestJSONOfTheCurrentMode(t *testing.T) {
	f := newLinkFixture(t)
	if _, err := f.dests.GetSnapshotLink(f.dest.ID); err == nil || !strings.Contains(err.Error(), "nothing has been published") {
		t.Fatalf("before a publish: %v", err)
	}
	f.publishPublic()
	got, err := f.dests.GetSnapshotLink(f.dest.ID)
	if want := f.client.ObjectURL("dh/latest.json"); err != nil || got.Link != want || got.Private || got.Message != "" {
		t.Errorf("public: %+v, %v, want %s", got, err, want)
	}
	if _, err := f.set(true); err != nil {
		t.Fatal(err)
	}
	tok := f.token()
	got, err = f.dests.GetSnapshotLink(f.dest.ID)
	if want := f.client.ObjectURL("dh/" + tok + "/latest.json"); err != nil || got.Link != want || !got.Private {
		t.Errorf("private: %+v, %v, want %s", got, err, want)
	}
	if body := f.bucket.object("dh/" + tok + "/latest.json"); len(body) == 0 {
		t.Error("the link names an object that is not there")
	}

	// A destination with a public base URL is linked through it.
	d := f.dest
	d.PublicBaseURL = "https://dl.example.com/"
	mustSave(t, f.dests, d, "")
	got, err = f.dests.GetSnapshotLink(f.dest.ID)
	if want := "https://dl.example.com/dh/" + tok + "/latest.json"; err != nil || got.Link != want {
		t.Errorf("public base: %+v, %v, want %s", got, err, want)
	}
}

// A move of a snapshot whose index is not where a publish puts it is refused.
func TestDHLinkMoveRefusesAMisplacedIndex(t *testing.T) {
	f := newLinkFixture(t)
	f.publishPublic()
	// latest.json pointing at another folder of the bucket's: not where a publish
	// writes, so it is not moved on the strength of it.
	other, _ := DHLatest{Format: dhLatestFormat, CreatedAt: formatDHCreatedAt(dhPubTime1), Index: "elsewhere/index.json"}.Marshal()
	f.bucket.put("dh/latest.json", other)
	f.bucket.put("dh/elsewhere/index.json", f.bucket.object(snapshotFile("", "index.json")))
	f.reset()
	_, err := f.set(true)
	if err == nil || !strings.Contains(err.Error(), "not where a publish writes") {
		t.Fatalf("err = %v", err)
	}
	if got := f.labels(); slices.ContainsFunc(got, func(l string) bool {
		return strings.HasPrefix(l, "put ") || strings.HasPrefix(l, "copy ") || strings.HasPrefix(l, "delete ")
	}) {
		t.Errorf("a refused move wrote or deleted: %v", got)
	}
}

func TestDHLinkDropRefusesAListingThatLeavesTheFolder(t *testing.T) {
	f := newLinkFixture(t)
	f.publishPublic()
	f.bucket.mu.Lock()
	f.bucket.listExtra = []string{"dh/parts/" + strings.Repeat("a", 64)}
	f.bucket.mu.Unlock()
	gone, err := dropDHBase(context.Background(), f.client, "dh", "", nil)
	if err == nil || gone || !strings.Contains(err.Error(), "outside the folder being deleted") {
		t.Fatalf("gone=%v err=%v", gone, err)
	}
	if n := len(f.bucket.deletedKeys()); n != 0 {
		t.Errorf("%d keys deleted on the strength of a listing that could not be trusted", n)
	}
	if !f.has("dh/latest.json") {
		t.Error("the pointer was deleted")
	}
}

func TestDHLinkMoveToTheSameLayoutIsRefused(t *testing.T) {
	f := newLinkFixture(t)
	f.publishPublic()
	if _, err := moveDHSnapshotLink(context.Background(), f.client, "dh", "", "", nil); err == nil {
		t.Error("a move onto itself was accepted")
	}
	// An index the check refuses is not moved.
	f.bucket.put(snapshotFile("", "index.json"), []byte(`{"format":1,"createdAt":"x","levels":[]}`))
	if _, err := moveDHSnapshotLink(context.Background(), f.client, "dh", "", testLinkToken, nil); err == nil {
		t.Error("an index with no levels was moved")
	}
}
