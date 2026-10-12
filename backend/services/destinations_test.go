package services

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"konnekt/backend/models"
)

const destSecret = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYdestSECRET"

func newDestService(t *testing.T) (*DestinationService, string) {
	t.Helper()
	dir := t.TempDir()
	s := NewDestinationService()
	s.SetDataDir(dir)
	return s, dir
}

func validDestination() models.Destination {
	return models.Destination{
		Name:        "R2 snapshots",
		Endpoint:    "https://acct.r2.cloudflarestorage.com",
		Region:      "auto",
		Bucket:      "snapshots",
		Prefix:      "/dh/",
		AccessKeyID: "AKIDEXAMPLE",
	}
}

func mustSave(t *testing.T, s *DestinationService, d models.Destination, secret string) models.Destination {
	t.Helper()
	saved, err := s.Save(d, secret)
	if err != nil {
		t.Fatalf("Save: %v", err)
	}
	return saved
}

// --- storage ---

func TestDestinationSecretIsOwnerOnlyInItsOwnFile(t *testing.T) {
	s, dir := newDestService(t)
	saved := mustSave(t, s, validDestination(), destSecret)

	secretFile := filepath.Join(dir, destinationSecretsDir, saved.ID+destinationSecretExt)
	info, err := os.Stat(secretFile)
	if err != nil {
		t.Fatalf("secret file: %v", err)
	}
	if runtime.GOOS != "windows" {
		if perm := info.Mode().Perm(); perm != 0600 {
			t.Errorf("secret file mode = %o, want 0600", perm)
		}
	}
	got, err := os.ReadFile(secretFile)
	if err != nil || string(got) != destSecret {
		t.Errorf("secret file = %q, %v", got, err)
	}

	// Nothing else under the data dir holds it.
	err = filepath.WalkDir(dir, func(p string, d os.DirEntry, werr error) error {
		if werr != nil || d.IsDir() || p == secretFile {
			return werr
		}
		data, rerr := os.ReadFile(p)
		if rerr != nil {
			return rerr
		}
		if strings.Contains(string(data), destSecret) {
			t.Errorf("%s holds the secret", p)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// S2.3: the app's data shapes carry no secret.
func TestDestinationSecretIsNotInAppSettingsOrTheList(t *testing.T) {
	for _, typ := range []reflect.Type{reflect.TypeOf(models.AppSettings{}), reflect.TypeOf(models.Destination{})} {
		for i := 0; i < typ.NumField(); i++ {
			f := typ.Field(i)
			name := strings.ToLower(f.Name)
			if f.Name == "SecretSet" && f.Type.Kind() == reflect.Bool {
				continue
			}
			if strings.Contains(name, "secret") || strings.Contains(name, "password") || name == "token" {
				t.Errorf("%s.%s looks like a credential field", typ.Name(), f.Name)
			}
		}
	}
	if raw, _ := json.Marshal(models.AppSettings{}); strings.Contains(strings.ToLower(string(raw)), "destination") {
		t.Errorf("AppSettings mentions destinations: %s", raw)
	}

	s, _ := newDestService(t)
	mustSave(t, s, validDestination(), destSecret)
	list, err := s.List()
	if err != nil || len(list) != 1 {
		t.Fatalf("List = %v, %v", list, err)
	}
	if !list[0].SecretSet {
		t.Error("SecretSet = false after saving a secret")
	}
	raw, err := json.Marshal(list)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), destSecret) {
		t.Errorf("the list carries the secret: %s", raw)
	}
}

func TestDestinationSaveNormalisesAndPersists(t *testing.T) {
	s, dir := newDestService(t)
	d := validDestination()
	d.Region = ""
	d.PublicBaseURL = " https://snap.example.com/ "
	saved := mustSave(t, s, d, destSecret)
	if saved.Region != "auto" || saved.Prefix != "dh" || saved.PublicBaseURL != "https://snap.example.com" {
		t.Errorf("saved = %+v", saved)
	}
	if !destinationIDPattern.MatchString(saved.ID) {
		t.Errorf("id = %q", saved.ID)
	}
	if !saved.SecretSet {
		t.Error("SecretSet = false")
	}

	// A fresh service over the same directory reads it back.
	again := NewDestinationService()
	again.SetDataDir(dir)
	list, err := again.List()
	if err != nil || len(list) != 1 || list[0].ID != saved.ID || !list[0].SecretSet {
		t.Errorf("reloaded = %+v, %v", list, err)
	}
}

func TestDestinationBlankSecretOnSaveKeepsTheStoredOne(t *testing.T) {
	s, _ := newDestService(t)
	saved := mustSave(t, s, validDestination(), destSecret)

	saved.Name = "Renamed"
	mustSave(t, s, saved, "")
	got, err := s.Secret(saved.ID)
	if err != nil || got != destSecret {
		t.Errorf("secret after a blank save = %q, %v", got, err)
	}

	mustSave(t, s, saved, "a-new-secret")
	if got, _ := s.Secret(saved.ID); got != "a-new-secret" {
		t.Errorf("secret after replacing = %q", got)
	}
}

func TestDestinationNewOneNeedsASecret(t *testing.T) {
	s, dir := newDestService(t)
	if _, err := s.Save(validDestination(), ""); err == nil || !strings.Contains(err.Error(), "secret") {
		t.Errorf("err = %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, destinationsFile)); !os.IsNotExist(err) {
		t.Errorf("a refused save wrote %s (stat err = %v)", destinationsFile, err)
	}
}

func TestDestinationDeleteRemovesTheSecretFile(t *testing.T) {
	s, dir := newDestService(t)
	keep := validDestination()
	keep.Name = "Other"
	other := mustSave(t, s, keep, "other-secret")
	saved := mustSave(t, s, validDestination(), destSecret)
	secretFile := filepath.Join(dir, destinationSecretsDir, saved.ID+destinationSecretExt)

	if err := s.Delete(saved.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(secretFile); !os.IsNotExist(err) {
		t.Errorf("secret file still there (stat err = %v)", err)
	}
	list, _ := s.List()
	if len(list) != 1 || list[0].ID != other.ID || !list[0].SecretSet {
		t.Errorf("list after delete = %+v", list)
	}
	// Deleting it again, or one that never existed, is not an error.
	if err := s.Delete(saved.ID); err != nil {
		t.Errorf("second delete: %v", err)
	}
}

func TestDestinationIDNeverNamesAPath(t *testing.T) {
	s, dir := newDestService(t)
	if err := os.WriteFile(filepath.Join(dir, "victim"+destinationSecretExt), []byte("x"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"../victim", "..", "a/b", "", "ZZZZ"} {
		if err := s.Delete(id); err == nil {
			t.Errorf("Delete(%q) = nil, want a refusal", id)
		}
		if id == "" {
			continue // a new destination
		}
		d := validDestination()
		d.ID = id
		if _, err := s.Save(d, "s"); err == nil {
			t.Errorf("Save with id %q = nil", id)
		}
	}
	if _, err := os.Stat(filepath.Join(dir, "victim"+destinationSecretExt)); err != nil {
		t.Errorf("a file outside the secrets directory was touched: %v", err)
	}
	if got, _ := s.Secret("../victim"); got != "" {
		t.Errorf("Secret read outside the directory: %q", got)
	}
}

func TestDestinationValidation(t *testing.T) {
	cases := map[string]func(*models.Destination){
		"name":     func(d *models.Destination) { d.Name = "  " },
		"endpoint": func(d *models.Destination) { d.Endpoint = "" },
		"bucket":   func(d *models.Destination) { d.Bucket = "" },
		"access":   func(d *models.Destination) { d.AccessKeyID = "" },
		"path":     func(d *models.Destination) { d.Endpoint = "https://h.example.com/some/path" },
		"slash":    func(d *models.Destination) { d.Bucket = "a/b" },
		"public":   func(d *models.Destination) { d.PublicBaseURL = "ftp://example.com" },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			s, _ := newDestService(t)
			d := validDestination()
			mutate(&d)
			if _, err := s.Save(d, destSecret); err == nil {
				t.Error("Save = nil, want an error")
			} else if strings.Contains(err.Error(), destSecret) {
				t.Errorf("error carries the secret: %v", err)
			}
		})
	}
}

func TestDestinationNamesAreUnique(t *testing.T) {
	s, _ := newDestService(t)
	first := mustSave(t, s, validDestination(), destSecret)
	dup := validDestination()
	dup.Name = "r2 SNAPSHOTS"
	if _, err := s.Save(dup, destSecret); err == nil {
		t.Error("a second destination with the same name was saved")
	}
	// Saving the first again under its own name is not a clash.
	mustSave(t, s, first, "")
}

func TestDestinationSaveOfAnUnknownIDIsRefused(t *testing.T) {
	s, _ := newDestService(t)
	d := validDestination()
	d.ID = "0123456789abcdef"
	if _, err := s.Save(d, destSecret); err == nil {
		t.Error("Save of an id that was never issued = nil")
	}
}

func TestDestinationServiceWithoutADataDir(t *testing.T) {
	s := NewDestinationService()
	if _, err := s.List(); err == nil {
		t.Error("List with no data dir = nil")
	}
	if _, err := s.Save(validDestination(), destSecret); err == nil {
		t.Error("Save with no data dir = nil")
	}
}

func TestDestinationCorruptListIsReported(t *testing.T) {
	s, dir := newDestService(t)
	if err := os.WriteFile(filepath.Join(dir, destinationsFile), []byte("{not json"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := s.List(); err == nil {
		t.Error("List of a corrupt file = nil")
	}
	if err := os.WriteFile(filepath.Join(dir, destinationsFile), nil, 0644); err != nil {
		t.Fatal(err)
	}
	if list, err := s.List(); err != nil || len(list) != 0 || list == nil {
		t.Errorf("List of an empty file = %v, %v", list, err)
	}
}

// A hand-edited file cannot claim a secret that is not there.
func TestDestinationSecretSetComesFromTheFile(t *testing.T) {
	s, dir := newDestService(t)
	raw := `[{"id":"0123456789abcdef","name":"x","endpoint":"https://h","bucket":"b","secretSet":true}]`
	if err := os.WriteFile(filepath.Join(dir, destinationsFile), []byte(raw), 0644); err != nil {
		t.Fatal(err)
	}
	list, err := s.List()
	if err != nil || len(list) != 1 || list[0].SecretSet {
		t.Errorf("list = %+v, %v", list, err)
	}
}

// --- the connection test ---

type probeServer struct {
	*httptest.Server
	mu   sync.Mutex
	reqs []string // "METHOD path"
}

func (p *probeServer) requests() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]string(nil), p.reqs...)
}

// newProbeServer answers HEAD /bucket/<key> with keyStatus and HEAD /bucket with
// bucketStatus, and records every request. Any other method fails the test: the
// connection test writes nothing.
func newProbeServer(t *testing.T, keyStatus, bucketStatus int) *probeServer {
	t.Helper()
	p := &probeServer{}
	p.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p.mu.Lock()
		p.reqs = append(p.reqs, r.Method+" "+r.URL.Path)
		p.mu.Unlock()
		if r.Method != http.MethodHead {
			t.Errorf("connection test sent %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if strings.Count(strings.Trim(r.URL.Path, "/"), "/") >= 1 {
			w.WriteHeader(keyStatus)
		} else {
			w.WriteHeader(bucketStatus)
		}
	}))
	t.Cleanup(p.Close)
	return p
}

