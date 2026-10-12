package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"

	"konnekt/backend/models"
)

// --- a bucket that remembers ---

// fakeBucket is an in-memory S3 behind an httptest server: HEAD answers from what
// PUT stored, which is what the skip and resume tests need to be about the library
// rather than about canned responses.
type fakeBucket struct {
	*s3TestServer
	mu      sync.Mutex
	objects map[string][]byte
	types   map[string]string
	// fail, when set, is asked before each PUT with the key and the count of PUTs
	// so far; a non-zero status is sent instead of storing.
	fail func(key string, puts int) (status int, code string)
	puts int
	// failGet, when set, is asked before each GET; a non-zero status is sent
	// instead of the object.
	failGet func(key string) (status int, code string)
}

func newFakeBucket(t *testing.T) *fakeBucket {
	t.Helper()
	b := &fakeBucket{objects: map[string][]byte{}, types: map[string]string{}}
	b.s3TestServer = newS3TestServer(t, func(_ int, w http.ResponseWriter, r *http.Request) {
		key := strings.TrimPrefix(r.URL.Path, "/snapshots/")
		b.mu.Lock()
		defer b.mu.Unlock()
		switch r.Method {
		case http.MethodHead:
			data, ok := b.objects[key]
			if !ok {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			w.Header().Set("Content-Length", fmt.Sprint(len(data)))
		case http.MethodGet:
			if b.failGet != nil {
				if status, code := b.failGet(key); status != 0 {
					s3XMLError(w, status, code, "refused "+testSecret)
					return
				}
			}
			data, ok := b.objects[key]
			if !ok {
				s3XMLError(w, http.StatusNotFound, "NoSuchKey", "The specified key does not exist.")
				return
			}
			_, _ = w.Write(data)
		case http.MethodPut:
			b.puts++
			if b.fail != nil {
				if status, code := b.fail(key, b.puts); status != 0 {
					s3XMLError(w, status, code, "refused "+testSecret)
					return
				}
			}
			body := recordedBody(b.s3TestServer, r)
			b.objects[key] = body
			b.types[key] = r.Header.Get("Content-Type")
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	})
	return b
}

// recordedBody is the body the wrapper in newS3TestServer already read and kept.
func recordedBody(s *s3TestServer, r *http.Request) []byte {
	reqs := s.recorded()
	for i := len(reqs) - 1; i >= 0; i-- {
		if reqs[i].RequestURI == r.RequestURI && reqs[i].Method == r.Method {
			return reqs[i].Body
		}
	}
	return nil
}

// setFail installs (or, with nil, removes) the PUT failure hook under the lock the
// handler reads it by.
func (b *fakeBucket) setFail(f func(key string, puts int) (int, string)) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.fail = f
}

// setFailGet installs (or, with nil, removes) the GET failure hook.
func (b *fakeBucket) setFailGet(f func(key string) (int, string)) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.failGet = f
}

// put stores an object directly, as an earlier run would have left it.
func (b *fakeBucket) put(key string, data []byte) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.objects[key] = data
}

// object is what is stored at key.
func (b *fakeBucket) object(key string) []byte {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.objects[key]
}

// snapshot copies the stored objects.
func (b *fakeBucket) snapshot() map[string][]byte {
	b.mu.Lock()
	defer b.mu.Unlock()
	out := make(map[string][]byte, len(b.objects))
	for k, v := range b.objects {
		out[k] = v
	}
	return out
}

func (b *fakeBucket) contentType(key string) string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.types[key]
}

func (b *fakeBucket) keys() []string {
	b.mu.Lock()
	defer b.mu.Unlock()
	var out []string
	for k := range b.objects {
		out = append(out, k)
	}
	return out
}

func (b *fakeBucket) requestsOf(method string) []string {
	var out []string
	for _, r := range b.recorded() {
		if r.Method == method {
			out = append(out, strings.TrimPrefix(r.RequestURI, "/snapshots/"))
		}
	}
	return out
}

// uploadTree writes a small folder and returns its path.
func uploadTree(t *testing.T) string {
	t.Helper()
	root := filepath.Join(t.TempDir(), "server")
	writeFile(t, filepath.Join(root, "a.txt"), "aaaa")
	writeFile(t, filepath.Join(root, "world", "region", "r.0.0.mca"), "region-data")
	writeFile(t, filepath.Join(root, "world", "level.dat"), "level")
	writeFile(t, filepath.Join(root, "index.json"), "{}")
	return root
}

