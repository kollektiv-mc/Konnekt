package services

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
)

// fakeAssembler records the calls of an assembly and fails the one it is told to.
type fakeAssembler struct {
	log      []string
	failOn   string // "create", "copy:N", "complete" or "abort"
	copySeen []dhCopyStep
	// abortCtxErr is the abort context's error at the moment of the call.
	abortCtxErr error
	aborted     bool
}

func (a *fakeAssembler) fail(op string) error {
	if a.failOn == op {
		return errors.New(op + " refused")
	}
	return nil
}

func (a *fakeAssembler) CreateMultipartUpload(_ context.Context, key string) (string, error) {
	a.log = append(a.log, "create "+key)
	return "up-1", a.fail("create")
}

func (a *fakeAssembler) UploadPartCopy(_ context.Context, _, _ string, n int, src string, rng *[2]int64) (string, error) {
	a.log = append(a.log, fmt.Sprintf("copy %d %s", n, src))
	a.copySeen = append(a.copySeen, dhCopyStep{Source: src, Range: rng})
	return fmt.Sprintf("e%d", n), a.fail(fmt.Sprintf("copy:%d", n))
}

func (a *fakeAssembler) CompleteMultipartUpload(_ context.Context, _, _ string, etags []string) error {
	a.log = append(a.log, "complete "+strings.Join(etags, ","))
	return a.fail("complete")
}

func (a *fakeAssembler) AbortMultipartUpload(ctx context.Context, _, id string) error {
	a.log = append(a.log, "abort "+id)
	a.aborted, a.abortCtxErr = true, ctx.Err()
	return a.fail("abort")
}

func TestAssembleDHObjectSequence(t *testing.T) {
	a := &fakeAssembler{}
	steps := []dhCopyStep{{Source: "p/a"}, {Source: "p/b"}, {Source: "p/c"}}
	var seen []int
	if err := assembleDHObject(context.Background(), a, "k", steps, func(done, total int) { seen = append(seen, done*10+total) }); err != nil {
		t.Fatal(err)
	}
	want := "create k|copy 1 p/a|copy 2 p/b|copy 3 p/c|complete e1,e2,e3"
	if got := strings.Join(a.log, "|"); got != want {
		t.Errorf("calls = %s\nwant    %s", got, want)
	}
	if fmt.Sprint(seen) != "[13 23 33]" {
		t.Errorf("progress = %v", seen)
	}
}

func TestAssembleDHObjectAbortsOnEveryFailureAfterTheCreate(t *testing.T) {
	for _, failOn := range []string{"copy:1", "copy:2", "complete"} {
		t.Run(failOn, func(t *testing.T) {
			a := &fakeAssembler{failOn: failOn}
			err := assembleDHObject(context.Background(), a, "k", []dhCopyStep{{Source: "a"}, {Source: "b"}}, nil)
			if err == nil || !strings.Contains(err.Error(), failOn[:4]) {
				t.Fatalf("err = %v", err)
			}
			if last := a.log[len(a.log)-1]; last != "abort up-1" {
				t.Errorf("last call = %q, want the abort", last)
			}
			if strings.Contains(strings.Join(a.log, "|"), "complete") && failOn != "complete" {
				t.Errorf("an upload with a failed part was completed: %v", a.log)
			}
		})
	}
}

func TestAssembleDHObjectAFailedCreateHasNothingToAbort(t *testing.T) {
	a := &fakeAssembler{failOn: "create"}
	if err := assembleDHObject(context.Background(), a, "k", []dhCopyStep{{Source: "a"}}, nil); err == nil {
		t.Fatal("expected an error")
	}
	if len(a.log) != 1 {
		t.Errorf("calls = %v: no upload id, so no abort", a.log)
	}
}

func TestAssembleDHObjectReportsAFailedAbortToo(t *testing.T) {
	a := &fakeAssembler{failOn: "copy:1"}
	err := assembleDHObject(context.Background(), &abortAlsoFails{a}, "k", []dhCopyStep{{Source: "a"}}, nil)
	if err == nil || !strings.Contains(err.Error(), "copy:1 refused") || !strings.Contains(err.Error(), "could not be aborted either") || !strings.Contains(err.Error(), "abort refused") {
		t.Fatalf("err = %v", err)
	}
}

