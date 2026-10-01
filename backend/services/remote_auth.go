package services

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"

	"konnekt/backend/models"
)

// RemoteAuth is who may use Remote Access (#45): one password, the devices the
// desktop has approved, and the sessions those devices hold. It is the
// RemoteAuthorizer the listener asks on every /api/rpc and /ws request, and it
// serves the two sign-in endpoints. The acceptance criteria are
// agent_docs/SECURITY_CHECKLIST.md § S8.4 to S8.6 and S8.9.
//
// Three secrets, three treatments:
//
//   - The password is chosen by a person, so it is stored as an argon2id hash
//     and checked in constant time (§ S8.4).
//   - A device token and a session token are 256 bits from crypto/rand, so a
//     fast hash is the right one: SHA-256 of the token is what is kept, on disk
//     for a device and in memory for a session, and the token itself exists
//     only in the browser's cookie jar (§ S8.5).
//
// A right password is not enough on its own. A browser the desktop has never
// approved gets a pending request and a code to compare, and no session until
// someone at the desktop says yes (§ S8.6).
type RemoteAuth struct {
	mu       sync.Mutex
	dir      string
	now      func() time.Time
	params   remoteArgonParams
	state    remoteAuthState
	sessions map[[sha256.Size]byte]*remoteSessionEntry
	pending  map[string]*remotePendingEntry // by request id
	buckets  map[string]*remoteLoginBucket  // by device id; "" is every unapproved caller
	onRevoke func(sessionIDs []string)
	// onChange is told when anything the desktop shows has changed: a device
	// waiting, approved or removed, a session begun or ended. dirty is set
	// under mu where the change happens and spent by flush once mu is free.
	onChange func()
	dirty    bool

	// verifyMu serialises argon2: one derivation holds 64 MiB, and without this
	// a burst of sign-ins would hold that many at once.
	verifyMu sync.Mutex
}

const (
	remoteAuthFile      = "remote.json"
	remoteSessionCookie = "konnekt_session"
	remoteDeviceCookie  = "konnekt_device"

	// remoteTokenBytes is twice the 128 bits § S8.5 asks for.
	remoteTokenBytes = 32

	// A session ends an hour after its last use and twelve hours after it was
	// issued, whichever comes first. An open socket counts as use, so the idle
	// limit is about a closed tab; the absolute one is about a token that
	// leaked, which no amount of use should keep alive.
	remoteSessionIdle = time.Hour
	remoteSessionMax  = 12 * time.Hour

	remoteDeviceCookieAge = 365 * 24 * time.Hour

	// A pending request lives five minutes: long enough to walk to the desktop,
	// short enough that an unanswered prompt is not an open invitation.
	remotePendingTTL = 5 * time.Minute
	// remoteGrantTTL is how long an approved request waits for the browser's
	// next poll to collect its session.
	remoteGrantTTL    = time.Minute
	remoteMaxPending  = 3
	remoteMaxDevices  = 16
	remoteMaxLogin    = 4 << 10 // bytes of sign-in body
	remotePasswordMin = 12
	remotePasswordMax = 256
	remoteNameMax     = 40
	remoteAgentMax    = 120

	// The backoff (§ S8.4). The first failures are free, since people mistype;
	// from there each one doubles the wait up to the cap, and an hour without a
	// failure forgets them. At the cap that is four guesses an hour.
	remoteLoginFree  = 5
	remoteLoginBase  = 5 * time.Second
	remoteLoginCap   = 15 * time.Minute
	remoteLoginQuiet = time.Hour

	// remoteCodeAlphabet leaves out the characters people misread.
	remoteCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
)

var (
	ErrRemotePasswordLength = fmt.Errorf("the password must be %d to %d characters", remotePasswordMin, remotePasswordMax)
	ErrRemoteDeviceName     = fmt.Errorf("the device name must be 1 to %d printable characters", remoteNameMax)
	ErrRemoteDeviceExists   = errors.New("another device already has that name")
	ErrRemoteDeviceUnknown  = errors.New("no such device")
	ErrRemoteRequestGone    = errors.New("that request has expired or was already answered")
	ErrRemoteDevicesFull    = fmt.Errorf("at most %d devices can be approved; remove one first", remoteMaxDevices)
)

