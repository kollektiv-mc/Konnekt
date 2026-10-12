package services

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"sync"

	"konnekt/backend/models"
)

// The private snapshot link (#561). A destination's snapshot is public by
// default; with a link it is published under <prefix>/<token>/ (SnapshotKeys),
// so only someone given the link can find it. The token is a credential: it
// lives in its own owner-only file beside the destination's secret, and the only
// ways it leaves that file are LinkToken, for the blocks that place their keys by
// it, and GetSnapshotLink, on an explicit click. Everything else, a listing, an
// event, a run record, a log line and an error, carries the mode (PrivateLink)
// and never the token.

const (
	// destinationLinkExt names the link file, <id>.link, in the same owner-only
	// folder as <id>.secret, so deleting the destination removes both.
	destinationLinkExt = ".link"

	// dhLinkTokenBytes is the token's randomness: 128 bits.
	dhLinkTokenBytes = 16
)

// reDHLinkToken is what newDHLinkToken produces: 16 bytes as lowercase base32
// with no padding, 26 characters, safe in a URL path. It matches reDHToken, the
// wider rule snapshotKeys applies; a token read back from the file is held to
// this narrower one.
var reDHLinkToken = regexp.MustCompile(`^[a-z2-7]{26}$`)

var dhLinkEncoding = base32.StdEncoding.WithPadding(base32.NoPadding)

// newDHLinkToken reads 128 bits from r (crypto/rand when nil) and encodes them.
// A failed read is an error and never a fallback: a token from a weaker source
// would look the same and protect nothing.
func newDHLinkToken(r io.Reader) (string, error) {
	if r == nil {
		r = rand.Reader
	}
	var b [dhLinkTokenBytes]byte
	if _, err := io.ReadFull(r, b[:]); err != nil {
		return "", fmt.Errorf("generate a link token: %w", err)
	}
	return strings.ToLower(dhLinkEncoding.EncodeToString(b[:])), nil
}

// dhStaleBase is a link's base that a move has left in the bucket and whose
// deletion has not yet succeeded. Token "" is the public layout.
type dhStaleBase struct {
	Token  string `json:"token"`
	Prefix string `json:"prefix"`
}

// dhLinkRecord is the link file.
type dhLinkRecord struct {
	// Token is the live token; "" means the snapshot is public.
	Token string `json:"token"`
	// Pending is a token generated for a move that did not finish. The next move
	// reuses it, so a retry overwrites what the first attempt left instead of
	// leaving a second copy of the snapshot under a third token.
	Pending string `json:"pending"`
	// Prefix is the full key prefix (the destination's, then the node's) the last
	// publish used, which Copy link and a move need to find the snapshot. Empty
	// until something has been published.
	Prefix string `json:"prefix"`
	// Stale are bases still to be deleted after a move. The old link keeps working
	// until its base is gone, so a failed delete is recorded here, and the next
	// move or mode change finishes it.
	Stale []dhStaleBase `json:"stale,omitempty"`
}

func (s *DestinationService) linkPath(id string) string {
	return filepath.Join(s.dataDir, destinationSecretsDir, id+destinationLinkExt)
}

// readLinkLocked returns the stored link record, or the zero record (public,
// nothing published) when there is none. A file that is there but unreadable or
// not a record is an error and never read as "public", so a damaged file cannot
// publish a private snapshot in the open.
func (s *DestinationService) readLinkLocked(id string) (dhLinkRecord, error) {
	if !destinationIDPattern.MatchString(id) {
		return dhLinkRecord{}, errors.New("destination not found")
	}
	data, err := os.ReadFile(s.linkPath(id))
	if os.IsNotExist(err) {
		return dhLinkRecord{}, nil
	}
	if err != nil {
		return dhLinkRecord{}, fmt.Errorf("read the snapshot link for destination %s: %w", id, err)
	}
	var rec dhLinkRecord
	if err := json.Unmarshal(data, &rec); err != nil {
		return dhLinkRecord{}, fmt.Errorf("the snapshot link file for destination %s is damaged; switch the destination to public and private again", id)
	}
	if err := rec.check(); err != nil {
		return dhLinkRecord{}, fmt.Errorf("the snapshot link file for destination %s is damaged (%v)", id, err)
	}
	return rec, nil
}