func (p *probeServer) destination() models.Destination {
	d := validDestination()
	d.Endpoint = p.URL
	return d
}

func testService(t *testing.T) *DestinationService {
	s, _ := newDestService(t)
	s.retryBase = time.Millisecond
	return s
}

func TestDestinationTestTellsTheOutcomesApart(t *testing.T) {
	cases := []struct {
		name       string
		key, bkt   int
		wantStatus string
		wantOK     bool
		wantText   string
	}{
		{"works", 404, 200, DestinationTestOK, true, "Connected"},
		{"works without list rights on the bucket", 404, 403, DestinationTestOK, true, "Connected"},
		{"wrong credentials", 403, 403, DestinationTestCredentials, false, "Wrong credentials"},
		{"no bucket", 404, 404, DestinationTestBucket, false, "Bucket not found"},
		{"server error", 503, 503, DestinationTestError, false, "status 503"},
		{"rejected", 400, 400, DestinationTestError, false, "status 400"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := newProbeServer(t, tc.key, tc.bkt)
			s := testService(t)
			got := s.Test(context.Background(), srv.destination(), destSecret)
			if got.Status != tc.wantStatus || got.OK != tc.wantOK || !strings.Contains(got.Message, tc.wantText) {
				t.Errorf("result = %+v", got)
			}
			assertResultClean(t, got)
		})
	}
}