// remoteArgonParams are argon2id's cost parameters. The defaults are RFC 9106's
// second recommended set (64 MiB, three passes), which is the one for hosts
// that cannot spare 2 GiB. They travel in the stored hash, so raising them
// later does not strand a password hashed under the old ones.
type remoteArgonParams struct {
	memory  uint32 // KiB
	time    uint32
	threads uint8
}

var remoteDefaultArgon = remoteArgonParams{memory: 64 * 1024, time: 3, threads: 4}

const (
	remoteSaltBytes = 16
	remoteKeyBytes  = 32
)

// remoteAuthState is remote.json. Nothing in it is a usable credential: the
// password is an argon2id hash and each device token a SHA-256 (§ S2.3).
type remoteAuthState struct {
	Password string               `json:"password,omitempty"`
	Devices  []remoteDeviceRecord `json:"devices,omitempty"`
}

type remoteDeviceRecord struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	TokenHash  string `json:"tokenHash"`
	ApprovedAt int64  `json:"approvedAt"`
	LastSeen   int64  `json:"lastSeen"`
}

type remoteSessionEntry struct {
	// id names the session to the listener, which closes its sockets on a
	// revocation. It is not the token and unlocks nothing.
	id       string
	deviceID string
	created  time.Time
	lastSeen time.Time
}

type remotePendingEntry struct {
	id        string
	tokenHash string
	code      string
	userAgent string
	requested time.Time
	expires   time.Time
	// granted is set by ApproveDevice. The browser's next poll trades it for a
	// session, so the desktop's yes never has to reach the phone by itself.
	granted  bool
	deviceID string
}

type remoteLoginBucket struct {
	failures    int
	lastFailure time.Time
	lockedUntil time.Time
	// busy marks a verification in flight, so one caller cannot queue a
	// hundred derivations behind verifyMu before the first failure is counted.
	busy bool
}

func NewRemoteAuth() *RemoteAuth {
	return &RemoteAuth{
		now:      time.Now,
		params:   remoteDefaultArgon,
		sessions: map[[sha256.Size]byte]*remoteSessionEntry{},
		pending:  map[string]*remotePendingEntry{},
		buckets:  map[string]*remoteLoginBucket{},
	}
}

// SetDataDir points the service at the app data directory and loads
// remote.json from it. A missing file is the normal first run; an unreadable
// one is logged and treated as empty, which leaves sign-in refused until a
// password is set again rather than open.
func (a *RemoteAuth) SetDataDir(dir string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.dir = dir
	a.state = remoteAuthState{}
	data, err := os.ReadFile(filepath.Join(dir, remoteAuthFile))
	if errors.Is(err, os.ErrNotExist) {
		return
	}
	if err != nil {
		slog.Error("remote: read auth state", "error", err)
		return
	}
	var state remoteAuthState
	if err := json.Unmarshal(data, &state); err != nil {
		slog.Error("remote: parse auth state", "error", err)
		return
	}
	a.state = state
}

// OnRevoke registers what to tell when sessions end before their time: the
// listener, which closes their sockets. Called with a.mu released.
func (a *RemoteAuth) OnRevoke(fn func(sessionIDs []string)) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.onRevoke = fn
}

// OnChange registers what to tell when the devices, the waiting requests or
// the sessions have changed. It is told that something did, not what: the
// desktop reads the state back. Called with a.mu released.
func (a *RemoteAuth) OnChange(fn func()) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.onChange = fn
}

// flush reports a change made under a.mu. Every exported method that can make
// one defers it first, so it runs last, after the lock is released.
func (a *RemoteAuth) flush() {
	a.mu.Lock()
	fn, dirty := a.onChange, a.dirty
	a.dirty = false
	a.mu.Unlock()
	if dirty && fn != nil {
		fn()
	}
}