// check refuses a record whose fields could not have been written by this code.
func (r dhLinkRecord) check() error {
	for _, tok := range append([]string{r.Token, r.Pending}, staleTokens(r.Stale)...) {
		if tok != "" && !reDHLinkToken.MatchString(tok) {
			return errors.New("a token is not one this app made")
		}
	}
	for _, p := range append([]string{r.Prefix}, stalePrefixes(r.Stale)...) {
		if clean, err := cleanKeyPrefix(p); err != nil || clean != p {
			return errors.New("a prefix is not a plain key prefix")
		}
	}
	return nil
}

func staleTokens(b []dhStaleBase) []string {
	out := make([]string, len(b))
	for i, e := range b {
		out[i] = e.Token
	}
	return out
}

func stalePrefixes(b []dhStaleBase) []string {
	out := make([]string, len(b))
	for i, e := range b {
		out[i] = e.Prefix
	}
	return out
}

// redactable are the tokens in the record, for AlsoRedact.
func (r dhLinkRecord) redactable() []string {
	return append([]string{r.Token, r.Pending}, staleTokens(r.Stale)...)
}

func (s *DestinationService) writeLinkLocked(id string, rec dhLinkRecord) error {
	data, err := json.Marshal(rec)
	if err != nil {
		return fmt.Errorf("encode the snapshot link: %w", err)
	}
	dir := filepath.Join(s.dataDir, destinationSecretsDir)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("create %s: %w", destinationSecretsDir, err)
	}
	return WritePrivateDataFile(dir, id+destinationLinkExt, data)
}

// hasPrivateLinkLocked is the PrivateLink flag. A record that cannot be read is
// logged, without anything from it, and shown as not private; LinkToken, which
// the blocks ask, reports the same damage as an error, so nothing is published
// on the strength of the flag.
func (s *DestinationService) hasPrivateLinkLocked(id string) bool {
	rec, err := s.readLinkLocked(id)
	if err != nil {
		slog.Warn("destinations: read snapshot link", "destination", id, "error", err)
		return false
	}
	return rec.Token != ""
}

// updateLink applies change to the stored record under the lock, and writes it
// when it changed. It refuses a destination that is gone (its secret file is
// removed first by Delete), so a move that outlives a delete cannot bring the
// file back.
func (s *DestinationService) updateLink(id string, change func(*dhLinkRecord)) (dhLinkRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !destinationIDPattern.MatchString(id) || !s.hasSecretLocked(id) {
		return dhLinkRecord{}, errors.New("destination not found")
	}
	rec, err := s.readLinkLocked(id)
	if err != nil {
		return dhLinkRecord{}, err
	}
	before := rec
	before.Stale = append([]dhStaleBase(nil), rec.Stale...)
	change(&rec)
	if reflect.DeepEqual(before, rec) {
		return rec, nil
	}
	return rec, s.writeLinkLocked(id, rec)
}

// LinkToken returns the destination's live link token, "" when its snapshot is
// public. It is the one way the token leaves the file for the blocks that lay out
// keys by it, and nothing bound to the frontend calls it. A caller adds the token
// to its client's redaction (S3Client.AlsoRedact) before it uses it.
func (s *DestinationService) LinkToken(id string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, err := s.readLinkLocked(id)
	return rec.Token, err
}

// RecordLinkPrefix remembers the full key prefix the last publish used, which
// Copy link and a move need to find the snapshot. The publish block calls it
// after a publish succeeds.
func (s *DestinationService) RecordLinkPrefix(id, prefix string) error {
	clean, err := cleanKeyPrefix(prefix)
	if err != nil {
		return err
	}
	_, err = s.updateLink(id, func(r *dhLinkRecord) { r.Prefix = clean })
	return err
}

