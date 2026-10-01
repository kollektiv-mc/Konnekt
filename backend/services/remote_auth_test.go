package services

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode"
	"unicode/utf8"

	"konnekt/backend/models"
)

// RemoteAuth against agent_docs/SECURITY_CHECKLIST.md § S8.4 to S8.6 and S8.9.
// Every test but the hash-format one hashes with cheap parameters and reads a
// clock the test advances, so nothing here sleeps and nothing is slow.

const (
	testPassword = "correct horse battery"
	wrongPass    = "definitely the wrong one"
)

var cheapArgon = remoteArgonParams{memory: 64, time: 1, threads: 1}

// newTestAuthClock is a RemoteAuth over dir with cheap hashing and a fake
// clock. The clock is returned as a pointer: assign through it to advance time.
func newTestAuthClock(t *testing.T, dir string) (*RemoteAuth, *time.Time) {
	t.Helper()
	clock := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	a := NewRemoteAuth()
	a.params = cheapArgon
	a.now = func() time.Time { return clock }
	a.SetDataDir(dir)
	return a, &clock
}

// newTestAuthIn is newTestAuthClock for a test that never moves the clock.
func newTestAuthIn(t *testing.T, dir string) *RemoteAuth {
	t.Helper()
	a, clock := newTestAuthClock(t, dir)
	if clock == nil {
		t.Fatal("no clock")
	}
	return a
}

func newTestAuth(t *testing.T) *RemoteAuth {
	t.Helper()
	return newTestAuthIn(t, t.TempDir())
}

// newPasswordAuthClock is a test auth with testPassword already set.
func newPasswordAuthClock(t *testing.T) (*RemoteAuth, *time.Time) {
	t.Helper()
	a, clock := newTestAuthClock(t, t.TempDir())
	if err := a.SetPassword(testPassword); err != nil {
		t.Fatal(err)
	}
	return a, clock
}

func newPasswordAuth(t *testing.T) *RemoteAuth {
	t.Helper()
	a, clock := newPasswordAuthClock(t)
	if clock == nil {
		t.Fatal("no clock")
	}
	return a
}

func loginJSON(t *testing.T, password string) string {
	t.Helper()
	b, err := json.Marshal(map[string]string{"password": password})
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func jsonRequest(path, body string, cookies ...*http.Cookie) *http.Request {
	r := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	for _, c := range cookies {
		r.AddCookie(c)
	}
	return r
}

func postLogin(t *testing.T, a *RemoteAuth, password string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	a.ServeLogin(w, jsonRequest("/api/login", loginJSON(t, password), cookies...))
	return w
}

func postWait(a *RemoteAuth, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	a.ServeLoginWait(w, jsonRequest("/api/login/wait", "{}", cookies...))
	return w
}

func findCookie(w *httptest.ResponseRecorder, name string) *http.Cookie {
	for _, c := range w.Result().Cookies() {
		if c.Name == name {
			return c
		}
	}
	return nil
}

func authorizeWith(a *RemoteAuth, cookies ...*http.Cookie) (RemoteSession, error) {
	r := httptest.NewRequest(http.MethodGet, "/api/rpc", nil)
	for _, c := range cookies {
		r.AddCookie(c)
	}
	return a.Authorize(r)
}

func expectStatus(t *testing.T, what string, w *httptest.ResponseRecorder, want int) {
	t.Helper()
	if w.Code != want {
		t.Fatalf("%s: status %d, want %d (%s)", what, w.Code, want, strings.TrimSpace(w.Body.String()))
	}
}

// requestForCode finds the pending request a 202 body named by its code.
func requestForCode(t *testing.T, a *RemoteAuth, w *httptest.ResponseRecorder) models.RemotePendingDevice {
	t.Helper()
	var body remotePendingResponse
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("pending body %q: %v", w.Body.String(), err)
	}
	for _, p := range a.Pending() {
		if p.Code == body.Code {
			return p
		}
	}
	t.Fatalf("no pending request with code %q in %+v", body.Code, a.Pending())
	return models.RemotePendingDevice{}
}

// signIn takes a brand-new browser through the whole approval and returns its
// device cookie and first session cookie.
func signIn(t *testing.T, a *RemoteAuth, name string) (device, session *http.Cookie) {
	t.Helper()
	w := postLogin(t, a, testPassword)
	expectStatus(t, "first sign-in", w, http.StatusAccepted)
	device = findCookie(w, remoteDeviceCookie)
	if device == nil {
		t.Fatal("no device cookie on the pending response")
	}
	p := requestForCode(t, a, w)
	if err := a.ApproveDevice(p.ID, name); err != nil {
		t.Fatal(err)
	}
	w = postWait(a, device)
	expectStatus(t, "wait after approval", w, http.StatusNoContent)
	session = findCookie(w, remoteSessionCookie)
	if session == nil {
		t.Fatal("no session cookie on the approved wait")
	}
	return device, session
}