func (a *RemoteAuth) saveLocked() error {
	data, err := json.MarshalIndent(a.state, "", "  ") // #nosec G117 -- the field is an argon2id hash, never the password
	if err != nil {
		return fmt.Errorf("remote: encode auth state: %w", err)
	}
	return WritePrivateDataFile(a.dir, remoteAuthFile, data)
}

// ── Password ────────────────────────────────────────────────────────────

func (a *RemoteAuth) PasswordSet() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.state.Password != ""
}

// SetPassword replaces the password and ends every session, since a session
// earned with the old one should not outlive it. Approved devices stay
// approved: the device is the second factor, and changing the first does not
// make a phone a stranger.
func (a *RemoteAuth) SetPassword(password string) error {
	defer a.flush()
	if n := utf8.RuneCountInString(password); n < remotePasswordMin || n > remotePasswordMax || !utf8.ValidString(password) {
		return ErrRemotePasswordLength
	}
	a.mu.Lock()
	params := a.params
	a.mu.Unlock()
	a.verifyMu.Lock()
	hash, err := hashRemotePassword(password, params)
	a.verifyMu.Unlock()
	if err != nil {
		return err
	}

	a.mu.Lock()
	previous := a.state.Password
	a.state.Password = hash
	if err := a.saveLocked(); err != nil {
		a.state.Password = previous
		a.mu.Unlock()
		return err
	}
	a.dirty = true
	a.buckets = map[string]*remoteLoginBucket{}
	// A pending request remembers that the old password was right.
	a.pending = map[string]*remotePendingEntry{}
	revoked, notify := a.dropSessionsLocked(func(*remoteSessionEntry) bool { return true })
	a.mu.Unlock()
	slog.Info("remote: password set", "sessionsEnded", len(revoked))
	notifyRevoked(notify, revoked)
	return nil
}

// hashRemotePassword returns the PHC string form argon2 implementations share:
// $argon2id$v=19$m=65536,t=3,p=4$<salt>$<key>, both unpadded base64.
func hashRemotePassword(password string, p remoteArgonParams) (string, error) {
	salt := make([]byte, remoteSaltBytes)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("remote: salt: %w", err)
	}
	key := argon2.IDKey([]byte(password), salt, p.time, p.memory, p.threads, remoteKeyBytes)
	b64 := base64.RawStdEncoding
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, p.memory, p.time, p.threads, b64.EncodeToString(salt), b64.EncodeToString(key)), nil
}

// verifyRemotePassword re-derives the key under the hash's own parameters and
// compares in constant time. The parameters are bounded first: the file is the
// user's own, but a corrupt one should fail a sign-in, not ask for 4 GiB.
func verifyRemotePassword(password, encoded string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[0] != "" || parts[1] != "argon2id" || parts[2] != "v="+strconv.Itoa(argon2.Version) {
		return false
	}
	var memory, passes uint32
	var threads uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &passes, &threads); err != nil {
		return false
	}
	if memory < 8 || memory > 1<<20 || passes < 1 || passes > 16 || threads < 1 || threads > 16 {
		return false
	}
	b64 := base64.RawStdEncoding
	salt, err := b64.DecodeString(parts[4])
	if err != nil || len(salt) < 8 {
		return false
	}
	want, err := b64.DecodeString(parts[5])
	if err != nil || len(want) < 16 || len(want) > 64 {
		return false
	}
	got := argon2.IDKey([]byte(password), salt, passes, memory, threads, uint32(len(want))) // #nosec G115 -- len(want) is bounded to 64 above
	return subtle.ConstantTimeCompare(got, want) == 1
}

// ── Tokens ──────────────────────────────────────────────────────────────

