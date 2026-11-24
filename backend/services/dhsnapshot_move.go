package services

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"
)

// Moving a published snapshot between two layouts (#561). A private link is the
// same snapshot with its entry points under <prefix>/<token>/ instead of
// <prefix>/ (SnapshotKeys), so switching public to private, private to public and
// rotating a token are one operation: carry the latest snapshot from the old base
// to the new one, then drop the old base. The parts never move; both layouts
// read them from <prefix>/parts/.
//
// The order is what makes it safe. Everything under the new base is written
// first and latest.json last, so the new link never shows a snapshot whose files
// are missing, and the old base is deleted only after the caller has committed
// the new token, so a run cut off anywhere leaves a link that works. The old
// link's files are removed by dropDHBase, a separate step the caller runs after
// the commit, because its failure must not undo the move.

// dhLinkStore is the bucket as a move uses it. *S3Client is the real one.
type dhLinkStore interface {
	dhPublishStore
}

// dhMoveResult is what moveDHSnapshotLink did.
type dhMoveResult struct {
	// Moved is false when the old base held no latest.json: nothing was published
	// there, so the move is only the caller's record change.
	Moved bool
	// Warning is a note for the person, set by the caller's later steps.
	Warning string
}

// dhBaseKeys is the key layout of a base, for the folders and files that are the
// same whatever snapshot is current: its latest.json and its snapshots/ folder.
// The time only names one snapshot's folder, which these do not use.
func dhBaseKeys(prefix, token string) (SnapshotKeys, error) {
	return snapshotKeys(prefix, token, time.Unix(0, 0))
}

// moveDHSnapshotLink carries the snapshot oldToken's latest.json points at to the
// layout newToken names, and writes the new base's latest.json last. An empty
// token is the public layout. It deletes nothing.
//
// Only the latest snapshot comes: its index.json, rewritten for the new
// layout's partsBase.
func moveDHSnapshotLink(ctx context.Context, store dhLinkStore, prefix, oldToken, newToken string, narrate func(string)) (dhMoveResult, error) {
	var res dhMoveResult
	if narrate == nil {
		narrate = func(string) {}
	}
	if oldToken == newToken {
		return res, errors.New("the link is already in that layout, so there is nothing to move")
	}
	oldBase, err := dhBaseKeys(prefix, oldToken)
	if err != nil {
		return res, err
	}
	prev, err := readLatestIndex(ctx, store, oldBase.Latest)
	if err != nil {
		return res, fmt.Errorf("cannot read the published snapshot: %w", err)
	}
	if prev == nil {
		narrate("Nothing is published under the current link, so there is nothing to move")
		return res, nil
	}
	ix := prev.Index
	created, err := checkDHIndexForPublish(ix)
	if err != nil {
		return res, fmt.Errorf("the published snapshot cannot be moved: %w", err)
	}
	oldKeys, err := snapshotKeys(prefix, oldToken, created)
	if err != nil {
		return res, err
	}
	newKeys, err := snapshotKeys(prefix, newToken, created)
	if err != nil {
		return res, err
	}
	// latest.json is read from a bucket anyone with write access can change: the
	// snapshot is moved only when it is where a publish puts it, so every key
	// below is built from the layout and none from the pointer.
	if prev.IndexKey != oldKeys.Index {
		return res, fmt.Errorf("latest.json points at %s, not where a publish writes a snapshot, so it was not moved", prev.IndexKey)
	}

	narrate("Moving the latest snapshot to the new link")
	ix.PartsBase = newKeys.PartsBase
	data, err := ix.Marshal()
	if err != nil {
		return res, err
	}
	if err := store.PutObjectBytes(ctx, newKeys.Index, data, S3PutOptions{}); err != nil {
		return res, fmt.Errorf("write the index: %w", err)
	}

	p := &dhPublisher{dhPublishPlan: dhPublishPlan{Store: store, Narrate: narrate}}
	if err := p.writeLatest(ctx, dhStaged{Index: ix, Keys: newKeys}); err != nil {
		return res, err
	}
	res.Moved = true
	return res, nil
}

// dropDHBase deletes a base the move has left: its latest.json first, which is
// what ends the link, then everything under its snapshots/ folder. It never
// touches the parts, and every key goes through checkDHPruneKeys against the
// base's own layout before it is sent. latestGone says the link itself is dead,
// which can be true when err is not nil: the pointer went and some files stayed.
func dropDHBase(ctx context.Context, store dhPruneStore, prefix, token string, narrate func(string)) (latestGone bool, err error) {
	if narrate == nil {
		narrate = func(string) {}
	}
	base, err := dhBaseKeys(prefix, token)
	if err != nil {
		return false, err
	}
	snaps := base.SnapshotsPrefix()
	listed, err := store.ListObjects(ctx, snaps)
	if err != nil {
		return false, fmt.Errorf("list the old link's files: %w", err)
	}
	keys := make([]string, 0, len(listed))
	for _, o := range listed {
		if !strings.HasPrefix(o.Key, snaps) {
			return false, fmt.Errorf("the bucket listed %q for %s: it is outside the folder being deleted, so nothing was deleted", o.Key, snaps)
		}
		keys = append(keys, o.Key)
	}
	if err := checkDHPruneKeys(base, keys); err != nil {
		return false, err
	}
	narrate(fmt.Sprintf("Deleting the old link: %d file(s)", len(keys)+1))
	if err := store.DeleteObjects(ctx, []string{base.Latest}); err != nil {
		return false, fmt.Errorf("delete the old link's latest.json: %w", err)
	}
	if len(keys) == 0 {
		return true, nil
	}
	slices.Sort(keys)
	if err := store.DeleteObjects(ctx, keys); err != nil {
		return true, fmt.Errorf("delete the old link's snapshots: %w", err)
	}
	return true, nil
}