type abortAlsoFails struct{ *fakeAssembler }

func (a *abortAlsoFails) AbortMultipartUpload(ctx context.Context, key, id string) error {
	a.fakeAssembler.log = append(a.fakeAssembler.log, "abort "+id)
	return errors.New("abort refused")
}

func TestAssembleDHObjectRefusesWhatCannotBeAnUpload(t *testing.T) {
	a := &fakeAssembler{}
	if err := assembleDHObject(context.Background(), a, "k", nil, nil); err == nil {
		t.Error("nothing to assemble was accepted")
	}
	if err := assembleDHObject(context.Background(), a, "k", make([]dhCopyStep, s3MaxMultipartParts+1), nil); err == nil || !strings.Contains(err.Error(), "10000") {
		t.Errorf("too many parts: %v", err)
	}
	if len(a.log) != 0 {
		t.Errorf("calls = %v: the refusals come before the create", a.log)
	}
}

func TestAssembleDHObjectAbortOutlivesACancelledContext(t *testing.T) {
	a := &fakeAssembler{}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	err := assembleDHObject(ctx, a, "k", []dhCopyStep{{Source: "a"}}, nil)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v", err)
	}
	if !a.aborted || a.abortCtxErr != nil {
		t.Errorf("aborted=%v on a context with error %v: the abort must run even when the run was cancelled", a.aborted, a.abortCtxErr)
	}
}

func TestPartCopyStepsAreOneWholeObjectPerPartInOrder(t *testing.T) {
	keys := testKeys(t, "")
	l := DHIndexLevel{Parts: []DHPart{{SHA256: "aa"}, {SHA256: "bb"}, {SHA256: "aa"}}}
	got := partCopySteps(keys, l)
	if len(got) != 3 || got[0].Source != "dh/parts/aa" || got[1].Source != "dh/parts/bb" || got[2].Source != "dh/parts/aa" {
		t.Fatalf("steps = %+v", got)
	}
	for _, s := range got {
		if s.Range != nil {
			t.Errorf("a part copy carries the range %v", *s.Range)
		}
	}
}

func TestPreviousObjectCopiesCoverTheFileExactlyInEqualRanges(t *testing.T) {
	shrinkCopyRange(t, 100)
	for _, size := range []int64{1, 99, 100, 101, 250, 300} {
		steps := previousObjectCopies("src", size)
		var next int64
		for i, s := range steps {
			r := s.Range
			if s.Source != "src" || r == nil || r[0] != next || r[1] < r[0] {
				t.Fatalf("size %d step %d = %+v", size, i, s)
			}
			if i < len(steps)-1 && r[1]-r[0]+1 != 100 {
				t.Errorf("size %d: step %d is %d bytes, every range but the last must be equal", size, i, r[1]-r[0]+1)
			}
			next = r[1] + 1
		}
		if next != size {
			t.Errorf("size %d: ranges end at %d", size, next)
		}
		if want := int((size + 99) / 100); len(steps) != want {
			t.Errorf("size %d: %d steps, want %d", size, len(steps), want)
		}
	}
	if got := previousObjectCopies("src", 0); len(got) != 0 {
		t.Errorf("an empty file has %d ranges", len(got))
	}
}

func TestPreviousObjectCopiesUseOneGiBRanges(t *testing.T) {
	if dhCopyRangeBytes != 1<<30 {
		t.Fatalf("dhCopyRangeBytes = %d, want 1 GiB", dhCopyRangeBytes)
	}
	steps := previousObjectCopies("src", 20<<30+5)
	if len(steps) != 21 || steps[0].Range[1] != 1<<30-1 || steps[20].Range[0] != 20<<30 || steps[20].Range[1] != 20<<30+4 {
		t.Errorf("%d steps for 20 GiB and 5 bytes; first %v, last %v", len(steps), *steps[0].Range, *steps[len(steps)-1].Range)
	}
}