func newRemoteToken() (string, error) {
	b := make([]byte, remoteTokenBytes)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("remote: token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func newRemoteID() (string, error) {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("remote: id: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// newRemoteCode is the six characters both screens show for a pending request.
// It authenticates nothing: it lets a person match the prompt to their phone.
func newRemoteCode() (string, error) {
	b := make([]byte, 6)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("remote: code: %w", err)
	}
	out := make([]byte, 0, 7)
	for i, v := range b {
		if i == 3 {
			out = append(out, '-')
		}
		// 32 symbols, so a byte's low five bits pick one without bias.
		out = append(out, remoteCodeAlphabet[v&31])
	}
	return string(out), nil
}

func remoteTokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// setRemoteCookie writes a cookie the way § S8.5 asks: HttpOnly, so script
// cannot read it; Secure, so it never travels in the clear; SameSite=Strict,
// so no other site's request carries it. Secure holds on the loopback listener
// too: the browser reaches it through the tunnel's HTTPS, and browsers treat
// localhost as secure for exactly this attribute.
func setRemoteCookie(w http.ResponseWriter, name, value string, maxAge time.Duration) {
	c := &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     "/",
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   int(maxAge / time.Second),
	}
	if maxAge <= 0 {
		c.MaxAge = -1
	}
	http.SetCookie(w, c)
}

// ── Sessions ────────────────────────────────────────────────────────────

func remoteSessionExpired(s *remoteSessionEntry, now time.Time) bool {
	return now.Sub(s.lastSeen) > remoteSessionIdle || now.Sub(s.created) > remoteSessionMax
}

func (a *RemoteAuth) deviceLocked(id string) *remoteDeviceRecord {
	for i := range a.state.Devices {
		if a.state.Devices[i].ID == id {
			return &a.state.Devices[i]
		}
	}
	return nil
}

func (a *RemoteAuth) deviceByTokenLocked(token string) *remoteDeviceRecord {
	if token == "" {
		return nil
	}
	hash := remoteTokenHash(token)
	for i := range a.state.Devices {
		if a.state.Devices[i].TokenHash == hash {
			return &a.state.Devices[i]
		}
	}
	return nil
}

// Authorize answers the session behind a request (RemoteAuthorizer). A use
// slides the idle limit; nothing slides the absolute one.
func (a *RemoteAuth) Authorize(r *http.Request) (RemoteSession, error) {
	c, err := r.Cookie(remoteSessionCookie)
	if err != nil || c.Value == "" {
		return RemoteSession{}, errors.New("no session cookie")
	}
	key := sha256.Sum256([]byte(c.Value))
	a.mu.Lock()
	defer a.mu.Unlock()
	s, ok := a.sessions[key]
	if !ok {
		return RemoteSession{}, errors.New("unknown session")
	}
	now := a.now()
	if remoteSessionExpired(s, now) {
		delete(a.sessions, key)
		return RemoteSession{}, errors.New("session expired")
	}
	device := a.deviceLocked(s.deviceID)
	if device == nil {
		delete(a.sessions, key)
		return RemoteSession{}, errors.New("session's device was removed")
	}
	s.lastSeen = now
	return RemoteSession{ID: s.id, Device: device.Name}, nil
}

// SessionAlive reports whether a session is still good, and counts the asking
// as use. The listener asks it for every open socket at each ping, which is
// what ends a socket whose session expired and keeps alive a session whose
// dashboard is open but quiet.
func (a *RemoteAuth) SessionAlive(id string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := a.now()
	for key, s := range a.sessions {
		if s.id != id {
			continue
		}
		if remoteSessionExpired(s, now) || a.deviceLocked(s.deviceID) == nil {
			delete(a.sessions, key)
			return false
		}
		s.lastSeen = now
		return true
	}
	return false
}

// issueSessionLocked creates a session for an approved device and returns its
// token, which goes into the cookie and nowhere else.
func (a *RemoteAuth) issueSessionLocked(device *remoteDeviceRecord) (string, error) {
	token, err := newRemoteToken()
	if err != nil {
		return "", err
	}
	id, err := newRemoteID()
	if err != nil {
		return "", err
	}
	now := a.now()
	// Expired sessions are otherwise only noticed when their own cookie comes
	// back, which a closed tab never does.
	for key, s := range a.sessions {
		if remoteSessionExpired(s, now) {
			delete(a.sessions, key)
		}
	}
	a.sessions[sha256.Sum256([]byte(token))] = &remoteSessionEntry{id: id, deviceID: device.ID, created: now, lastSeen: now}
	a.dirty = true
	device.LastSeen = now.UnixMilli()
	if err := a.saveLocked(); err != nil {
		// The last-seen stamp is a courtesy; the sign-in stands without it.
		slog.Warn("remote: save last seen", "error", err)
	}
	return token, nil
}

