package services

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// The upload library behind action.upload (#480): collect the files of a source,
// refuse what must not go up, then walk them in order, skipping an object the
// bucket already holds at the same size and sending the rest. The block is a thin
// caller; the snapshot publish step reuses collectUploadItems and syncUploadItems
// with an item list of its own, which is why the two halves are separate and
// neither knows about ExecContext.

// uploadProgressEvery is how often a long upload narrates its progress. A variable
// so a test can shrink it.
var uploadProgressEvery = 30 * time.Second

// uploadItem is one local file and the object key it goes to.
type uploadItem struct {
	Path string // where to read it from
	Key  string // the full object key, forward slashes, prefixes included
	Size int64
}

// uploadResult is what a sync did: the objects sent, the ones already there, and
// the bytes that left the machine.
type uploadResult struct {
	Uploaded int
	Skipped  int
	Bytes    int64
}

// uploadProgress is handed to the progress callback after each object.
type uploadProgress struct {
	Done       int // objects dealt with so far, sent or skipped
	Total      int
	Result     uploadResult
	TotalBytes int64 // size of every object in the plan
}

// objectStore is the part of S3Client the upload uses, so a test can stand in a
// store that fails or counts without a server.
type objectStore interface {
	HeadObject(ctx context.Context, key string) (S3ObjectInfo, bool, error)
	PutObject(ctx context.Context, key, localPath string, opts S3PutOptions) error
}

// --- where a source may come from ---

// errOutsideUploadRoots is the refusal for a source, or a symlink inside one, that
// leaves the folders a graph may upload from.
var errOutsideUploadRoots = errors.New("is outside the folders a graph may upload from (the server's folder and its backups)")

// resolveUploadSource turns the block's source setting into a real path inside one
// of roots. A relative source is taken from the server's working directory, never
// from the process's. The path is resolved through symlinks first, so neither "..",
// an absolute path elsewhere nor a link that points out can reach past the roots:
// without this check a graph could upload ~/.ssh.
func resolveUploadSource(source, workingDir string, roots []string) (string, error) {
	source = strings.TrimSpace(source)
	if source == "" {
		return "", errors.New("no source: choose a file or a folder to upload")
	}
	if !filepath.IsAbs(source) {
		if workingDir == "" {
			return "", errors.New("the server has no working directory to resolve a relative source against")
		}
		source = filepath.Join(workingDir, source)
	}
	resolved, err := filepath.EvalSymlinks(filepath.Clean(source))
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return "", fmt.Errorf("source %s does not exist", source)
		}
		return "", fmt.Errorf("source %s: %w", source, err)
	}
	if !insideAny(roots, resolved) {
		return "", fmt.Errorf("source %s %w", source, errOutsideUploadRoots)
	}
	return resolved, nil
}

// insideAny reports whether the already symlink-resolved path p is one of roots
// or below one. The roots are resolved here, so a data directory that is itself
// reached through a link compares like with like.
func insideAny(roots []string, p string) bool {
	for _, root := range roots {
		if root == "" {
			continue
		}
		real, err := filepath.EvalSymlinks(root)
		if err != nil {
			continue
		}
		rel, err := filepath.Rel(real, p)
		if err != nil || filepath.IsAbs(rel) {
			continue
		}
		if rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))) {
			return true
		}
	}
	return false
}

// --- keys ---

