package services

import (
	"context"
	"fmt"
	"maps"
	"regexp"
	"slices"
	"strings"
)

// Retention for the bucket a Distant Horizons snapshot is published to (#560).
// Every publish writes a dated folder and, beside it, parts named by their hash
// that other snapshots share, and nothing else ever removes either. This is the
// last step of runDHPublish: keep the newest snapshots, delete the older
// folders, then delete the parts no kept snapshot names.
//
// A bucket lifecycle rule cannot do this. It expires by age or prefix, and
// cannot tell a part a kept snapshot still needs from an orphan.
//
// The rule that shapes the code: the run only deletes when it has read
// everything that decides what is safe to delete. It lists, resolves latest.json,
// reads every kept index and lists the parts before it sends a single delete, so
// a failure at any of those points deletes nothing, and the bucket is left as
// the publish made it. Only the two delete calls can leave work half done, and
// a half-done prune is finished by the next one.

// dhPruneStore is the part of S3Client pruning uses.
type dhPruneStore interface {
	dhIndexReader
	ListObjects(ctx context.Context, prefix string) ([]S3ListedObject, error)
	DeleteObjects(ctx context.Context, keys []string) error
}

// dhPruneResult is what a prune deleted. It counts only what a successful
// delete call covered.
type dhPruneResult struct {
	SnapshotsDeleted int
	PartsDeleted     int
	BytesFreed       int64
}

// reDHFolderStamp is a snapshot folder's name, dhFolderStamp's form. A folder
// under snapshots/ named anything else was not made by a publish, so it is left
// alone.
var reDHFolderStamp = regexp.MustCompile(`^[0-9]{8}T[0-9]{6}Z$`)

// dhPruneFolder is one snapshot folder as the listing shows it.
type dhPruneFolder struct {
	Objects []S3ListedObject
	// Complete is whether the folder holds its index.json, the object a publish
	// writes after the files it describes. A folder without one is a run that
	// was cut off, or one still going.
	Complete bool
}

// pruneDHSnapshots keeps the keep newest complete snapshots under keys, plus the
// one latest.json points at whatever its age, and deletes the rest.
//
// A snapshot is deleted as a whole folder. A part is deleted only when it sits
// directly under the parts folder, is named like a part, and no kept snapshot's
// index names it. A folder that is not complete is deleted only when it is older
// than the oldest snapshot kept: a newer one may be a publish in progress.
func pruneDHSnapshots(ctx context.Context, store dhPruneStore, keys SnapshotKeys, keep int, narrate func(string)) (dhPruneResult, error) {
	var res dhPruneResult
	if narrate == nil {
		narrate = func(string) {}
	}
	if keep < 1 {
		return res, fmt.Errorf("keep must be at least 1, not %d", keep)
	}
	snapPrefix := keys.SnapshotsPrefix()

	listed, err := store.ListObjects(ctx, snapPrefix)
	if err != nil {
		return res, fmt.Errorf("list %s: %w", snapPrefix, err)
	}
	folders, err := groupDHFolders(snapPrefix, listed)
	if err != nil {
		return res, err
	}
	latestIndex, err := currentDHIndexKey(ctx, store, keys.Latest)
	if err != nil {
		return res, err
	}

	kept := keptDHStamps(snapPrefix, folders, keep, latestIndex)
	if len(kept) == 0 {
		return res, nil
	}
	referenced, err := keptDHParts(ctx, store, snapPrefix, folders, kept, latestIndex)
	if err != nil {
		return res, err
	}

	oldFolders, folderKeys, folderBytes := oldDHFolders(snapPrefix, folders, kept)
	partKeys, partBytes, err := orphanDHParts(ctx, store, keys, referenced)
	if err != nil {
		return res, err
	}

	// Everything to be deleted is checked before any of it is sent.
	if err := checkDHPruneKeys(keys, folderKeys); err != nil {
		return res, err
	}
	if err := checkDHPruneKeys(keys, partKeys); err != nil {
		return res, err
	}
	if len(folderKeys) == 0 && len(partKeys) == 0 {
		narrate(fmt.Sprintf("Nothing to prune: %d snapshot(s) kept", len(kept)))
		return res, nil
	}
	narrate(fmt.Sprintf("Pruning: keeping %d snapshot(s), deleting %d older snapshot(s) and %d unreferenced part(s), %s",
		len(kept), oldFolders, len(partKeys), fmtBytes(folderBytes+partBytes)))

	if len(folderKeys) > 0 {
		if err := store.DeleteObjects(ctx, folderKeys); err != nil {
			return res, fmt.Errorf("delete old snapshots: %w", err)
		}
		res.SnapshotsDeleted = oldFolders
		res.BytesFreed += folderBytes
	}
	if len(partKeys) > 0 {
		if err := store.DeleteObjects(ctx, partKeys); err != nil {
			return res, fmt.Errorf("delete unreferenced parts: %w", err)
		}
		res.PartsDeleted = len(partKeys)
		res.BytesFreed += partBytes
	}
	narrate(fmt.Sprintf("Pruned: %d snapshot(s) and %d part(s) deleted, %s freed", res.SnapshotsDeleted, res.PartsDeleted, fmtBytes(res.BytesFreed)))
	return res, nil
}