// dropSessionsLocked removes every session match selects and returns their ids
// with the hook to tell, for the caller to invoke once a.mu is released.
func (a *RemoteAuth) dropSessionsLocked(match func(*remoteSessionEntry) bool) ([]string, func([]string)) {
	var ids []string
	for key, s := range a.sessions {
		if match(s) {
			ids = append(ids, s.id)
			delete(a.sessions, key)
			a.dirty = true
		}
	}
	return ids, a.onRevoke
}

func notifyRevoked(notify func([]string), ids []string) {
	if notify != nil && len(ids) > 0 {
		notify(ids)
	}
}

// RevokeSessions ends every session (§ S8.5). Devices stay approved, so each
// signs in again with the password.
func (a *RemoteAuth) RevokeSessions() {
	defer a.flush()
	a.mu.Lock()
	ids, notify := a.dropSessionsLocked(func(*remoteSessionEntry) bool { return true })
	a.mu.Unlock()
	slog.Info("remote: sessions revoked", "count", len(ids))
	notifyRevoked(notify, ids)
}

// ── Devices ─────────────────────────────────────────────────────────────

// Devices lists the approved devices, oldest approval first.
func (a *RemoteAuth) Devices() []models.RemoteDevice {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := a.now()
	live := map[string]int{}
	for _, s := range a.sessions {
		if !remoteSessionExpired(s, now) {
			live[s.deviceID]++
		}
	}
	out := make([]models.RemoteDevice, 0, len(a.state.Devices))
	for _, d := range a.state.Devices {
		out = append(out, models.RemoteDevice{ID: d.ID, Name: d.Name, ApprovedAt: d.ApprovedAt, LastSeen: d.LastSeen, Sessions: live[d.ID]})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ApprovedAt < out[j].ApprovedAt })
	return out
}

// Pending lists the requests waiting for the desktop, oldest first.
func (a *RemoteAuth) Pending() []models.RemotePendingDevice {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.prunePendingLocked()
	out := make([]models.RemotePendingDevice, 0, len(a.pending))
	for _, p := range a.pending {
		if p.granted {
			continue
		}
		out = append(out, models.RemotePendingDevice{ID: p.id, Code: p.code, UserAgent: p.userAgent, RequestedAt: p.requested.UnixMilli()})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].RequestedAt < out[j].RequestedAt })
	return out
}

func (a *RemoteAuth) prunePendingLocked() {
	now := a.now()
	for id, p := range a.pending {
		if now.After(p.expires) {
			delete(a.pending, id)
			a.dirty = true
		}
	}
}

// cleanRemoteName is the desktop's name for a device: trimmed, printable, and
// short enough for a log line and a list row.
func cleanRemoteName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > remoteNameMax {
		return "", ErrRemoteDeviceName
	}
	for _, r := range name {
		if !unicode.IsPrint(r) {
			return "", ErrRemoteDeviceName
		}
	}
	return name, nil
}