// cleanKeyPrefix normalises a typed prefix: backslashes become slashes (a Windows
// path typed by habit), empty segments collapse, and a "." or ".." segment is
// refused so a prefix cannot climb out of where the destination puts it.
func cleanKeyPrefix(p string) (string, error) {
	var segs []string
	for _, seg := range strings.Split(strings.ReplaceAll(p, `\`, "/"), "/") {
		seg = strings.TrimSpace(seg)
		switch seg {
		case "":
		case ".", "..":
			return "", fmt.Errorf("key prefix %q must not contain %q", p, seg)
		default:
			segs = append(segs, seg)
		}
	}
	return strings.Join(segs, "/"), nil
}

// joinKey joins key parts with a single forward slash, whatever the OS is.
func joinKey(parts ...string) string {
	var kept []string
	for _, p := range parts {
		if p = strings.Trim(p, "/"); p != "" {
			kept = append(kept, p)
		}
	}
	return strings.Join(kept, "/")
}

// --- collecting ---

// collectUploadItems lists what src holds, in the order it will be sent: a single
// file is one item, a folder is walked depth first in lexical order, which is the
// order filepath.WalkDir gives and the one a caller relies on to put a file last
// (a name that sorts last, or a list of its own passed to syncUploadItems).
//
// src must already be resolved (resolveUploadSource). Every key is keyPrefix plus
// the file's path below src with forward slashes on every OS, so a Windows server
// writes the same keys a Linux one does. A symlink is followed only for a file
// whose target is inside roots; a link out of them fails the whole collection, and
// since nothing has been sent yet, the whole upload with it. A linked folder is
// not entered, and neither is anything that is not a regular file.
func collectUploadItems(src, keyPrefix string, roots []string) ([]uploadItem, error) {
	info, err := os.Stat(src)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		if !info.Mode().IsRegular() {
			return nil, fmt.Errorf("%s is not a regular file", filepath.Base(src))
		}
		return []uploadItem{{Path: src, Key: joinKey(keyPrefix, filepath.Base(src)), Size: info.Size()}}, nil
	}

	var items []uploadItem
	err = filepath.WalkDir(src, func(p string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(src, p)
		if err != nil {
			return err
		}
		readFrom := p
		if d.Type()&fs.ModeSymlink != 0 {
			target, err := filepath.EvalSymlinks(p)
			if err != nil {
				return fmt.Errorf("%s is a link that cannot be followed: %w", filepath.ToSlash(rel), err)
			}
			if !insideAny(roots, target) {
				return fmt.Errorf("%s is a link that %w", filepath.ToSlash(rel), errOutsideUploadRoots)
			}
			readFrom = target
		}
		fi, err := os.Stat(readFrom)
		if err != nil {
			return err
		}
		if !fi.Mode().IsRegular() {
			return nil
		}
		items = append(items, uploadItem{Path: readFrom, Key: joinKey(keyPrefix, filepath.ToSlash(rel)), Size: fi.Size()})
		return nil
	})
	if err != nil {
		return nil, err
	}
	return items, nil
}

// maxUploadObjectBytes is the largest single object. A variable so a test can
// prove the refusal without writing 5 GiB.
var maxUploadObjectBytes = s3MaxSinglePutBytes

// checkUploadSizes refuses the whole plan if any file is over the single-PUT
// limit. It runs before the first request on purpose: a folder that goes up with
// one file missing is a bucket that looks complete and is not, and the caller
// that needs an index last cannot tell. The message names the file and says that
// nothing was sent.
func checkUploadSizes(items []uploadItem) error {
	for _, it := range items {
		if it.Size > maxUploadObjectBytes {
			return fmt.Errorf("%s is %s, over the 5 GiB single upload limit, so nothing was uploaded; split it or leave it out of the folder: %w",
				it.Key, fmtBytes(it.Size), ErrS3TooLarge)
		}
	}
	return nil
}

// --- syncing ---

// syncUploadItems sends items in order. For each one a HEAD decides: an object the
// bucket holds at the same size is skipped, one that is missing or a different
// size is sent (and so replaced). The first failure stops the run and is returned
// with what was done so far; the objects before it stay, which is what makes a
// second run a resume. A cancelled ctx stops between objects, and a PUT cut off
// mid-body is not stored, so nothing partial is left.
//
// Size is the whole comparison, so a file edited to the same byte length is not
// noticed. That is the trade of a HEAD per object; the callers upload data whose
// size changes when it does.
func syncUploadItems(ctx context.Context, store objectStore, items []uploadItem, progress func(uploadProgress)) (uploadResult, error) {
	var res uploadResult
	var totalBytes int64
	for _, it := range items {
		totalBytes += it.Size
	}
	for i, it := range items {
		if err := ctx.Err(); err != nil {
			return res, err
		}
		info, found, err := store.HeadObject(ctx, it.Key)
		if err != nil {
			return res, fmt.Errorf("object %d of %d: %w", i+1, len(items), err)
		}
		if found && info.Size == it.Size {
			res.Skipped++
		} else {
			if err := store.PutObject(ctx, it.Key, it.Path, S3PutOptions{}); err != nil {
				return res, fmt.Errorf("object %d of %d: %w", i+1, len(items), err)
			}
			res.Uploaded++
			res.Bytes += it.Size
		}
		if progress != nil {
			progress(uploadProgress{Done: i + 1, Total: len(items), Result: res, TotalBytes: totalBytes})
		}
	}
	return res, nil
}

// uploadPlan is everything runUpload needs, so the block's executor stays a thin
// reader of config and services.
type uploadPlan struct {
	Store      objectStore
	Source     string   // as typed: relative to WorkingDir, or absolute
	WorkingDir string   // the server's, from its config, never from the graph
	Roots      []string // the folders a source may be inside
	KeyPrefix  string   // the destination's prefix, then the node's
	Label      string   // what the narration calls the destination
	Narrate    func(line string)
}

// runUpload resolves and collects the source, refuses what must not go up, and
// syncs it. Every refusal happens before the first request.
func runUpload(ctx context.Context, p uploadPlan) (uploadResult, error) {
	narrate := p.Narrate
	if narrate == nil {
		narrate = func(string) {}
	}
	src, err := resolveUploadSource(p.Source, p.WorkingDir, p.Roots)
	if err != nil {
		return uploadResult{}, err
	}
	items, err := collectUploadItems(src, p.KeyPrefix, p.Roots)
	if err != nil {
		return uploadResult{}, err
	}
	if len(items) == 0 {
		return uploadResult{}, fmt.Errorf("source %s holds no files to upload", p.Source)
	}
	if err := checkUploadSizes(items); err != nil {
		return uploadResult{}, err
	}

	var total int64
	for _, it := range items {
		total += it.Size
	}
	narrate(fmt.Sprintf("Uploading %d file(s), %s, to %s", len(items), fmtBytes(total), p.Label))

	last := time.Now()
	res, err := syncUploadItems(ctx, p.Store, items, func(pr uploadProgress) {
		if pr.Done == pr.Total || time.Since(last) < uploadProgressEvery {
			return
		}
		last = time.Now()
		narrate(fmt.Sprintf("Upload: %d of %d file(s) done, %s of %s sent",
			pr.Done, pr.Total, fmtBytes(pr.Result.Bytes), fmtBytes(pr.TotalBytes)))
	})
	if err != nil {
		return res, err
	}
	narrate(fmt.Sprintf("Upload finished: %d sent (%s), %d already there", res.Uploaded, fmtBytes(res.Bytes), res.Skipped))
	return res, nil
}

// readableUploadError adds what a person can act on to a refused credential, the
// failure with a usual cause, and leaves every other error as the client wrote it.
func readableUploadError(err error) error {
	var se *S3Error
	if errors.As(err, &se) && (se.Status == http.StatusForbidden || se.Status == http.StatusUnauthorized) {
		return fmt.Errorf("the bucket refused the upload (%d %s): check the destination's access key and secret, and that the key may write to the bucket: %w", se.Status, se.Code, err)
	}
	return err
}