// groupDHFolders sorts a listing of snapPrefix into snapshot folders by stamp.
// An object that is not inside a folder named like a snapshot is not a
// snapshot's and is left out. A key that is not under snapPrefix at all is not
// something a listing of it can return, so it is an error: it means the
// answer cannot be trusted, and nothing is deleted on the strength of it.
func groupDHFolders(snapPrefix string, listed []S3ListedObject) (map[string]*dhPruneFolder, error) {
	folders := map[string]*dhPruneFolder{}
	for _, o := range listed {
		rest, ok := strings.CutPrefix(o.Key, snapPrefix)
		if !ok {
			return nil, fmt.Errorf("the bucket listed %q for %s: it is outside the folder being pruned, so nothing was deleted", o.Key, snapPrefix)
		}
		stamp, inner, ok := strings.Cut(rest, "/")
		if !ok || !reDHFolderStamp.MatchString(stamp) {
			continue
		}
		f := folders[stamp]
		if f == nil {
			f = &dhPruneFolder{}
			folders[stamp] = f
		}
		f.Objects = append(f.Objects, o)
		if inner == dhIndexFile {
			f.Complete = true
		}
	}
	return folders, nil
}

// currentDHIndexKey reads latest.json as the bucket holds it now and returns the
// key of the index it points at. It is read again, rather than taken from the
// publish that just wrote it, so the snapshot kept is the one a reader would be
// sent to at this moment.
func currentDHIndexKey(ctx context.Context, store dhIndexReader, latestKey string) (string, error) {
	data, found, err := store.GetObject(ctx, latestKey)
	if err != nil {
		return "", fmt.Errorf("read %s: %w", latestKey, err)
	}
	if !found {
		return "", fmt.Errorf("%s is not in the bucket, so nothing was deleted", latestKey)
	}
	latest, err := parseDHLatest(data)
	if err != nil {
		return "", fmt.Errorf("%s: %w", latestKey, err)
	}
	return latestIndexKey(latestKey, latest)
}

// keptDHStamps is the set of stamps to keep: the keep newest complete folders,
// and the folder latestIndex is in.
func keptDHStamps(snapPrefix string, folders map[string]*dhPruneFolder, keep int, latestIndex string) map[string]struct{} {
	var complete []string
	for stamp, f := range folders {
		if f.Complete {
			complete = append(complete, stamp)
		}
	}
	// The stamp is a fixed-width UTC time, so text order is time order.
	slices.Sort(complete)
	slices.Reverse(complete)
	kept := map[string]struct{}{}
	for _, stamp := range complete[:min(keep, len(complete))] {
		kept[stamp] = struct{}{}
	}
	if stamp, ok := dhStampOf(snapPrefix, latestIndex); ok {
		kept[stamp] = struct{}{}
	}
	return kept
}

// dhStampOf is the snapshot folder key lies in, when it lies in one under
// snapPrefix.
func dhStampOf(snapPrefix, key string) (string, bool) {
	rest, ok := strings.CutPrefix(key, snapPrefix)
	if !ok {
		return "", false
	}
	stamp, _, ok := strings.Cut(rest, "/")
	return stamp, ok && reDHFolderStamp.MatchString(stamp)
}