// signInAgain is an approved device signing in with the password alone.
func signInAgain(t *testing.T, a *RemoteAuth, device *http.Cookie) *http.Cookie {
	t.Helper()
	w := postLogin(t, a, testPassword, device)
	expectStatus(t, "approved device sign-in", w, http.StatusNoContent)
	c := findCookie(w, remoteSessionCookie)
	if c == nil {
		t.Fatal("no session cookie on an approved device's sign-in")
	}
	return c
}

func deviceIDByName(t *testing.T, a *RemoteAuth, name string) string {
	t.Helper()
	for _, d := range a.Devices() {
		if d.Name == name {
			return d.ID
		}
	}
	t.Fatalf("no device named %q in %+v", name, a.Devices())
	return ""
}

func sessionIDOf(t *testing.T, a *RemoteAuth, session *http.Cookie) string {
	t.Helper()
	s, err := authorizeWith(a, session)
	if err != nil {
		t.Fatalf("session should be valid: %v", err)
	}
	return s.ID
}

// § S8.4: the password is an argon2id hash in the PHC form, salted, and the
// file that holds it never sees the plaintext.
func TestRemotePasswordIsStoredAsAnArgon2idHash(t *testing.T) {
	dir := t.TempDir()
	a := NewRemoteAuth() // default parameters on purpose
	a.SetDataDir(dir)
	if err := a.SetPassword(testPassword); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "remote.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var state struct {
		Password string `json:"password"`
	}
	if err := json.Unmarshal(raw, &state); err != nil {
		t.Fatal(err)
	}
	format := regexp.MustCompile(`^\$argon2id\$v=19\$m=65536,t=3,p=4\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$`)
	if !format.MatchString(state.Password) {
		t.Errorf("stored password %q is not an argon2id PHC string at the default cost", state.Password)
	}
	if strings.Contains(string(raw), testPassword) {
		t.Error("the plaintext password is in remote.json")
	}

	again, err := hashRemotePassword(testPassword, remoteDefaultArgon)
	if err != nil {
		t.Fatal(err)
	}
	if again == state.Password {
		t.Error("the same password hashed to the same string twice: no salt")
	}
	if !verifyRemotePassword(testPassword, state.Password) {
		t.Error("the right password does not verify")
	}
	if verifyRemotePassword(wrongPass, state.Password) {
		t.Error("a wrong password verifies")
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0600 {
			t.Errorf("remote.json mode %o, want 0600", info.Mode().Perm())
		}
	}
}

// A stored hash that is not one of ours, or that asks for more than the bounds
// allow, is a failed sign-in and never an allocation.
func TestRemoteVerifyRefusesMalformedHashes(t *testing.T) {
	good, err := hashRemotePassword(testPassword, cheapArgon)
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(good, "$")
	salt, key := parts[4], parts[5]
	if !verifyRemotePassword(testPassword, good) {
		t.Fatal("control: the well-formed hash does not verify")
	}
	phc := func(algo, version, params, s, k string) string {
		return fmt.Sprintf("$%s$%s$%s$%s$%s", algo, version, params, s, k)
	}
	cases := []struct {
		name    string
		encoded string
	}{
		{"empty", ""},
		{"argon2i", phc("argon2i", "v=19", "m=64,t=1,p=1", salt, key)},
		{"wrong version", phc("argon2id", "v=16", "m=64,t=1,p=1", salt, key)},
		{"huge memory", phc("argon2id", "v=19", "m=4294967295,t=1,p=1", salt, key)},
		{"zero passes", phc("argon2id", "v=19", "m=64,t=0,p=1", salt, key)},
		{"zero threads", phc("argon2id", "v=19", "m=64,t=1,p=0", salt, key)},
		{"bad salt base64", phc("argon2id", "v=19", "m=64,t=1,p=1", "!!!!", key)},
		{"bad key base64", phc("argon2id", "v=19", "m=64,t=1,p=1", salt, "!!!!")},
		{"too few segments", "$argon2id$v=19$m=64,t=1,p=1$" + salt},
	}
	for _, tc := range cases {
		start := time.Now()
		if verifyRemotePassword(testPassword, tc.encoded) {
			t.Errorf("%s: verified", tc.name)
		}
		if elapsed := time.Since(start); elapsed > time.Second {
			t.Errorf("%s: took %v to refuse; the bounds are not checked before the derivation", tc.name, elapsed)
		}
	}
}

// The length is in characters, not bytes.
func TestRemoteSetPasswordChecksLengthInRunes(t *testing.T) {
	a := newTestAuth(t)
	cases := []struct {
		name     string
		password string
		ok       bool
	}{
		{"11 characters", strings.Repeat("a", 11), false},
		{"12 characters", strings.Repeat("a", 12), true},
		{"256 characters", strings.Repeat("a", 256), true},
		{"257 characters", strings.Repeat("a", 257), false},
		{"11 multi-byte characters", strings.Repeat("é", 11), false},
		{"12 multi-byte characters", strings.Repeat("é", 12), true},
		{"256 multi-byte characters", strings.Repeat("é", 256), true},
		{"257 multi-byte characters", strings.Repeat("é", 257), false},
	}
	for _, tc := range cases {
		err := a.SetPassword(tc.password)
		if tc.ok && err != nil {
			t.Errorf("%s: %v, want accepted", tc.name, err)
		}
		if !tc.ok && !errors.Is(err, ErrRemotePasswordLength) {
			t.Errorf("%s: %v, want ErrRemotePasswordLength", tc.name, err)
		}
	}
}