// --- who is using a link ---

// dhLinkUse counts the runs that hold a destination's link and says whether a
// move has it.
type dhLinkUse struct {
	holders int
	moving  bool
}

func (s *DestinationService) useLocked(id string) *dhLinkUse {
	if s.linkUse == nil {
		s.linkUse = map[string]*dhLinkUse{}
	}
	u := s.linkUse[id]
	if u == nil {
		u = &dhLinkUse{}
		s.linkUse[id] = u
	}
	return u
}

// HoldLink marks the destination's link in use for the length of a publish. A
// move that deleted the old base under a publish writing to it would leave a
// latest.json at the address the move was meant to revoke, so the two exclude
// each other: a move waits for no one and says so, and so does a publish. The
// returned function releases the hold and is safe to call twice.
func (s *DestinationService) HoldLink(id string) (func(), error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	u := s.useLocked(id)
	if u.moving {
		return nil, errors.New("the snapshot link of this destination is being changed: run this again when that has finished")
	}
	u.holders++
	var once sync.Once
	return func() {
		once.Do(func() {
			s.mu.Lock()
			defer s.mu.Unlock()
			u.holders--
		})
	}, nil
}

func (s *DestinationService) beginMove(id string) (func(), error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	u := s.useLocked(id)
	switch {
	case u.moving:
		return nil, errors.New("the snapshot link of this destination is already being changed")
	case u.holders > 0:
		return nil, errors.New("a snapshot is being taken or published to this destination: change the link when it has finished")
	}
	u.moving = true
	var once sync.Once
	return func() {
		once.Do(func() {
			s.mu.Lock()
			defer s.mu.Unlock()
			u.moving = false
		})
	}, nil
}

// --- the three operations ---

// dhLinkOp is one running operation: the destination opened, its record read, and
// the move excluded from every publish.
type dhLinkOp struct {
	s      *DestinationService
	id     string
	client *S3Client
	dest   models.Destination
	rec    dhLinkRecord
	end    func()
}

// beginLinkOp opens the destination by id, takes the move exclusively and reads
// the record. Every token in it is added to the client's redaction before
// anything else can print a key.
func (s *DestinationService) beginLinkOp(id string) (*dhLinkOp, error) {
	if !destinationIDPattern.MatchString(id) {
		return nil, errors.New("destination not found")
	}
	client, dest, err := s.OpenByID(id)
	if err != nil {
		return nil, err
	}
	end, err := s.beginMove(id)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	rec, err := s.readLinkLocked(id)
	s.mu.Unlock()
	if err != nil {
		end()
		return nil, err
	}
	for _, tok := range rec.redactable() {
		client.AlsoRedact(tok)
	}
	return &dhLinkOp{s: s, id: id, client: client, dest: dest, rec: rec, end: end}, nil
}

// narrate logs the move's progress, scrubbed. A destination belongs to no
// server, so there is no console to tell.
func (op *dhLinkOp) narrate(line string) {
	slog.Info("snapshot link: " + op.client.scrub(line))
}

// freshToken makes a token and adds it to the client's redaction.
func (op *dhLinkOp) freshToken() (string, error) {
	tok, err := newDHLinkToken(op.s.randSource)
	if err != nil {
		return "", err
	}
	op.client.AlsoRedact(tok)
	return tok, nil
}

// pendingToken is the token a move to a private layout goes to: the one an
// unfinished move left, else a new one recorded as pending first, so a move cut
// off after the first byte can be picked up.
func (op *dhLinkOp) pendingToken() (string, error) {
	if op.rec.Pending != "" && op.rec.Pending != op.rec.Token {
		return op.rec.Pending, nil
	}
	tok, err := op.freshToken()
	if err != nil {
		return "", err
	}
	op.rec, err = op.s.updateLink(op.id, func(r *dhLinkRecord) { r.Pending = tok })
	if err != nil {
		return "", err
	}
	return tok, nil
}