// ApproveDevice turns a pending request into an approved device called name
// (§ S8.6). The name is the desktop's, typed by the person approving; nothing
// the browser sent becomes it.
func (a *RemoteAuth) ApproveDevice(requestID, name string) error {
	defer a.flush()
	name, err := cleanRemoteName(name)
	if err != nil {
		return err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.prunePendingLocked()
	p, ok := a.pending[requestID]
	if !ok || p.granted {
		return ErrRemoteRequestGone
	}
	if len(a.state.Devices) >= remoteMaxDevices {
		return ErrRemoteDevicesFull
	}
	for _, d := range a.state.Devices {
		if strings.EqualFold(d.Name, name) {
			return ErrRemoteDeviceExists
		}
	}
	id, err := newRemoteID()
	if err != nil {
		return err
	}
	now := a.now()
	a.state.Devices = append(a.state.Devices, remoteDeviceRecord{ID: id, Name: name, TokenHash: p.tokenHash, ApprovedAt: now.UnixMilli()})
	if err := a.saveLocked(); err != nil {
		a.state.Devices = a.state.Devices[:len(a.state.Devices)-1]
		return err
	}
	p.granted, p.deviceID, p.expires = true, id, now.Add(remoteGrantTTL)
	a.dirty = true
	slog.Info("remote: device approved", "device", name)
	return nil
}

// DenyDevice discards a pending request. The browser's next poll is refused.
func (a *RemoteAuth) DenyDevice(requestID string) error {
	defer a.flush()
	a.mu.Lock()
	defer a.mu.Unlock()
	a.prunePendingLocked()
	p, ok := a.pending[requestID]
	if !ok || p.granted {
		return ErrRemoteRequestGone
	}
	delete(a.pending, requestID)
	a.dirty = true
	slog.Info("remote: device denied", "request", requestID)
	return nil
}

// RemoveDevice forgets an approved device and ends its sessions. Its cookie is
// then a stranger's, and the password alone gets it a pending request again.
func (a *RemoteAuth) RemoveDevice(deviceID string) error {
	defer a.flush()
	a.mu.Lock()
	idx := -1
	for i, d := range a.state.Devices {
		if d.ID == deviceID {
			idx = i
		}
	}
	if idx < 0 {
		a.mu.Unlock()
		return ErrRemoteDeviceUnknown
	}
	removed := a.state.Devices[idx]
	previous := a.state.Devices
	a.state.Devices = append(append([]remoteDeviceRecord{}, previous[:idx]...), previous[idx+1:]...)
	if err := a.saveLocked(); err != nil {
		a.state.Devices = previous
		a.mu.Unlock()
		return err
	}
	delete(a.buckets, deviceID)
	a.dirty = true
	ids, notify := a.dropSessionsLocked(func(s *remoteSessionEntry) bool { return s.deviceID == deviceID })
	a.mu.Unlock()
	slog.Info("remote: device removed", "device", removed.Name, "sessionsEnded", len(ids))
	notifyRevoked(notify, ids)
	return nil
}

// ── Backoff ─────────────────────────────────────────────────────────────

// beginLoginLocked admits one verification for key, or says how long to wait.
// The key is an approved device's id, or "" for everyone else: the source
// address is useless, since every tunnelled request arrives from loopback
// (§ S8.3). The split is what keeps a stranger hammering the tunnel from
// locking the owner's phone out: the stranger exhausts the shared bucket, and
// the phone, which holds a device cookie, has its own.
func (a *RemoteAuth) beginLoginLocked(key string) (time.Duration, bool) {
	now := a.now()
	b := a.buckets[key]
	if b == nil {
		b = &remoteLoginBucket{}
		a.buckets[key] = b
	}
	if b.failures > 0 && now.Sub(b.lastFailure) > remoteLoginQuiet {
		b.failures = 0
	}
	if now.Before(b.lockedUntil) {
		return b.lockedUntil.Sub(now), false
	}
	if b.busy {
		return time.Second, false
	}
	b.busy = true
	return 0, true
}

func (a *RemoteAuth) endLoginLocked(key string, ok bool) {
	b := a.buckets[key]
	if b == nil {
		return
	}
	b.busy = false
	if ok {
		b.failures = 0
		b.lockedUntil = time.Time{}
		return
	}
	now := a.now()
	b.failures++
	b.lastFailure = now
	if over := b.failures - remoteLoginFree; over >= 0 {
		wait := remoteLoginCap
		if over < 16 {
			wait = min(remoteLoginBase<<over, remoteLoginCap)
		}
		b.lockedUntil = now.Add(wait)
	}
}

// ── Sign-in endpoints ───────────────────────────────────────────────────

type remoteLoginRequest struct {
	Password string `json:"password"`
}

type remotePendingResponse struct {
	Pending bool   `json:"pending"`
	Code    string `json:"code"`
}

func remoteCookieValue(r *http.Request, name string) string {
	c, err := r.Cookie(name)
	if err != nil {
		return ""
	}
	return c.Value
}

// cleanRemoteAgent clamps what a browser says about itself to something a
// prompt can show: printable, and short.
func cleanRemoteAgent(ua string) string {
	var b strings.Builder
	n := 0
	for _, r := range ua {
		if n >= remoteAgentMax {
			break
		}
		if unicode.IsPrint(r) {
			b.WriteRune(r)
			n++
		}
	}
	return b.String()
}

// ServeLogin is POST /api/login. The listener's guard has already judged Host
// and Origin, so this starts at the password. It reports whether a session was
// issued, which the listener counts as activity; a pending request is not one,
// or anyone holding the password could keep the listener up by asking.
//
//	204  signed in; the session is in the Set-Cookie
//	202  right password, device not approved yet: {"pending":true,"code":"…"}
//	401  wrong password
//	403  no password has been set on the desktop
//	429  backoff, with Retry-After in whole seconds
func (a *RemoteAuth) ServeLogin(w http.ResponseWriter, r *http.Request) bool {
	defer a.flush()
	w.Header().Set("Cache-Control", "no-store")
	if ct := r.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		http.Error(w, "expected application/json", http.StatusUnsupportedMediaType)
		return false
	}
	var req remoteLoginRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, remoteMaxLogin))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil || req.Password == "" {
		http.Error(w, "malformed request", http.StatusBadRequest)
		return false
	}
	deviceToken := remoteCookieValue(r, remoteDeviceCookie)

	a.mu.Lock()
	encoded := a.state.Password
	if encoded == "" {
		a.mu.Unlock()
		http.Error(w, "Remote sign-in has not been set up on the desktop.", http.StatusForbidden)
		return false
	}
	key, who := "", "unapproved"
	if d := a.deviceByTokenLocked(deviceToken); d != nil {
		key, who = d.ID, d.Name
	}
	wait, admitted := a.beginLoginLocked(key)
	a.mu.Unlock()
	if !admitted {
		writeRemoteRetry(w, wait)
		return false
	}

	// The length is checked before the hash, not instead of it: a password
	// longer than any SetPassword accepts cannot be right, and is not worth
	// 64 MiB to find that out.
	ok := false
	if len(req.Password) <= remotePasswordMax*utf8.UTFMax {
		a.verifyMu.Lock()
		ok = verifyRemotePassword(req.Password, encoded)
		a.verifyMu.Unlock()
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	a.endLoginLocked(key, ok)
	if !ok {
		// One line per counted failure. The backoff bounds how many there can
		// be, and a refused attempt above writes none, so a flood cannot fill
		// konnekt.log. Never the password, and nothing the caller typed (§ S8.9).
		slog.Warn("remote: sign-in refused", "device", who)
		http.Error(w, "wrong password", http.StatusUnauthorized)
		return false
	}
	// Looked up again: the device may have been removed while argon2 ran.
	if d := a.deviceByTokenLocked(deviceToken); d != nil {
		// A grant this device never collected is spent by signing in directly.
		for id, p := range a.pending {
			if p.deviceID == d.ID {
				delete(a.pending, id)
			}
		}
		token, err := a.issueSessionLocked(d)
		if err != nil {
			slog.Error("remote: issue session", "error", err)
			http.Error(w, "sign-in failed", http.StatusInternalServerError)
			return false
		}
		setRemoteCookie(w, remoteSessionCookie, token, remoteSessionMax)
		slog.Info("remote: signed in", "device", d.Name)
		w.WriteHeader(http.StatusNoContent)
		return true
	}
	a.servePendingLocked(w, r, deviceToken)
	return false
}