// Nothing to sign in against is a refusal, not an open door.
func TestRemoteSignInBeforeAPasswordIsSetIsForbidden(t *testing.T) {
	a := newTestAuth(t)
	expectStatus(t, "sign-in with no password set", postLogin(t, a, testPassword), http.StatusForbidden)
	expectStatus(t, "wait with nothing pending", postWait(a), http.StatusForbidden)
	if a.PasswordSet() {
		t.Error("PasswordSet is true on a fresh service")
	}
}

// § S8.4: five free mistakes, then a wait that doubles to a cap, forgiven after
// an hour. The right password is refused during a wait too.
func TestRemoteLoginBackoffLocksAfterFiveFailures(t *testing.T) {
	a, clock := newPasswordAuthClock(t)
	for i := 1; i <= 5; i++ {
		expectStatus(t, fmt.Sprintf("wrong password %d", i), postLogin(t, a, wrongPass), http.StatusUnauthorized)
	}
	w := postLogin(t, a, wrongPass)
	expectStatus(t, "sixth wrong password", w, http.StatusTooManyRequests)
	if got := w.Header().Get("Retry-After"); got != "5" {
		t.Errorf("Retry-After = %q, want 5", got)
	}
	w = postLogin(t, a, testPassword)
	expectStatus(t, "right password during the lock", w, http.StatusTooManyRequests)
	if got := w.Header().Get("Retry-After"); got != "5" {
		t.Errorf("Retry-After on the right password = %q, want 5", got)
	}

	*clock = clock.Add(6 * time.Second)
	expectStatus(t, "right password after the lock", postLogin(t, a, testPassword), http.StatusAccepted)
}

func TestRemoteLoginBackoffDoublesCapsAndResets(t *testing.T) {
	a, clock := newPasswordAuthClock(t)
	for i := 1; i <= 5; i++ {
		expectStatus(t, "free failure", postLogin(t, a, wrongPass), http.StatusUnauthorized)
	}
	wait := 5 * time.Second
	var seen []string
	for i := 0; i < 10; i++ {
		w := postLogin(t, a, testPassword)
		expectStatus(t, "attempt during a lock", w, http.StatusTooManyRequests)
		want := strconv.Itoa(int(wait / time.Second))
		seen = append(seen, want)
		if got := w.Header().Get("Retry-After"); got != want {
			t.Fatalf("lock %d: Retry-After %q, want %s (sequence so far %v)", i, got, want, seen)
		}
		*clock = clock.Add(wait + time.Second)
		expectStatus(t, "failure after a lock", postLogin(t, a, wrongPass), http.StatusUnauthorized)
		wait = min(wait*2, 15*time.Minute)
	}
	if got := seen[len(seen)-1]; got != "900" {
		t.Errorf("the wait ended at %s s, want it capped at 900 (15 minutes): %v", got, seen)
	}

	// An hour without a failure forgets them all: five free mistakes again.
	*clock = clock.Add(time.Hour + time.Second)
	for i := 1; i <= 5; i++ {
		expectStatus(t, fmt.Sprintf("failure %d after the quiet hour", i), postLogin(t, a, wrongPass), http.StatusUnauthorized)
	}
	w := postLogin(t, a, wrongPass)
	expectStatus(t, "sixth failure after the quiet hour", w, http.StatusTooManyRequests)
	if got := w.Header().Get("Retry-After"); got != "5" {
		t.Errorf("Retry-After after the reset = %q, want 5, not the old escalated wait", got)
	}
}

// § S8.4: the key is not the source address, so a stranger cannot lock the
// owner's phone out of its own sign-in.
func TestRemoteLoginBucketsAreKeyedPerApprovedDevice(t *testing.T) {
	a := newPasswordAuth(t)
	device, first := signIn(t, a, "Phone")
	if _, err := authorizeWith(a, first); err != nil {
		t.Fatalf("the first session should be valid: %v", err)
	}

	for i := 1; i <= 5; i++ {
		expectStatus(t, "stranger failure", postLogin(t, a, wrongPass), http.StatusUnauthorized)
	}
	expectStatus(t, "stranger after exhausting the shared bucket", postLogin(t, a, testPassword), http.StatusTooManyRequests)
	expectStatus(t, "approved device in the same instant", postLogin(t, a, testPassword, device), http.StatusNoContent)

	// And the other way round: the device's own failures lock the device only.
	for i := 1; i <= 5; i++ {
		expectStatus(t, "device failure", postLogin(t, a, wrongPass, device), http.StatusUnauthorized)
	}
	expectStatus(t, "device after its own failures", postLogin(t, a, testPassword, device), http.StatusTooManyRequests)
}