// fail turns an error from the bucket or the move into one for the person,
// scrubbed of the secret and every token.
func (op *dhLinkOp) fail(lead string, err error) error {
	return errors.New(lead + op.client.scrub(err.Error()))
}

// finish commits the new token, then deletes the bases that are now stale: the
// one just left, when something was moved out of it, and any an earlier move
// could not delete. The commit comes first and records the old base as stale in
// the same write, so a run cut off after it leaves a link that works and a note
// of what is still to delete.
func (op *dhLinkOp) finish(ctx context.Context, newToken string, moved bool) (stillWorks bool, leftover error) {
	oldToken, prefix := op.rec.Token, op.rec.Prefix
	rec, err := op.s.updateLink(op.id, func(r *dhLinkRecord) {
		r.Token, r.Pending = newToken, ""
		if moved {
			r.Stale = append(r.Stale, dhStaleBase{Token: oldToken, Prefix: prefix})
		}
		// A base the move just wrote is live again, whatever an earlier move
		// left of it: deleting it as stale would delete the new link.
		r.Stale = slices.DeleteFunc(r.Stale, func(b dhStaleBase) bool {
			return b.Token == newToken && b.Prefix == prefix
		})
	})
	if err != nil {
		return false, fmt.Errorf("the snapshot was moved but the new link could not be saved, so the old link is still the one in use: %w", err)
	}
	op.rec = rec
	return op.dropStale(ctx), nil
}

// dropStale deletes every stale base it can and keeps the others on the record.
// It reports whether a link that is no longer wanted still answers: a base whose
// latest.json could not be deleted.
func (op *dhLinkOp) dropStale(ctx context.Context) (stillWorks bool) {
	if len(op.rec.Stale) == 0 {
		return false
	}
	var kept []dhStaleBase
	var firstErr error
	for _, b := range op.rec.Stale {
		if b.Token == op.rec.Token && b.Prefix == op.rec.Prefix {
			continue // the live base is never stale
		}
		gone, err := dropDHBase(ctx, op.client, b.Prefix, b.Token, op.narrate)
		if err == nil {
			continue
		}
		kept = append(kept, b)
		if !gone {
			stillWorks = true
		}
		if firstErr == nil {
			firstErr = err
		}
	}
	rec, err := op.s.updateLink(op.id, func(r *dhLinkRecord) { r.Stale = kept })
	if err != nil {
		slog.Warn("snapshot link: record what is still to delete", "destination", op.id, "error", op.client.scrub(err.Error()))
	} else {
		op.rec = rec
	}
	if firstErr != nil {
		slog.Warn("snapshot link: the old link's files were not all deleted", "destination", op.id, "error", op.client.scrub(firstErr.Error()))
	}
	return stillWorks
}

func (op *dhLinkOp) result(private bool, msg string, stillWorks bool) models.SnapshotLinkResult {
	if len(op.rec.Stale) > 0 {
		if stillWorks {
			msg += " The previous link could not be removed and may still work: switch the mode or rotate the link again to finish removing it."
		} else {
			msg += " Some of the previous link's files could not be deleted; the link itself no longer works. Switching the mode or rotating again will finish removing them."
		}
	}
	return models.SnapshotLinkResult{Private: private, Message: msg, OldLinkStillWorks: stillWorks}
}

// SetSnapshotLinkPrivate switches the destination's snapshot between public and a
// private link, moving the latest published snapshot to the other layout. It
// does nothing when the destination is already in that mode, beyond finishing
// the removal of a base an earlier move left. It can take minutes: the bucket
// builds each level's database again, which is why it takes the caller's context.
func (s *DestinationService) SetSnapshotLinkPrivate(ctx context.Context, id string, private bool) (models.SnapshotLinkResult, error) {
	op, err := s.beginLinkOp(id)
	if err != nil {
		return models.SnapshotLinkResult{}, err
	}
	defer op.end()

	if private == (op.rec.Token != "") {
		stillWorks := op.dropStale(ctx)
		msg := "The snapshot link is already public."
		if private {
			msg = "The snapshot link is already private."
		}
		return op.result(private, msg, stillWorks), nil
	}
	newToken := ""
	if private {
		if newToken, err = op.pendingToken(); err != nil {
			return models.SnapshotLinkResult{}, err
		}
	}
	done := "The snapshot is public again."
	if private {
		done = "The snapshot is now under a private link."
	}
	return op.change(ctx, private, newToken, done)
}