// keptDHParts reads the index of every kept snapshot, and of the one latest.json
// names wherever it is, and returns every part they name. An index that cannot
// be read or parsed fails the whole prune: a part is safe to delete only when
// every snapshot that might need it has been read.
func keptDHParts(ctx context.Context, store dhIndexReader, snapPrefix string, folders map[string]*dhPruneFolder, kept map[string]struct{}, latestIndex string) (map[string]struct{}, error) {
	indexKeys := map[string]struct{}{latestIndex: {}}
	for stamp := range kept {
		if f := folders[stamp]; f != nil && f.Complete {
			indexKeys[snapPrefix+stamp+"/"+dhIndexFile] = struct{}{}
		}
	}
	referenced := map[string]struct{}{}
	for _, key := range slices.Sorted(maps.Keys(indexKeys)) {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		data, found, err := store.GetObject(ctx, key)
		if err != nil {
			return nil, fmt.Errorf("cannot read %s, so nothing was deleted: %w", key, err)
		}
		if !found {
			return nil, fmt.Errorf("%s is not in the bucket, so nothing was deleted", key)
		}
		ix, err := parseDHIndex(data)
		if err != nil {
			return nil, fmt.Errorf("cannot use %s, so nothing was deleted: %w", key, err)
		}
		for sum := range ix.partSet() {
			referenced[sum] = struct{}{}
		}
	}
	return referenced, nil
}

// oldDHFolders returns the keys of the objects in every folder to delete, how
// many folders that is, and their bytes. A complete folder that is not kept goes;
// an incomplete one goes only when older than every kept one.
func oldDHFolders(snapPrefix string, folders map[string]*dhPruneFolder, kept map[string]struct{}) (count int, keys []string, freed int64) {
	oldest := ""
	for stamp := range kept {
		if oldest == "" || stamp < oldest {
			oldest = stamp
		}
	}
	for _, stamp := range slices.Sorted(maps.Keys(folders)) {
		f := folders[stamp]
		if _, keep := kept[stamp]; keep || (!f.Complete && stamp >= oldest) {
			continue
		}
		count++
		for _, o := range f.Objects {
			keys = append(keys, o.Key)
			freed += o.Size
		}
	}
	return count, keys, freed
}

// orphanDHParts lists the parts folder and returns the parts no kept index names.
// Only an object directly under the folder and named like a part is a candidate;
// anything else there is not the publish's and stays.
func orphanDHParts(ctx context.Context, store dhPruneStore, keys SnapshotKeys, referenced map[string]struct{}) (orphans []string, freed int64, err error) {
	listed, err := store.ListObjects(ctx, keys.PartsPrefix)
	if err != nil {
		return nil, 0, fmt.Errorf("list %s: %w", keys.PartsPrefix, err)
	}
	for _, o := range listed {
		name, ok := strings.CutPrefix(o.Key, keys.PartsPrefix)
		if !ok {
			return nil, 0, fmt.Errorf("the bucket listed %q for %s: it is outside the folder being pruned, so nothing was deleted", o.Key, keys.PartsPrefix)
		}
		if !reDHPartName.MatchString(name) {
			continue
		}
		if _, used := referenced[name]; used {
			continue
		}
		orphans = append(orphans, o.Key)
		freed += o.Size
	}
	return orphans, freed, nil
}

// checkDHPruneKeys refuses a list of keys to delete if any of them is not below
// the configured prefix, or is below it but in neither the snapshots folder nor
// the parts folder. It is the last check before a delete is signed, and does not
// trust how the list was built.
func checkDHPruneKeys(keys SnapshotKeys, del []string) error {
	root := keys.Root()
	snapshots := keys.SnapshotsPrefix()
	for _, k := range del {
		inRoot := root == "" || strings.HasPrefix(k, root+"/")
		inTree := strings.HasPrefix(k, snapshots) || strings.HasPrefix(k, keys.PartsPrefix)
		if k == "" || !inRoot || !inTree {
			return fmt.Errorf("refusing to delete %q: it is not under the configured prefix's snapshots or parts folder, so nothing was deleted", k)
		}
	}
	return nil
}