func TestDestinationTestUnreachable(t *testing.T) {
	srv := newProbeServer(t, 404, 200)
	d := srv.destination()
	srv.Close()
	got := testService(t).Test(context.Background(), d, destSecret)
	if got.Status != DestinationTestUnreachable || got.OK {
		t.Errorf("result = %+v", got)
	}
	assertResultClean(t, got)
}

func TestDestinationTestHeadsAnUnlikelyKeyAndWritesNothing(t *testing.T) {
	srv := newProbeServer(t, 404, 200)
	d := srv.destination()
	d.Prefix = "dh/snapshots"
	testService(t).Test(context.Background(), d, destSecret)

	reqs := srv.requests()
	if len(reqs) != 2 {
		t.Fatalf("requests = %v, want a HEAD of a key then a HEAD of the bucket", reqs)
	}
	if !strings.HasPrefix(reqs[0], "HEAD /snapshots/dh/snapshots/.konnekt-probe-") {
		t.Errorf("first request = %q", reqs[0])
	}
	if reqs[1] != "HEAD /snapshots" {
		t.Errorf("second request = %q", reqs[1])
	}
	// A refused credential needs no second request.
	denied := newProbeServer(t, 403, 403)
	testService(t).Test(context.Background(), denied.destination(), destSecret)
	if n := len(denied.requests()); n != 1 {
		t.Errorf("a 403 took %d requests", n)
	}
}