func plan(store objectStore, root, source string) uploadPlan {
	return uploadPlan{Store: store, Source: source, WorkingDir: root, Roots: []string{root}, KeyPrefix: "snap"}
}

// --- sources ---

func TestResolveUploadSource(t *testing.T) {
	root := uploadTree(t)
	backups := filepath.Join(t.TempDir(), "backups", "srv1")
	writeFile(t, filepath.Join(backups, "server", "b.zip"), "zip")
	// A sibling of the server folder, so "../outside" really reaches it.
	outside := filepath.Join(filepath.Dir(root), "outside")
	writeFile(t, filepath.Join(outside, "id_rsa"), "private")
	roots := []string{root, backups}

	tests := []struct {
		name    string
		source  string
		wantErr string
	}{
		{"a relative folder", "world", ""},
		{"a relative file", "a.txt", ""},
		{"the working directory itself", ".", ""},
		{"an absolute path inside", filepath.Join(root, "world"), ""},
		{"a backup", filepath.Join(backups, "server", "b.zip"), ""},
		{"empty", "  ", "no source"},
		{"missing", "nope", "does not exist"},
		{"dot dot out of the folder", filepath.Join("..", "outside"), "outside"},
		{"an absolute path elsewhere", outside, "outside"},
		{"a file elsewhere", filepath.Join(outside, "id_rsa"), "outside"},
		{"a sibling whose name starts like the root", root + "-other", ""},
	}
	// The last case needs the sibling to exist to tell "outside" from "missing".
	if err := os.MkdirAll(root+"-other", 0o755); err != nil {
		t.Fatal(err)
	}
	tests[len(tests)-1].wantErr = "outside"

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := resolveUploadSource(tc.source, root, roots)
			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("err = %v, want none", err)
				}
				if !filepath.IsAbs(got) {
					t.Errorf("resolved %q is not absolute", got)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("err = %v, want one containing %q", err, tc.wantErr)
			}
		})
	}
}

func TestResolveUploadSourceRefusesASymlinkOut(t *testing.T) {
	root := uploadTree(t)
	outside := t.TempDir()
	writeFile(t, filepath.Join(outside, "id_rsa"), "private")
	link := filepath.Join(root, "escape")
	if err := os.Symlink(outside, link); err != nil {
		t.Skipf("symlinks unavailable here: %v", err)
	}

	for _, source := range []string{"escape", filepath.Join("escape", "id_rsa")} {
		_, err := resolveUploadSource(source, root, []string{root})
		if err == nil || !strings.Contains(err.Error(), "outside") {
			t.Errorf("source %q through a link out: err = %v, want a refusal", source, err)
		}
	}
}

func TestResolveUploadSourceNeedsAWorkingDirForARelativePath(t *testing.T) {
	if _, err := resolveUploadSource("world", "", []string{t.TempDir()}); err == nil {
		t.Error("a relative source with no working directory resolved against the process's")
	}
}

// --- collecting ---