// § S8.6: the right password from a browser nobody approved yields a request
// and a code and no session, until the desktop says yes.
func TestRemoteUnapprovedDeviceGetsNoSessionUntilApproved(t *testing.T) {
	a := newPasswordAuth(t)

	w := postLogin(t, a, testPassword)
	expectStatus(t, "right password, unknown device", w, http.StatusAccepted)
	var body struct {
		Pending bool   `json:"pending"`
		Code    string `json:"code"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("body %q: %v", w.Body.String(), err)
	}
	if !body.Pending || !regexp.MustCompile(`^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$`).MatchString(body.Code) {
		t.Errorf("body %+v, want pending with a code like ABC-234", body)
	}
	device := findCookie(w, remoteDeviceCookie)
	if device == nil {
		t.Fatal("no device cookie on the pending response")
	}
	if findCookie(w, remoteSessionCookie) != nil {
		t.Fatal("a session cookie was issued before approval")
	}
	if _, err := authorizeWith(a, device); err == nil {
		t.Fatal("Authorize accepted a request carrying only the device cookie")
	}

	pending := a.Pending()
	if len(pending) != 1 || pending[0].Code != body.Code {
		t.Fatalf("Pending() = %+v, want exactly the one request with code %s", pending, body.Code)
	}
	expectStatus(t, "poll while pending", postWait(a, device), http.StatusAccepted)
	if findCookie(postWait(a, device), remoteSessionCookie) != nil {
		t.Fatal("a session cookie was issued by a poll before approval")
	}

	if err := a.ApproveDevice(pending[0].ID, "Phone"); err != nil {
		t.Fatal(err)
	}
	w = postWait(a, device)
	expectStatus(t, "poll after approval", w, http.StatusNoContent)
	session := findCookie(w, remoteSessionCookie)
	if session == nil {
		t.Fatal("no session cookie after approval")
	}
	got, err := authorizeWith(a, session)
	if err != nil {
		t.Fatalf("Authorize with the new session: %v", err)
	}
	if got.Device != "Phone" || got.ID == "" {
		t.Errorf("session = %+v, want device Phone and a non-empty id", got)
	}
	if len(a.Pending()) != 0 {
		t.Errorf("Pending() = %+v after approval, want none", a.Pending())
	}
	devices := a.Devices()
	if len(devices) != 1 || devices[0].Name != "Phone" || devices[0].Sessions != 1 {
		t.Errorf("Devices() = %+v, want one Phone with one session", devices)
	}
	expectStatus(t, "second poll after the grant was collected", postWait(a, device), http.StatusForbidden)
}

func TestRemoteDeniedRequestIsRefusedAndCannotBeApproved(t *testing.T) {
	a := newPasswordAuth(t)
	w := postLogin(t, a, testPassword)
	expectStatus(t, "sign-in", w, http.StatusAccepted)
	device := findCookie(w, remoteDeviceCookie)
	id := requestForCode(t, a, w).ID

	if err := a.DenyDevice(id); err != nil {
		t.Fatal(err)
	}
	expectStatus(t, "poll after a denial", postWait(a, device), http.StatusForbidden)
	if err := a.ApproveDevice(id, "Phone"); !errors.Is(err, ErrRemoteRequestGone) {
		t.Errorf("ApproveDevice after a denial = %v, want ErrRemoteRequestGone", err)
	}
	if err := a.DenyDevice(id); !errors.Is(err, ErrRemoteRequestGone) {
		t.Errorf("a second DenyDevice = %v, want ErrRemoteRequestGone", err)
	}
}

// A request nobody answers lapses after five minutes.
func TestRemotePendingRequestExpires(t *testing.T) {
	t.Run("poll first", func(t *testing.T) {
		a, clock := newPasswordAuthClock(t)
		w := postLogin(t, a, testPassword)
		expectStatus(t, "sign-in", w, http.StatusAccepted)
		device := findCookie(w, remoteDeviceCookie)
		id := requestForCode(t, a, w).ID

		*clock = clock.Add(5*time.Minute + time.Second)
		expectStatus(t, "poll after expiry", postWait(a, device), http.StatusForbidden)
		if err := a.ApproveDevice(id, "Phone"); !errors.Is(err, ErrRemoteRequestGone) {
			t.Errorf("ApproveDevice after expiry = %v, want ErrRemoteRequestGone", err)
		}
	})
	t.Run("approve first", func(t *testing.T) {
		a, clock := newPasswordAuthClock(t)
		w := postLogin(t, a, testPassword)
		id := requestForCode(t, a, w).ID
		*clock = clock.Add(5*time.Minute + time.Second)
		if err := a.ApproveDevice(id, "Phone"); !errors.Is(err, ErrRemoteRequestGone) {
			t.Errorf("ApproveDevice after expiry = %v, want ErrRemoteRequestGone", err)
		}
		if len(a.Pending()) != 0 {
			t.Errorf("Pending() = %+v after expiry", a.Pending())
		}
	})
	t.Run("still waiting just inside five minutes", func(t *testing.T) {
		a, clock := newPasswordAuthClock(t)
		w := postLogin(t, a, testPassword)
		device := findCookie(w, remoteDeviceCookie)
		*clock = clock.Add(5 * time.Minute)
		expectStatus(t, "poll at exactly five minutes", postWait(a, device), http.StatusAccepted)
	})
}

// At most three requests wait at once, so a stranger with the password cannot
// bury the desktop's prompt list.
func TestRemotePendingRequestsAreCapped(t *testing.T) {
	a := newPasswordAuth(t)
	for i := 1; i <= 3; i++ {
		expectStatus(t, fmt.Sprintf("request %d", i), postLogin(t, a, testPassword), http.StatusAccepted)
	}
	w := postLogin(t, a, testPassword)
	expectStatus(t, "fourth request", w, http.StatusTooManyRequests)
	if n, err := strconv.Atoi(w.Header().Get("Retry-After")); err != nil || n <= 0 {
		t.Errorf("Retry-After = %q, want a positive number of seconds", w.Header().Get("Retry-After"))
	}
	if len(a.Pending()) != 3 {
		t.Errorf("Pending() holds %d requests, want 3", len(a.Pending()))
	}
}

// § S8.5: both cookies are HttpOnly, Secure, SameSite=Strict, and their values
// are 256 random bits.
func TestRemoteCookiesAreHardenedAndUnguessable(t *testing.T) {
	a := newPasswordAuth(t)
	device, first := signIn(t, a, "Phone")
	second := signInAgain(t, a, device)

	for _, c := range []*http.Cookie{device, first, second} {
		if !c.HttpOnly || !c.Secure || c.SameSite != http.SameSiteStrictMode || c.Path != "/" {
			t.Errorf("cookie %s: HttpOnly=%v Secure=%v SameSite=%v Path=%q; want true true Strict /",
				c.Name, c.HttpOnly, c.Secure, c.SameSite, c.Path)
		}
		raw, err := base64.RawURLEncoding.DecodeString(c.Value)
		if err != nil || len(raw) != 32 {
			t.Errorf("cookie %s value %q: decoded %d bytes (%v), want 32", c.Name, c.Value, len(raw), err)
		}
	}
	if first.Value == second.Value {
		t.Error("two sign-ins produced the same session token")
	}
	if first.Value == device.Value {
		t.Error("the session token equals the device token")
	}
}

// § S8.5: an hour idle ends a session, twelve hours ends it however busy it is,
// and SessionAlive counts as use.
func TestRemoteSessionsExpire(t *testing.T) {
	a, clock := newPasswordAuthClock(t)
	device, first := signIn(t, a, "Phone")
	if _, err := authorizeWith(a, first); err != nil {
		t.Fatalf("the first session should be valid: %v", err)
	}

	t.Run("idle", func(t *testing.T) {
		s := signInAgain(t, a, device)
		*clock = clock.Add(59 * time.Minute)
		if _, err := authorizeWith(a, s); err != nil {
			t.Fatalf("59 minutes idle: %v", err)
		}
		// That use slid the limit, so a fresh session shows the hour itself.
		s = signInAgain(t, a, device)
		*clock = clock.Add(time.Hour + time.Second)
		if _, err := authorizeWith(a, s); err == nil {
			t.Fatal("a session unused for more than an hour was accepted")
		}
	})

	t.Run("absolute", func(t *testing.T) {
		s := signInAgain(t, a, device)
		for i := 1; i <= 24; i++ {
			*clock = clock.Add(30 * time.Minute)
			if _, err := authorizeWith(a, s); err != nil {
				t.Fatalf("used every 30 minutes, refused after %v: %v", time.Duration(i)*30*time.Minute, err)
			}
		}
		*clock = clock.Add(30 * time.Minute)
		if _, err := authorizeWith(a, s); err == nil {
			t.Fatal("a session older than 12 hours was accepted although it was in constant use")
		}
	})

	t.Run("SessionAlive", func(t *testing.T) {
		s := signInAgain(t, a, device)
		id := sessionIDOf(t, a, s)
		*clock = clock.Add(50 * time.Minute)
		if !a.SessionAlive(id) {
			t.Fatal("SessionAlive false inside the idle limit")
		}
		*clock = clock.Add(50 * time.Minute) // 100 minutes since issue, 50 since it was asked about
		if _, err := authorizeWith(a, s); err != nil {
			t.Fatalf("SessionAlive did not slide the idle limit: %v", err)
		}
		*clock = clock.Add(61 * time.Minute)
		if a.SessionAlive(id) {
			t.Error("SessionAlive true for a session idle more than an hour")
		}
		if a.SessionAlive("0000000000000000") {
			t.Error("SessionAlive true for an unknown id")
		}
	})
}

// § S8.5: every session can be revoked from the desktop; the devices stay
// approved.
func TestRemoteRevokeSessionsEndsThemAllAndKeepsDevices(t *testing.T) {
	a := newPasswordAuth(t)
	var told []string
	a.OnRevoke(func(ids []string) { told = append(told, ids...) })
	phone, phoneSession := signIn(t, a, "Phone")
	tablet, tabletSession := signIn(t, a, "Tablet")
	want := []string{sessionIDOf(t, a, phoneSession), sessionIDOf(t, a, tabletSession)}

	a.RevokeSessions()

	for name, s := range map[string]*http.Cookie{"Phone": phoneSession, "Tablet": tabletSession} {
		if _, err := authorizeWith(a, s); err == nil {
			t.Errorf("%s's session survived RevokeSessions", name)
		}
	}
	sort.Strings(told)
	sort.Strings(want)
	if !slices.Equal(told, want) {
		t.Errorf("OnRevoke told %v, want %v", told, want)
	}
	if len(a.Devices()) != 2 {
		t.Errorf("Devices() = %+v, want both still approved", a.Devices())
	}
	for name, d := range map[string]*http.Cookie{"Phone": phone, "Tablet": tablet} {
		w := postLogin(t, a, testPassword, d)
		if w.Code != http.StatusNoContent {
			t.Errorf("%s: password plus device cookie after revocation = %d, want 204", name, w.Code)
		}
	}
}

func TestRemoteRemoveDeviceEndsItsSessionsOnly(t *testing.T) {
	a := newPasswordAuth(t)
	var told []string
	a.OnRevoke(func(ids []string) { told = append(told, ids...) })
	phone, phoneSession := signIn(t, a, "Phone")
	_, tabletSession := signIn(t, a, "Tablet")
	phoneSessionID := sessionIDOf(t, a, phoneSession)

	if err := a.RemoveDevice(deviceIDByName(t, a, "Phone")); err != nil {
		t.Fatal(err)
	}
	if _, err := authorizeWith(a, phoneSession); err == nil {
		t.Error("the removed device's session still authorizes")
	}
	if !slices.Equal(told, []string{phoneSessionID}) {
		t.Errorf("OnRevoke told %v, want only %v", told, []string{phoneSessionID})
	}
	if s, err := authorizeWith(a, tabletSession); err != nil || s.Device != "Tablet" {
		t.Errorf("the other device's session: %+v, %v; want it unaffected", s, err)
	}
	if devices := a.Devices(); len(devices) != 1 || devices[0].Name != "Tablet" {
		t.Errorf("Devices() = %+v, want only Tablet", devices)
	}
	// Its cookie is a stranger's now: the right password gets a request, not a session.
	w := postLogin(t, a, testPassword, phone)
	expectStatus(t, "removed device with the right password", w, http.StatusAccepted)
	if findCookie(w, remoteSessionCookie) != nil {
		t.Error("a removed device got a session without approval")
	}
	if err := a.RemoveDevice("nope"); !errors.Is(err, ErrRemoteDeviceUnknown) {
		t.Errorf("RemoveDevice(unknown) = %v, want ErrRemoteDeviceUnknown", err)
	}
}

// Changing the password ends what the old one earned.
func TestRemoteSetPasswordEndsSessionsAndPendingRequests(t *testing.T) {
	a := newPasswordAuth(t)
	var told []string
	a.OnRevoke(func(ids []string) { told = append(told, ids...) })
	device, session := signIn(t, a, "Phone")
	expectStatus(t, "a stranger's request", postLogin(t, a, testPassword), http.StatusAccepted)
	if len(a.Pending()) != 1 {
		t.Fatalf("setup: Pending() = %+v", a.Pending())
	}

	const next = "a different long passphrase"
	if err := a.SetPassword(next); err != nil {
		t.Fatal(err)
	}
	if _, err := authorizeWith(a, session); err == nil {
		t.Error("a session survived a password change")
	}
	if len(told) != 1 {
		t.Errorf("OnRevoke told %v, want the one session", told)
	}
	if len(a.Pending()) != 0 {
		t.Errorf("Pending() = %+v after a password change, want none", a.Pending())
	}
	expectStatus(t, "old password", postLogin(t, a, testPassword, device), http.StatusUnauthorized)
	expectStatus(t, "new password", postLogin(t, a, next, device), http.StatusNoContent)
}

func TestRemoteDeviceNames(t *testing.T) {
	a := newPasswordAuth(t)
	for name, bad := range map[string]string{
		"empty":               "",
		"whitespace only":     "  \t ",
		"41 characters":       strings.Repeat("a", 41),
		"control character":   "Ph\x07one",
		"newline":             "Ph\none",
		"41 multi-byte runes": strings.Repeat("é", 41),
	} {
		// The name is judged before the request is looked up.
		if err := a.ApproveDevice("anything", bad); !errors.Is(err, ErrRemoteDeviceName) {
			t.Errorf("%s: %v, want ErrRemoteDeviceName", name, err)
		}
	}

	approve := func(name string) error {
		w := postLogin(t, a, testPassword)
		expectStatus(t, "sign-in", w, http.StatusAccepted)
		return a.ApproveDevice(requestForCode(t, a, w).ID, name)
	}
	if err := approve("  Laptop  "); err != nil {
		t.Fatal(err)
	}
	if err := approve("laptop"); !errors.Is(err, ErrRemoteDeviceExists) {
		t.Errorf("a duplicate differing only in case: %v, want ErrRemoteDeviceExists", err)
	}
	if err := approve(strings.Repeat("é", 40)); err != nil {
		t.Errorf("40 multi-byte characters: %v, want accepted", err)
	}
	var names []string
	for _, d := range a.Devices() {
		names = append(names, d.Name)
	}
	if !slices.Contains(names, "Laptop") {
		t.Errorf("Devices() names %q; want the trimmed %q", names, "Laptop")
	}
}

// § S2.3: remote.json survives a restart and holds nothing usable. Sessions do
// not survive: they live in memory only.
func TestRemoteStatePersistsWithoutSecrets(t *testing.T) {
	dir := t.TempDir()
	a := newTestAuthIn(t, dir)
	if err := a.SetPassword(testPassword); err != nil {
		t.Fatal(err)
	}
	device, session := signIn(t, a, "Phone")

	raw, err := os.ReadFile(filepath.Join(dir, "remote.json"))
	if err != nil {
		t.Fatal(err)
	}
	for what, secret := range map[string]string{
		"the password":      testPassword,
		"the device token":  device.Value,
		"the session token": session.Value,
	} {
		if strings.Contains(string(raw), secret) {
			t.Errorf("remote.json contains %s", what)
		}
	}

	b := newTestAuthIn(t, dir)
	if !b.PasswordSet() {
		t.Error("PasswordSet is false after a reload")
	}
	if _, err := authorizeWith(b, session); err == nil {
		t.Error("a session survived a restart; sessions are memory only")
	}
	if devices := b.Devices(); len(devices) != 1 || devices[0].Name != "Phone" {
		t.Errorf("Devices() after reload = %+v, want Phone", devices)
	}
	expectStatus(t, "known device after a reload", postLogin(t, b, testPassword, device), http.StatusNoContent)
}

func TestRemoteCorruptStateLoadsAsEmptyAndRefusesSignIn(t *testing.T) {
	captureLog(t) // the parse error is logged; keep it out of the test output
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "remote.json"), []byte("{this is not json"), 0600); err != nil {
		t.Fatal(err)
	}
	a := newTestAuthIn(t, dir)
	if a.PasswordSet() {
		t.Error("PasswordSet is true for a corrupt file")
	}
	expectStatus(t, "sign-in against corrupt state", postLogin(t, a, testPassword), http.StatusForbidden)
	if len(a.Devices()) != 0 {
		t.Errorf("Devices() = %+v from a corrupt file", a.Devices())
	}
}

// lockedBuffer is a log sink that two goroutines can write to.
type lockedBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (l *lockedBuffer) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.Write(p)
}

func (l *lockedBuffer) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.String()
}

// § S8.9: a sign-in is logged by device name, and no credential, guess or
// browser string reaches the log. Swaps the default logger, so it must not run
// in parallel.
func TestRemoteSignInLogsTheDeviceAndNoCredential(t *testing.T) {
	var buf lockedBuffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	t.Cleanup(func() {
		slog.SetDefault(prev)
		log.SetOutput(os.Stderr)
		log.SetFlags(log.LstdFlags)
	})

	const agent = "SecretAgent/9.9 (UA-MARKER-7f3a)"
	a := newPasswordAuth(t)

	bad := jsonRequest("/api/login", loginJSON(t, wrongPass))
	bad.Header.Set("User-Agent", agent)
	a.ServeLogin(httptest.NewRecorder(), bad)

	good := jsonRequest("/api/login", loginJSON(t, testPassword))
	good.Header.Set("User-Agent", agent)
	w := httptest.NewRecorder()
	a.ServeLogin(w, good)
	expectStatus(t, "pending sign-in", w, http.StatusAccepted)
	device := findCookie(w, remoteDeviceCookie)
	if err := a.ApproveDevice(requestForCode(t, a, w).ID, "Phone"); err != nil {
		t.Fatal(err)
	}
	w = postWait(a, device)
	expectStatus(t, "approved poll", w, http.StatusNoContent)
	session := findCookie(w, remoteSessionCookie)
	expectStatus(t, "direct sign-in", postLogin(t, a, testPassword, device), http.StatusNoContent)

	out := buf.String()
	signedIn := false
	for _, line := range strings.Split(out, "\n") {
		if strings.Contains(line, "signed in") && strings.Contains(line, "device=Phone") {
			signedIn = true
		}
	}
	if !signedIn {
		t.Errorf("no sign-in line naming device=Phone in:\n%s", out)
	}
	for what, secret := range map[string]string{
		"the password":         testPassword,
		"the guessed password": wrongPass,
		"the session token":    session.Value,
		"the device token":     device.Value,
		"the User-Agent":       agent,
	} {
		if strings.Contains(out, secret) {
			t.Errorf("the log contains %s:\n%s", what, out)
		}
	}
}

func TestRemoteLoginRejectsMalformedRequests(t *testing.T) {
	a := newPasswordAuth(t)
	serve := func(r *http.Request) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		a.ServeLogin(w, r)
		return w
	}

	r := jsonRequest("/api/login", loginJSON(t, testPassword))
	r.Header.Set("Content-Type", "text/plain")
	expectStatus(t, "wrong content type", serve(r), http.StatusUnsupportedMediaType)
	expectStatus(t, "unknown field", serve(jsonRequest("/api/login", `{"password":"x","extra":1}`)), http.StatusBadRequest)
	expectStatus(t, "empty password", serve(jsonRequest("/api/login", `{"password":""}`)), http.StatusBadRequest)
	expectStatus(t, "no password field", serve(jsonRequest("/api/login", `{}`)), http.StatusBadRequest)
	expectStatus(t, "not JSON", serve(jsonRequest("/api/login", `password=x`)), http.StatusBadRequest)
	expectStatus(t, "body over 4 KiB", serve(jsonRequest("/api/login", loginJSON(t, strings.Repeat("a", 5000)))), http.StatusBadRequest)

	// None of those is a counted failure: the right password is not locked out.
	expectStatus(t, "right password after malformed requests", postLogin(t, a, testPassword), http.StatusAccepted)
}

// A password longer than SetPassword allows is wrong without being hashed, and
// it still counts.
func TestRemoteOverlongPasswordIsAFailure(t *testing.T) {
	a := newPasswordAuth(t)
	long := strings.Repeat("a", 2000)
	for i := 1; i <= 5; i++ {
		expectStatus(t, fmt.Sprintf("2000-character password %d", i), postLogin(t, a, long), http.StatusUnauthorized)
	}
	expectStatus(t, "after five overlong passwords", postLogin(t, a, testPassword), http.StatusTooManyRequests)
}

// What a browser says about itself is shown on a prompt, so it is clamped.
func TestRemoteUserAgentIsClampedToPrintableAndShort(t *testing.T) {
	a := newPasswordAuth(t)
	agent := "Mozilla\x00/5.0\n(X11)" + strings.Repeat(" Gecko", 100)
	if utf8.RuneCountInString(agent) < 500 {
		t.Fatalf("setup: agent is %d runes, want at least 500", utf8.RuneCountInString(agent))
	}
	r := jsonRequest("/api/login", loginJSON(t, testPassword))
	r.Header.Set("User-Agent", agent)
	w := httptest.NewRecorder()
	a.ServeLogin(w, r)
	expectStatus(t, "sign-in", w, http.StatusAccepted)

	pending := a.Pending()
	if len(pending) != 1 {
		t.Fatalf("Pending() = %+v", pending)
	}
	got := pending[0].UserAgent
	if n := utf8.RuneCountInString(got); n == 0 || n > 120 {
		t.Errorf("user agent is %d runes, want 1 to 120", n)
	}
	if !strings.HasPrefix(got, "Mozilla/5.0(X11)") {
		t.Errorf("user agent %q lost its printable text", got)
	}
	for _, r := range got {
		if !unicode.IsPrint(r) {
			t.Errorf("user agent %q holds the non-printable %U", got, r)
		}
	}
}

// The desktop is told when what it shows has changed, and only then: a wrong
// password changes nothing it shows.
func TestRemoteAuthTellsTheDesktopOfChanges(t *testing.T) {
	auth := newPasswordAuth(t)
	changes := 0
	auth.OnChange(func() { changes++ })
	expect := func(what string, want int) {
		t.Helper()
		if changes != want {
			t.Errorf("after %s: %d changes announced, want %d", what, changes, want)
		}
	}

	expectStatus(t, "wrong password", postLogin(t, auth, wrongPass), http.StatusUnauthorized)
	expect("a wrong password", 0)

	w := postLogin(t, auth, testPassword)
	expectStatus(t, "right password", w, http.StatusAccepted)
	device := findCookie(w, remoteDeviceCookie)
	expect("a device started waiting", 1)

	expectStatus(t, "poll", postWait(auth, device), http.StatusAccepted)
	expect("a poll that changed nothing", 1)

	if err := auth.ApproveDevice(auth.Pending()[0].ID, "Phone"); err != nil {
		t.Fatal(err)
	}
	expect("the approval", 2)
	expectStatus(t, "collecting the session", postWait(auth, device), http.StatusNoContent)
	expect("the session", 3)

	auth.RevokeSessions()
	expect("the revocation", 4)
	auth.RevokeSessions()
	expect("a revocation with nothing to revoke", 4)

	if err := auth.RemoveDevice(deviceIDByName(t, auth, "Phone")); err != nil {
		t.Fatal(err)
	}
	expect("removing the device", 5)
	if err := auth.DenyDevice("nope"); !errors.Is(err, ErrRemoteRequestGone) {
		t.Fatalf("got %v", err)
	}
	expect("a refused deny", 5)
}