func TestDestinationTestUsesTheStoredSecretWhenBlank(t *testing.T) {
	var auth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth = r.Header.Get("Authorization")
		if strings.Count(strings.Trim(r.URL.Path, "/"), "/") >= 1 {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)

	s := testService(t)
	d := validDestination()
	d.Endpoint = srv.URL
	saved := mustSave(t, s, d, destSecret)

	if got := s.Test(context.Background(), saved, ""); got.Status != DestinationTestOK {
		t.Fatalf("blank secret: %+v", got)
	}
	if !strings.HasPrefix(auth, "AWS4-HMAC-SHA256 ") {
		t.Errorf("Authorization = %q", auth)
	}
	if got := s.Test(context.Background(), saved, destSecret); got.Status != DestinationTestOK {
		t.Fatalf("typed secret: %+v", got)
	}
}

func TestDestinationTestWithNoSecretAnywhere(t *testing.T) {
	srv := newProbeServer(t, 404, 200)
	got := testService(t).Test(context.Background(), srv.destination(), "")
	if got.Status != DestinationTestInvalid || got.OK {
		t.Errorf("result = %+v", got)
	}
	if n := len(srv.requests()); n != 0 {
		t.Errorf("%d requests went out without a secret", n)
	}
}

func TestDestinationTestRejectsBadSettingsBeforeTheNetwork(t *testing.T) {
	srv := newProbeServer(t, 404, 200)
	d := srv.destination()
	d.Bucket = ""
	got := testService(t).Test(context.Background(), d, destSecret)
	if got.Status != DestinationTestInvalid {
		t.Errorf("result = %+v", got)
	}
	if n := len(srv.requests()); n != 0 {
		t.Errorf("%d requests for an invalid destination", n)
	}
}

// assertResultClean fails when a result carries the secret or anything of the
// request's signature.
func assertResultClean(t *testing.T, r models.DestinationTestResult) {
	t.Helper()
	raw, err := json.Marshal(r)
	if err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{destSecret, "Authorization", "AWS4-HMAC", "Signature="} {
		if strings.Contains(string(raw), bad) {
			t.Errorf("result %s carries %q", raw, bad)
		}
	}
}

// --- redaction ---

func TestDestinationSecretReachesNoErrorLogOrResult(t *testing.T) {
	logs := &captureHandler{}
	prev := slog.Default()
	slog.SetDefault(slog.New(logs))
	t.Cleanup(func() { slog.SetDefault(prev) })

	// A server that answers 400 and reflects the request's Authorization header.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Echo", r.Header.Get("Authorization"))
		w.WriteHeader(http.StatusBadRequest)
	}))
	t.Cleanup(srv.Close)

	s := testService(t)
	d := validDestination()
	d.Endpoint = srv.URL
	var seen []string

	saved, err := s.Save(d, destSecret)
	if err != nil {
		t.Fatal(err)
	}
	r1 := s.Test(context.Background(), saved, "")
	r2 := s.Test(context.Background(), saved, destSecret)
	for _, r := range []models.DestinationTestResult{r1, r2} {
		raw, _ := json.Marshal(r)
		seen = append(seen, string(raw))
	}
	// Errors from every refusal path.
	bad := validDestination()
	bad.Bucket = ""
	_, e1 := s.Save(bad, destSecret)
	_, e2 := s.Save(validDestination(), "")
	e3 := s.Delete("../" + destSecret)
	for _, e := range []error{e1, e2, e3} {
		if e == nil {
			t.Fatal("expected an error")
		}
		seen = append(seen, e.Error())
	}
	seen = append(seen, logs.buf.String())
	for _, text := range seen {
		if strings.Contains(text, destSecret) {
			t.Errorf("secret found in %q", text)
		}
	}
}

// The secret is written before the list, so a secret that cannot be stored leaves
// no destination behind that says it has one.
func TestDestinationSecretWriteFailureLeavesNoListEntry(t *testing.T) {
	s, dir := newDestService(t)
	if err := os.WriteFile(filepath.Join(dir, destinationSecretsDir), []byte("in the way"), 0600); err != nil {
		t.Fatal(err)
	}
	_, err := s.Save(validDestination(), destSecret)
	if err == nil {
		t.Fatal("Save = nil, want an error")
	}
	if strings.Contains(err.Error(), destSecret) {
		t.Errorf("error carries the secret: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, destinationsFile)); !os.IsNotExist(err) {
		t.Errorf("%s written (stat err = %v)", destinationsFile, err)
	}
}