func TestCollectUploadItemsKeysOrderAndSizes(t *testing.T) {
	root := uploadTree(t)
	items, err := collectUploadItems(root, "dh/snap", []string{root})
	if err != nil {
		t.Fatal(err)
	}
	var keys []string
	for _, it := range items {
		keys = append(keys, it.Key)
		if strings.Contains(it.Key, `\`) {
			t.Errorf("key %q carries a backslash", it.Key)
		}
		if fi, err := os.Stat(it.Path); err != nil || fi.Size() != it.Size {
			t.Errorf("item %s: size %d, stat %v %v", it.Key, it.Size, fi, err)
		}
	}
	want := "dh/snap/a.txt,dh/snap/index.json,dh/snap/world/level.dat,dh/snap/world/region/r.0.0.mca"
	if got := strings.Join(keys, ","); got != want {
		t.Errorf("keys = %s\nwant   %s", got, want)
	}
}

func TestCollectUploadItemsSingleFile(t *testing.T) {
	root := uploadTree(t)
	items, err := collectUploadItems(filepath.Join(root, "a.txt"), "p", []string{root})
	if err != nil || len(items) != 1 || items[0].Key != "p/a.txt" || items[0].Size != 4 {
		t.Fatalf("items = %+v, err = %v", items, err)
	}
	items, err = collectUploadItems(filepath.Join(root, "a.txt"), "", []string{root})
	if err != nil || items[0].Key != "a.txt" {
		t.Fatalf("with no prefix: items = %+v, err = %v", items, err)
	}
}

func TestCollectUploadItemsLinks(t *testing.T) {
	root := uploadTree(t)
	outside := t.TempDir()
	writeFile(t, filepath.Join(outside, "id_rsa"), "private")

	// A link to a file inside the roots is uploaded as that file, under the
	// link's own place in the tree.
	if err := os.Symlink(filepath.Join(root, "a.txt"), filepath.Join(root, "alias.txt")); err != nil {
		t.Skipf("symlinks unavailable here: %v", err)
	}
	// A linked folder is not entered, even when it is inside the roots.
	if err := os.Symlink(filepath.Join(root, "world"), filepath.Join(root, "worldlink")); err != nil {
		t.Fatal(err)
	}
	items, err := collectUploadItems(root, "", []string{root})
	if err != nil {
		t.Fatal(err)
	}
	var keys []string
	for _, it := range items {
		keys = append(keys, it.Key)
	}
	got := strings.Join(keys, ",")
	if !strings.Contains(got, "alias.txt") || strings.Contains(got, "worldlink") {
		t.Errorf("keys = %s, want alias.txt and nothing under worldlink", got)
	}

	// A link out refuses the whole collection, so nothing can have been sent.
	if err := os.Symlink(filepath.Join(outside, "id_rsa"), filepath.Join(root, "key")); err != nil {
		t.Fatal(err)
	}
	items, err = collectUploadItems(root, "", []string{root})
	if err == nil || !strings.Contains(err.Error(), "key") || !strings.Contains(err.Error(), "outside") {
		t.Fatalf("err = %v (items %d), want the link named and refused", err, len(items))
	}
}

func TestCollectUploadItemsSkipsWhatIsNotAFile(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("no fifo on windows")
	}
	root := uploadTree(t)
	items, err := collectUploadItems(root, "", []string{root})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 4 {
		t.Errorf("items = %d, want the 4 files", len(items))
	}
}

func TestKeyHelpers(t *testing.T) {
	prefixes := []struct{ in, want, err string }{
		{"", "", ""},
		{"dh", "dh", ""},
		{"/dh/snap/", "dh/snap", ""},
		{`dh\snap`, "dh/snap", ""},
		{"dh//snap", "dh/snap", ""},
		{"../escape", "", ".."},
		{"dh/./x", "", "."},
	}
	for _, tc := range prefixes {
		got, err := cleanKeyPrefix(tc.in)
		if tc.err != "" {
			if err == nil || !strings.Contains(err.Error(), tc.err) {
				t.Errorf("cleanKeyPrefix(%q) err = %v, want %q", tc.in, err, tc.err)
			}
			continue
		}
		if err != nil || got != tc.want {
			t.Errorf("cleanKeyPrefix(%q) = %q, %v; want %q", tc.in, got, err, tc.want)
		}
	}
	if got := joinKey("", "/a/", "b", "", "c/d"); got != "a/b/c/d" {
		t.Errorf("joinKey = %q", got)
	}
}

// --- the size limit ---

func TestCheckUploadSizesRefusesTheWholePlanNamingTheFile(t *testing.T) {
	old := maxUploadObjectBytes
	maxUploadObjectBytes = 10
	t.Cleanup(func() { maxUploadObjectBytes = old })

	items := []uploadItem{{Key: "p/small", Size: 3}, {Key: "p/backups/full.zip", Size: 11}, {Key: "p/also", Size: 1}}
	err := checkUploadSizes(items)
	if !errors.Is(err, ErrS3TooLarge) {
		t.Fatalf("err = %v, want ErrS3TooLarge", err)
	}
	for _, want := range []string{"p/backups/full.zip", "5 GiB", "nothing was uploaded"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("message %q lacks %q", err, want)
		}
	}
	if err := checkUploadSizes(items[:1]); err != nil {
		t.Errorf("a plan under the limit: %v", err)
	}
}

func TestRunUploadOverTheLimitSendsNothing(t *testing.T) {
	old := maxUploadObjectBytes
	maxUploadObjectBytes = 6
	t.Cleanup(func() { maxUploadObjectBytes = old })

	root := uploadTree(t) // region-data is 11 bytes
	b := newFakeBucket(t)
	_, err := runUpload(context.Background(), plan(newTestS3Client(t, b.s3TestServer), root, "."))
	if !errors.Is(err, ErrS3TooLarge) || !strings.Contains(err.Error(), "r.0.0.mca") {
		t.Fatalf("err = %v, want ErrS3TooLarge naming the file", err)
	}
	if n := len(b.recorded()); n != 0 {
		t.Errorf("%d requests went out; the plan is refused before the first", n)
	}
}

// --- skip, replace, resume ---

func TestRunUploadSendsEverythingThenSkipsEverything(t *testing.T) {
	root := uploadTree(t)
	b := newFakeBucket(t)
	c := newTestS3Client(t, b.s3TestServer)

	res, err := runUpload(context.Background(), plan(c, root, "."))
	if err != nil {
		t.Fatal(err)
	}
	if res.Uploaded != 4 || res.Skipped != 0 || res.Bytes != int64(4+11+5+2) {
		t.Errorf("first run = %+v", res)
	}
	if got := strings.Join(b.keys(), ","); !strings.Contains(got, "snap/world/region/r.0.0.mca") {
		t.Errorf("keys = %s", got)
	}
	if string(b.object("snap/a.txt")) != "aaaa" {
		t.Errorf("stored a.txt = %q", b.object("snap/a.txt"))
	}
	// Content type from the extension, as the page and index need.
	if b.contentType("snap/index.json") != "application/json" || b.contentType("snap/a.txt") != "application/octet-stream" {
		t.Errorf("content types = %q, %q", b.contentType("snap/index.json"), b.contentType("snap/a.txt"))
	}

	before := len(b.requestsOf(http.MethodPut))
	res, err = runUpload(context.Background(), plan(c, root, "."))
	if err != nil {
		t.Fatal(err)
	}
	if res.Uploaded != 0 || res.Skipped != 4 || res.Bytes != 0 {
		t.Errorf("second run = %+v, want all skipped", res)
	}
	if after := len(b.requestsOf(http.MethodPut)); after != before {
		t.Errorf("a second run sent %d more PUTs, want none", after-before)
	}
}

func TestRunUploadReplacesAnObjectOfAnotherSize(t *testing.T) {
	root := uploadTree(t)
	b := newFakeBucket(t)
	c := newTestS3Client(t, b.s3TestServer)
	if _, err := runUpload(context.Background(), plan(c, root, ".")); err != nil {
		t.Fatal(err)
	}

	writeFile(t, filepath.Join(root, "world", "level.dat"), "level-grown-a-lot")
	res, err := runUpload(context.Background(), plan(c, root, "."))
	if err != nil {
		t.Fatal(err)
	}
	if res.Uploaded != 1 || res.Skipped != 3 || res.Bytes != int64(len("level-grown-a-lot")) {
		t.Errorf("result = %+v, want the one changed file sent", res)
	}
	if got := string(b.object("snap/world/level.dat")); got != "level-grown-a-lot" {
		t.Errorf("stored level.dat = %q, want it replaced", got)
	}
}

func TestRunUploadResumesAfterAFailureMidway(t *testing.T) {
	root := uploadTree(t)
	b := newFakeBucket(t)
	c := newTestS3Client(t, b.s3TestServer)
	// The third PUT is refused for good, so two objects are in when it stops.
	b.setFail(func(_ string, puts int) (int, string) {
		if puts == 3 {
			return http.StatusForbidden, "AccessDenied"
		}
		return 0, ""
	})

	res, err := runUpload(context.Background(), plan(c, root, "."))
	if err == nil {
		t.Fatal("expected the run to fail")
	}
	if res.Uploaded != 2 || len(b.keys()) != 2 {
		t.Errorf("after the failure: result %+v, bucket %v; want the two earlier objects kept", res, b.keys())
	}
	if !strings.Contains(err.Error(), "object 3 of 4") {
		t.Errorf("err = %v, want the position", err)
	}

	b.setFail(nil)
	headsBefore := len(b.requestsOf(http.MethodHead))
	res, err = runUpload(context.Background(), plan(c, root, "."))
	if err != nil {
		t.Fatal(err)
	}
	if res.Skipped != 2 || res.Uploaded != 2 {
		t.Errorf("resume = %+v, want 2 skipped and 2 sent", res)
	}
	if len(b.keys()) != 4 {
		t.Errorf("bucket = %v, want all four", b.keys())
	}
	if n := len(b.requestsOf(http.MethodHead)) - headsBefore; n != 4 {
		t.Errorf("resume sent %d HEADs, want one per object", n)
	}
}

func TestRunUploadSendsInTheOrderGiven(t *testing.T) {
	root := uploadTree(t)
	b := newFakeBucket(t)
	c := newTestS3Client(t, b.s3TestServer)
	items, err := collectUploadItems(root, "snap", []string{root})
	if err != nil {
		t.Fatal(err)
	}
	// A caller that needs index.json last reorders the items; the library keeps
	// whatever order it is handed.
	var reordered []uploadItem
	var index uploadItem
	for _, it := range items {
		if strings.HasSuffix(it.Key, "index.json") {
			index = it
			continue
		}
		reordered = append(reordered, it)
	}
	reordered = append(reordered, index)

	if _, err := syncUploadItems(context.Background(), c, reordered, nil); err != nil {
		t.Fatal(err)
	}
	puts := b.requestsOf(http.MethodPut)
	if len(puts) != 4 || puts[3] != "snap/index.json" {
		t.Errorf("PUT order = %v, want index.json last", puts)
	}
}

// --- errors and cancel ---

func TestRunUploadRetriesA5xxAndSucceeds(t *testing.T) {
	root := uploadTree(t)
	b := newFakeBucket(t)
	c := newTestS3Client(t, b.s3TestServer)
	b.setFail(func(_ string, puts int) (int, string) {
		if puts <= 2 { // the first object's first two attempts
			return http.StatusServiceUnavailable, "SlowDown"
		}
		return 0, ""
	})
	res, err := runUpload(context.Background(), plan(c, root, "."))
	if err != nil {
		t.Fatalf("a retried 5xx should not fail the run: %v", err)
	}
	if res.Uploaded != 4 {
		t.Errorf("result = %+v", res)
	}
	if n := len(b.requestsOf(http.MethodPut)); n != 6 {
		t.Errorf("PUTs = %d, want 4 objects plus 2 retries", n)
	}
}

func TestRunUpload403IsReadableAndNotRetried(t *testing.T) {
	root := uploadTree(t)
	b := newFakeBucket(t)
	c := newTestS3Client(t, b.s3TestServer)
	b.setFail(func(string, int) (int, string) { return http.StatusForbidden, "AccessDenied" })

	_, err := runUpload(context.Background(), plan(c, root, "."))
	if err == nil {
		t.Fatal("expected a failure")
	}
	msg := readableUploadError(err).Error()
	for _, want := range []string{"refused the upload", "403", "AccessDenied", "access key"} {
		if !strings.Contains(msg, want) {
			t.Errorf("message %q lacks %q", msg, want)
		}
	}
	if strings.Contains(msg, testSecret) {
		t.Errorf("message leaks the secret: %s", msg)
	}
	if n := len(b.requestsOf(http.MethodPut)); n != 1 {
		t.Errorf("PUTs = %d, want 1: a 403 is not retried", n)
	}
	// Any other error is passed through unchanged.
	plain := errors.New("disk on fire")
	if readableUploadError(plain) != plain {
		t.Error("an unrelated error was rewrapped")
	}
}

func TestRunUploadCancelStopsBetweenObjectsAndLeavesNoPartial(t *testing.T) {
	root := uploadTree(t)
	b := newFakeBucket(t)
	c := newTestS3Client(t, b.s3TestServer)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	b.setFail(func(_ string, puts int) (int, string) {
		if puts == 2 {
			cancel() // the run is cancelled while the second object is in flight
		}
		return 0, ""
	})

	res, err := runUpload(ctx, plan(c, root, "."))
	if err == nil {
		t.Fatal("expected the cancel to surface")
	}
	if !errors.Is(err, context.Canceled) {
		t.Errorf("err = %v, want context.Canceled", err)
	}
	if res.Uploaded > 2 {
		t.Errorf("uploaded %d after the cancel", res.Uploaded)
	}
	sent := len(b.requestsOf(http.MethodPut))
	if sent > 2 {
		t.Errorf("%d PUTs, want the run to stop at the second", sent)
	}
	// Every stored object is whole: the store only ever holds a finished body.
	for k, v := range b.snapshot() {
		if want := localSizeOf(t, root, k); int64(len(v)) != want {
			t.Errorf("object %s is %d bytes, source is %d", k, len(v), want)
		}
	}
}

func localSizeOf(t *testing.T, root, key string) int64 {
	t.Helper()
	fi, err := os.Stat(filepath.Join(root, filepath.FromSlash(strings.TrimPrefix(key, "snap/"))))
	if err != nil {
		t.Fatal(err)
	}
	return fi.Size()
}

func TestRunUploadRefusesWhatCannotBeUploaded(t *testing.T) {
	root := uploadTree(t)
	b := newFakeBucket(t)
	c := newTestS3Client(t, b.s3TestServer)
	if err := os.MkdirAll(filepath.Join(root, "empty"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := runUpload(context.Background(), plan(c, root, "empty")); err == nil || !strings.Contains(err.Error(), "no files") {
		t.Errorf("an empty folder: err = %v", err)
	}
	if _, err := runUpload(context.Background(), plan(c, root, "nope")); err == nil {
		t.Error("a missing source was accepted")
	}
	if n := len(b.recorded()); n != 0 {
		t.Errorf("%d requests for sources that were refused", n)
	}
}

// --- narration ---

func TestRunUploadNarratesStartProgressAndFinish(t *testing.T) {
	old := uploadProgressEvery
	uploadProgressEvery = 0
	t.Cleanup(func() { uploadProgressEvery = old })

	root := uploadTree(t)
	b := newFakeBucket(t)
	c := newTestS3Client(t, b.s3TestServer)
	var lines []string
	p := plan(c, root, ".")
	p.Label = `"R2"`
	p.Narrate = func(l string) { lines = append(lines, l) }

	if _, err := runUpload(context.Background(), p); err != nil {
		t.Fatal(err)
	}
	if len(lines) < 3 {
		t.Fatalf("lines = %q, want a start, progress and a finish", lines)
	}
	if !strings.HasPrefix(lines[0], `Uploading 4 file(s)`) || !strings.Contains(lines[0], `"R2"`) {
		t.Errorf("start line = %q", lines[0])
	}
	if !strings.Contains(lines[1], "of 4 file(s) done") {
		t.Errorf("progress line = %q", lines[1])
	}
	if last := lines[len(lines)-1]; !strings.HasPrefix(last, "Upload finished: 4 sent") {
		t.Errorf("finish line = %q", last)
	}

	// With the default cadence a short upload narrates a start and a finish only.
	uploadProgressEvery = old
	lines = nil
	if _, err := runUpload(context.Background(), p); err != nil {
		t.Fatal(err)
	}
	if len(lines) != 2 {
		t.Errorf("lines = %q, want just the start and the finish", lines)
	}
}

// --- opening a destination by name ---

func TestDestinationOpenByName(t *testing.T) {
	s, dir := newDestService(t)
	saved := mustSave(t, s, validDestination(), destSecret)

	client, d, err := s.Open("  r2 SNAPSHOTS ")
	if err != nil {
		t.Fatal(err)
	}
	if d.ID != saved.ID || d.Prefix != "dh" {
		t.Errorf("destination = %+v", d)
	}
	if strings.Contains(fmt.Sprintf("%v %+v %#v", client, client, client), destSecret) {
		t.Error("the client prints its secret")
	}

	if _, _, err := s.Open("Nope"); err == nil || !strings.Contains(err.Error(), `"Nope" no longer exists`) {
		t.Errorf("unknown name: err = %v", err)
	}
	if _, found, err := s.Lookup("  "); found || err != nil {
		t.Errorf("a blank name: found=%v err=%v", found, err)
	}

	// A destination whose secret file was removed by hand cannot sign anything,
	// and says so without inventing a credential.
	if err := os.Remove(filepath.Join(dir, destinationSecretsDir, saved.ID+destinationSecretExt)); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.Open(saved.Name); err == nil || !strings.Contains(err.Error(), "no secret access key") {
		t.Errorf("no secret: err = %v", err)
	}

	// A destinations file edited into something the client refuses is reported
	// by name, not as a bare client error.
	mustSave(t, s, models.Destination{Name: "Other", Endpoint: "https://x.example", Bucket: "b", AccessKeyID: "K"}, destSecret)
	list, err := s.List()
	if err != nil {
		t.Fatal(err)
	}
	for i := range list {
		if list[i].Name == "Other" {
			list[i].Endpoint = "https://x.example/with/a/path"
		}
	}
	data, err := json.Marshal(list)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, destinationsFile), data, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.Open("Other"); err == nil || !strings.Contains(err.Error(), `destination "Other"`) {
		t.Errorf("bad endpoint: err = %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, destinationsFile), []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.Open("Other"); err == nil {
		t.Error("a corrupt list opened a client")
	}
}