// RotateSnapshotLink gives a private link a new token, moving the latest snapshot
// under it and deleting the old address, so everyone holding the old link loses
// it. A public snapshot has nothing to rotate.
func (s *DestinationService) RotateSnapshotLink(ctx context.Context, id string) (models.SnapshotLinkResult, error) {
	op, err := s.beginLinkOp(id)
	if err != nil {
		return models.SnapshotLinkResult{}, err
	}
	defer op.end()

	if op.rec.Token == "" {
		return models.SnapshotLinkResult{}, errors.New("the snapshot link is public, so there is nothing to rotate: switch to a private link first")
	}
	newToken, err := op.pendingToken()
	if err != nil {
		return models.SnapshotLinkResult{}, err
	}
	return op.change(ctx, true, newToken, "The link was rotated.")
}

// change moves the snapshot from the record's token to newToken and commits.
// done is the sentence for the new mode.
func (op *dhLinkOp) change(ctx context.Context, private bool, newToken, done string) (models.SnapshotLinkResult, error) {
	moved := dhMoveResult{}
	if op.rec.Prefix != "" {
		var err error
		moved, err = moveDHSnapshotLink(ctx, op.client, op.rec.Prefix, op.rec.Token, newToken, op.narrate)
		if err != nil {
			return models.SnapshotLinkResult{}, op.fail("The snapshot could not be moved, so the link is unchanged: ", err)
		}
	}
	stillWorks, err := op.finish(ctx, newToken, moved.Moved)
	if err != nil {
		return models.SnapshotLinkResult{}, op.fail("", err)
	}
	slog.Info("snapshot link: changed", "destination", op.id, "private", private, "moved", moved.Moved, "oldLinkStillWorks", stillWorks)
	msg := done
	switch {
	case op.rec.Prefix == "":
		msg += " Nothing has been published here yet, so there was nothing to move; the next publish uses it."
	case !moved.Moved:
		msg += " Nothing was published under the previous link, so there was nothing to move."
	case len(op.rec.Stale) == 0:
		msg += " The previous link no longer works."
	}
	return op.result(private, msg, stillWorks), nil
}

// GetSnapshotLink returns the address of the destination's latest.json for its
// current mode: the public base URL when it has one, else the bucket's own
// address. It is the only call that returns the link, and the Settings pane
// makes it on a click. It refuses, in words, until something has been published,
// and carries a note when an earlier move left a link that was not removed.
func (s *DestinationService) GetSnapshotLink(id string) (models.SnapshotLinkResult, error) {
	client, dest, err := s.OpenByID(id)
	if err != nil {
		return models.SnapshotLinkResult{}, err
	}
	s.mu.Lock()
	rec, err := s.readLinkLocked(id)
	s.mu.Unlock()
	if err != nil {
		return models.SnapshotLinkResult{}, err
	}
	if rec.Prefix == "" {
		return models.SnapshotLinkResult{}, errors.New("nothing has been published to this destination yet, so there is no link to copy: run a Publish DH Snapshot block first")
	}
	keys, err := dhBaseKeys(rec.Prefix, rec.Token)
	if err != nil {
		return models.SnapshotLinkResult{}, err
	}
	res := models.SnapshotLinkResult{Private: rec.Token != "", Link: dhObjectURL(dest.PublicBaseURL, client, keys.Latest)}
	if len(rec.Stale) > 0 {
		res.Message = "A previous link could not be fully removed and may still work: switch the mode or rotate the link to finish removing it."
		res.OldLinkStillWorks = true
	}
	return res, nil
}