// servePendingLocked answers a right password from a device nobody has
// approved: its existing request if it has one, a new one otherwise.
func (a *RemoteAuth) servePendingLocked(w http.ResponseWriter, r *http.Request, deviceToken string) {
	a.prunePendingLocked()
	if deviceToken != "" {
		hash := remoteTokenHash(deviceToken)
		for _, p := range a.pending {
			if p.tokenHash == hash && !p.granted {
				writeRemoteJSON(w, http.StatusAccepted, remotePendingResponse{Pending: true, Code: p.code})
				return
			}
		}
	}
	if len(a.pending) >= remoteMaxPending {
		soonest := remotePendingTTL
		for _, p := range a.pending {
			soonest = min(soonest, p.expires.Sub(a.now()))
		}
		writeRemoteRetry(w, soonest)
		return
	}
	token, code, err := a.newPendingLocked(r.UserAgent())
	if err != nil {
		slog.Error("remote: create pending request", "error", err)
		http.Error(w, "sign-in failed", http.StatusInternalServerError)
		return
	}
	setRemoteCookie(w, remoteDeviceCookie, token, remoteDeviceCookieAge)
	writeRemoteJSON(w, http.StatusAccepted, remotePendingResponse{Pending: true, Code: code})
}

// newPendingLocked records a request for approval and returns the device token
// for the browser's cookie and the code for both screens.
func (a *RemoteAuth) newPendingLocked(userAgent string) (token, code string, err error) {
	if token, err = newRemoteToken(); err != nil {
		return "", "", err
	}
	id, err := newRemoteID()
	if err != nil {
		return "", "", err
	}
	if code, err = newRemoteCode(); err != nil {
		return "", "", err
	}
	now := a.now()
	a.pending[id] = &remotePendingEntry{
		id: id, tokenHash: remoteTokenHash(token), code: code,
		userAgent: cleanRemoteAgent(userAgent), requested: now, expires: now.Add(remotePendingTTL),
	}
	a.dirty = true
	slog.Info("remote: device waiting for approval", "request", id)
	return token, code, nil
}

