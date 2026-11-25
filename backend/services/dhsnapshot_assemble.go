package services

import (
	"context"
	"fmt"
	"time"
)

// Assembling a level's whole DistantHorizons.sqlite in the bucket (#565). The
// parts are already there, named by hash; one multipart upload whose every part
// is an UploadPartCopy makes the bucket build the file itself, so no data leaves
// the machine and a player downloads one file instead of two thousand. The upload
// is aborted on any failure, so a half-built one is never kept or billed.

var (
	// dhCopyRangeBytes is the size of each range copied from a previous snapshot's
	// assembled file: 1 GiB, far below the 5 GiB one copy may take, and large
	// enough that a 20 GB file is twenty calls where assembling from parts is
	// 2,500. Every range but the last is this size, which R2 requires of the
	// parts of one upload. A variable so a test can shrink it.
	dhCopyRangeBytes int64 = 1 << 30

	// dhAbortTimeout bounds the abort that follows a failed assembly. It runs on a
	// context of its own, since the usual reason to abort is that the run's was
	// cancelled, and an upload left open would be billed.
	dhAbortTimeout = 2 * time.Minute
)

// dhAssembleStore is the part of S3Client the assembly uses.
type dhAssembleStore interface {
	CreateMultipartUpload(ctx context.Context, key string) (string, error)
	UploadPartCopy(ctx context.Context, key, uploadID string, partNumber int, sourceKey string, byteRange *[2]int64) (string, error)
	CompleteMultipartUpload(ctx context.Context, key, uploadID string, etags []string) error
	AbortMultipartUpload(ctx context.Context, key, uploadID string) error
}

// dhCopyStep is one part of an assembly: all of Source, or Range of it (first
// and last byte, inclusive).
type dhCopyStep struct {
	Source string
	Range  *[2]int64
}

// partCopySteps builds a level from its parts: one whole-object copy per part,
// in index order. A part that repeats in the file is copied each time it does.
func partCopySteps(keys SnapshotKeys, l DHIndexLevel) []dhCopyStep {
	steps := make([]dhCopyStep, len(l.Parts))
	for i, part := range l.Parts {
		steps[i] = dhCopyStep{Source: keys.PartKey(part.SHA256)}
	}
	return steps
}

// previousObjectCopies builds a level that did not change from the previous
// snapshot's assembled file, in ranges of dhCopyRangeBytes: the same bytes in
// far fewer calls than copying its parts one by one.
func previousObjectCopies(sourceKey string, size int64) []dhCopyStep {
	var steps []dhCopyStep
	for first := int64(0); first < size; first += dhCopyRangeBytes {
		last := min(first+dhCopyRangeBytes, size) - 1
		steps = append(steps, dhCopyStep{Source: sourceKey, Range: &[2]int64{first, last}})
	}
	return steps
}

// assembleDHObject builds key from steps: create, one copy per step in order
// (part numbers from 1), complete. Any failure after the create aborts the
// upload, and the error says so if the abort failed as well. progress, when
// set, hears the count of steps done after each one.
func assembleDHObject(ctx context.Context, store dhAssembleStore, key string, steps []dhCopyStep, progress func(done, total int)) error {
	if len(steps) == 0 {
		return fmt.Errorf("%s has nothing to assemble from", key)
	}
	if len(steps) > s3MaxMultipartParts {
		return fmt.Errorf("%s would take %d parts to assemble, over the %d one upload may have", key, len(steps), s3MaxMultipartParts)
	}
	uploadID, err := store.CreateMultipartUpload(ctx, key)
	if err != nil {
		return err
	}
	etags, err := copySteps(ctx, store, key, uploadID, steps, progress)
	if err == nil {
		err = store.CompleteMultipartUpload(ctx, key, uploadID, etags)
	}
	if err == nil {
		return nil
	}
	abortCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), dhAbortTimeout)
	defer cancel()
	if abortErr := store.AbortMultipartUpload(abortCtx, key, uploadID); abortErr != nil {
		return fmt.Errorf("%w; the half-built upload of %s could not be aborted either: %v", err, key, abortErr)
	}
	return err
}

func copySteps(ctx context.Context, store dhAssembleStore, key, uploadID string, steps []dhCopyStep, progress func(done, total int)) ([]string, error) {
	etags := make([]string, 0, len(steps))
	for i, step := range steps {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		etag, err := store.UploadPartCopy(ctx, key, uploadID, i+1, step.Source, step.Range)
		if err != nil {
			return nil, err
		}
		etags = append(etags, etag)
		if progress != nil {
			progress(i+1, len(steps))
		}
	}
	return etags, nil
}