// ServeLoginWait is POST /api/login/wait, the poll a browser makes while its
// request is pending. It carries no password: the device cookie names the
// request, and the request remembers that the password was right. It reports
// whether a session was issued.
//
//	204  approved; the session is in the Set-Cookie
//	202  still waiting: {"pending":true,"code":"…"}
//	403  denied, expired, or never asked
func (a *RemoteAuth) ServeLoginWait(w http.ResponseWriter, r *http.Request) bool {
	defer a.flush()
	w.Header().Set("Cache-Control", "no-store")
	deviceToken := remoteCookieValue(r, remoteDeviceCookie)
	a.mu.Lock()
	defer a.mu.Unlock()
	a.prunePendingLocked()
	var request *remotePendingEntry
	if deviceToken != "" {
		hash := remoteTokenHash(deviceToken)
		for _, p := range a.pending {
			if p.tokenHash == hash {
				request = p
			}
		}
	}
	if request == nil {
		http.Error(w, "The request was declined or has expired. Sign in again.", http.StatusForbidden)
		return false
	}
	if !request.granted {
		writeRemoteJSON(w, http.StatusAccepted, remotePendingResponse{Pending: true, Code: request.code})
		return false
	}
	delete(a.pending, request.id)
	a.dirty = true
	device := a.deviceLocked(request.deviceID)
	if device == nil {
		// Approved and then removed before the browser came back for it.
		http.Error(w, "The request was declined or has expired. Sign in again.", http.StatusForbidden)
		return false
	}
	token, err := a.issueSessionLocked(device)
	if err != nil {
		slog.Error("remote: issue session", "error", err)
		http.Error(w, "sign-in failed", http.StatusInternalServerError)
		return false
	}
	setRemoteCookie(w, remoteSessionCookie, token, remoteSessionMax)
	slog.Info("remote: signed in", "device", device.Name)
	w.WriteHeader(http.StatusNoContent)
	return true
}

// writeRemoteRetry is a 429 with Retry-After in whole seconds, rounded up so
// a client that waits exactly that long is not refused again.
func writeRemoteRetry(w http.ResponseWriter, wait time.Duration) {
	seconds := int((wait + time.Second - 1) / time.Second)
	w.Header().Set("Retry-After", strconv.Itoa(max(seconds, 1)))
	http.Error(w, "too many attempts", http.StatusTooManyRequests)
}
