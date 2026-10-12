package services

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"
)

// ─── Pruning old snapshots (#560) ──────────────────────────────────────────
//
// Three snapshots are published to the in-memory bucket of upload_test.go, each
// changing one or two parts of the overworld, so that some parts belong to one
// snapshot, some to two and some to all three:
//
//	snapshot 1:  A0 A1 A2 A3 | N0 N1
//	snapshot 2:  A0 B1 A2 A3 | N0 N1
//	snapshot 3:  A0 C1 C2 A3 | N0 N1

const dhPubCreated3 = "20261025T040000Z"

var dhPubTime3 = time.Date(2026, 10, 25, 4, 0, 0, 0, time.UTC)

type pruneScene struct {
	*dhPublishFixture
	ix   [3]DHIndex
	keys SnapshotKeys
	// dbs3 are snapshot 3's databases, the base of a fourth.
	dbs3 map[string][]byte
	// publishNarration is what the third publish said.
	publishNarration []string
	// pruneNarration is what the last direct prune said.
	pruneNarration []string
}

// newPruneScene publishes snapshots 1 and 2 without pruning and snapshot 3 with
// keepThird (0 for no prune), and returns the bucket holding them.
func newPruneScene(t *testing.T, keepThird int) *pruneScene {
	t.Helper()
	f := newDHPublishFixture(t)
	s := &pruneScene{dhPublishFixture: f}

	dbs1 := dhPubDBs()
	dbs2 := dhPubDBs()
	dbs2[dhPubOverworld] = flip(dbs2[dhPubOverworld], dhTestPart+5)
	dbs3 := dhPubDBs()
	dbs3[dhPubOverworld] = flip(flip(dbs3[dhPubOverworld], dhTestPart+9), 2*dhTestPart+3)
	s.dbs3 = dbs3

	dir, ix := f.stage(dbs1, nil, dhPubTime1)
	s.ix[0] = ix
	if _, err := f.publish(dir); err != nil {
		t.Fatal(err)
	}
	dir, ix = f.stage(dbs2, &s.ix[0], dhPubTime2)
	s.ix[1] = ix
	if _, err := f.publish(dir); err != nil {
		t.Fatal(err)
	}
	dir, ix = f.stage(dbs3, &s.ix[1], dhPubTime3)
	s.ix[2] = ix
	f.plan.Keep = keepThird
	quiet := f.plan.Narrate
	f.plan.Narrate = func(line string) { s.publishNarration = append(s.publishNarration, line) }
	res, err := f.publish(dir)
	if err != nil {
		t.Fatal(err)
	}
	f.plan.Narrate, f.plan.Keep = quiet, 0
	if res.URL == "" {
		t.Fatal("the third publish has no url")
	}
	keys, err := snapshotKeys("dh", "", dhPubTime3)
	if err != nil {
		t.Fatal(err)
	}
	s.keys = keys
	s.reset()
	return s
}

func flip(b []byte, at int) []byte {
	out := append([]byte(nil), b...)
	out[at] ^= 0xFF
	return out
}

func (s *pruneScene) prune(keep int) (dhPruneResult, error) {
	s.pruneNarration = nil
	return pruneDHSnapshots(context.Background(), s.client, s.keys, keep, func(l string) { s.pruneNarration = append(s.pruneNarration, l) })
}

// publishFourth stages and publishes a fourth snapshot, a week after the third
// with one nether part changed, keeping keep snapshots.
func (s *pruneScene) publishFourth(keep int) (dhPublishResult, error) {
	dbs := map[string][]byte{dhPubOverworld: s.dbs3[dhPubOverworld], dhPubNether: flip(s.dbs3[dhPubNether], 7)}
	dir, _ := s.stage(dbs, &s.ix[2], dhPubTime3.Add(7*24*time.Hour))
	s.plan.Keep = keep
	s.narration = nil
	return s.publish(dir)
}

// folderKeys are the objects a publish at stamp wrote under its folder.
func folderKeys(stamp string) []string {
	return []string{
		"dh/snapshots/" + stamp + "/index.json",
		"dh/snapshots/" + stamp + "/index.html",
		assembledKey(stamp, dhPubOverworld),
		assembledKey(stamp, dhPubNether),
	}
}

// part is the key of snapshot n's (0-based) level l's part i.
func (s *pruneScene) part(n, l, i int) string {
	return partKey(s.ix[n].Levels[l].Parts[i].SHA256)
}

func (s *pruneScene) size(keys ...string) int64 {
	var n int64
	for _, k := range keys {
		n += int64(len(s.bucket.object(k)))
	}
	return n
}

func sorted(keys []string) []string {
	out := slices.Clone(keys)
	slices.Sort(out)
	return out
}

func assertSameKeys(t *testing.T, what string, got, want []string) {
	t.Helper()
	if g, w := sorted(got), sorted(want); !slices.Equal(g, w) {
		t.Errorf("%s:\n got  %v\n want %v", what, g, w)
	}
}

// plantBystanders puts objects in the bucket that a prune must never touch: ones
// outside the prefix, and ones inside it that are neither a snapshot's nor a part.
func (s *pruneScene) plantBystanders() []string {
	orphanless := []string{
		"other/parts/" + strings.Repeat("a", 64),
		"other/snapshots/" + dhPubCreated1 + "/index.json",
		"dh2/snapshots/" + dhPubCreated1 + "/index.json",
		"dh2/parts/" + strings.Repeat("b", 64),
		"dh/notes.txt",
		"dh/parts/readme.txt",
		"dh/parts/sub/" + strings.Repeat("c", 64),
		"dh/snapshots/notes.txt",
		"dh/snapshots/manual/index.json",
		"dh/snapshots/2026-10-11/index.json",
	}
	for _, k := range orphanless {
		s.bucket.put(k, []byte("keep me "+k))
	}
	return orphanless
}

func (s *pruneScene) assertPresent(keys ...string) {
	s.t.Helper()
	for _, k := range keys {
		if _, ok := s.bucket.snapshot()[k]; !ok {
			s.t.Errorf("%s is gone", k)
		}
	}
}

func (s *pruneScene) assertAbsent(keys ...string) {
	s.t.Helper()
	for _, k := range keys {
		if _, ok := s.bucket.snapshot()[k]; ok {
			s.t.Errorf("%s is still there", k)
		}
	}
}

func TestDHPruneThreeSnapshotsKeepTwoDeletesTheOldestAndExactlyItsUnsharedParts(t *testing.T) {
	s := newPruneScene(t, 0)
	bystanders := s.plantBystanders()
	// A part nothing names, as a run that was cut off leaves behind.
	orphan := partKey(strings.Repeat("d", 64))
	s.bucket.put(orphan, []byte("orphan"))
	latestBefore := string(s.bucket.object("dh/latest.json"))
	wantFolder := folderKeys(dhPubCreated1)
	wantParts := []string{s.part(0, 0, 1), orphan} // A1 is in snapshot 1 only
	wantBytes := s.size(wantFolder...) + s.size(wantParts...)

	res, err := s.prune(2)
	if err != nil {
		t.Fatal(err)
	}
	if res.SnapshotsDeleted != 1 || res.PartsDeleted != 2 || res.BytesFreed != wantBytes {
		t.Errorf("result = %+v, want 1 snapshot, 2 parts, %d bytes", res, wantBytes)
	}
	assertSameKeys(t, "keys sent for deletion", s.bucket.deletedKeys(), append(slices.Clone(wantFolder), wantParts...))
	if n := s.bucket.deleteRequests(); n != 2 {
		t.Errorf("%d delete requests, want the folder and then the parts", n)
	}

	// Every part a kept snapshot names is still there, including the ones the
	// deleted snapshot shared: A0, A2 (snapshot 2), A3, N0, N1, B1 and C1, C2.
	for _, n := range []int{1, 2} {
		for l, level := range s.ix[n].Levels {
			for i := range level.Parts {
				s.assertPresent(s.part(n, l, i))
			}
		}
	}
	s.assertPresent(s.part(0, 0, 2), s.part(0, 0, 0))
	s.assertPresent(folderKeys(dhPubCreated2)...)
	s.assertPresent(folderKeys(dhPubCreated3)...)
	s.assertPresent(bystanders...)
	s.assertAbsent(wantFolder...)
	s.assertAbsent(wantParts...)
	if string(s.bucket.object("dh/latest.json")) != latestBefore {
		t.Error("latest.json changed")
	}
	if !strings.Contains(strings.Join(s.pruneNarration, "\n"), "Pruned: 1 snapshot(s) and 2 part(s) deleted") {
		t.Errorf("narration:\n%s", strings.Join(s.pruneNarration, "\n"))
	}
}

func TestDHPruneThroughThePublishRunsLastAndFillsTheResult(t *testing.T) {
	s := newPruneScene(t, 2)
	// newPruneScene published snapshot 3 with Keep 2, narrating into s.narrated_.
	s.assertAbsent(folderKeys(dhPubCreated1)...)
	s.assertAbsent(s.part(0, 0, 1))
	s.assertPresent(folderKeys(dhPubCreated2)...)
	s.assertPresent(folderKeys(dhPubCreated3)...)
	s.assertPresent("dh/latest.json", s.part(0, 0, 2))

	lines := s.publishNarration
	published, pruning := -1, -1
	for i, l := range lines {
		switch {
		case strings.HasPrefix(l, "Published: "):
			published = i
		case strings.HasPrefix(l, "Pruning: "):
			pruning = i
		}
	}
	if published < 0 || pruning < published {
		t.Errorf("narration order wrong (published %d, pruning %d):\n%s", published, pruning, strings.Join(lines, "\n"))
	}
	if strings.Contains(strings.Join(lines, "\n"), "Prune skipped") {
		t.Errorf("narration:\n%s", strings.Join(lines, "\n"))
	}
}

func TestDHPublishResultCountsWhatThePruneDeleted(t *testing.T) {
	f := newDHPublishFixture(t)
	dbs1, dbs2 := dhPubDBs(), dhPubDBs()
	dbs2[dhPubOverworld] = flip(dbs2[dhPubOverworld], dhTestPart+5)
	dir, ix1 := f.stage(dbs1, nil, dhPubTime1)
	if _, err := f.publish(dir); err != nil {
		t.Fatal(err)
	}
	dir, _ = f.stage(dbs2, &ix1, dhPubTime2)
	f.plan.Keep = 1
	res, err := f.publish(dir)
	if err != nil {
		t.Fatal(err)
	}
	wantBytes := int64(len(dbs1[dhPubOverworld])+len(dbs1[dhPubNether])) + dhTestPart // the folder's two files and A1
	// index.json and index.html are in the folder too.
	if res.SnapshotsDeleted != 1 || res.PartsDeleted != 1 || res.BytesFreed < wantBytes || res.Warning != "" {
		t.Errorf("result = %+v: want 1 snapshot, 1 part, at least %d bytes, no warning", res, wantBytes)
	}
	if res.URL == "" {
		t.Error("no url")
	}
}

func TestDHPrunePagedListingsFindEveryFolder(t *testing.T) {
	s := newPruneScene(t, 0)
	s.bucket.mu.Lock()
	s.bucket.listPageSize = 3
	s.bucket.mu.Unlock()
	orphan := partKey(strings.Repeat("d", 64))
	s.bucket.put(orphan, []byte("orphan"))

	res, err := s.prune(1)
	if err != nil {
		t.Fatal(err)
	}
	if res.SnapshotsDeleted != 2 {
		t.Errorf("result = %+v: with 3 keys to a page, a folder on a later page was missed", res)
	}
	s.assertAbsent(folderKeys(dhPubCreated1)...)
	s.assertAbsent(folderKeys(dhPubCreated2)...)
	s.assertPresent(folderKeys(dhPubCreated3)...)
	// Parts only snapshots 1 and 2 used, and the orphan, which sat on a later page.
	want := []string{s.part(0, 0, 1), s.part(1, 0, 1), s.part(0, 0, 2), orphan}
	s.assertAbsent(want...)
	if res.PartsDeleted != len(want) {
		t.Errorf("parts deleted = %d, want %d", res.PartsDeleted, len(want))
	}
	lists := 0
	for _, r := range s.wire() {
		if r.Query.Get("list-type") == "2" {
			lists++
		}
	}
	if lists < 4 {
		t.Errorf("%d list requests: the paging was not exercised", lists)
	}
}

func TestDHPruneKeepsTheSnapshotLatestPointsAtWhateverKeepIs(t *testing.T) {
	s := newPruneScene(t, 0)
	// latest.json points at the oldest snapshot, as after a rollback.
	s.bucket.put("dh/latest.json", []byte(fmt.Sprintf(`{"format":1,"createdAt":%q,"index":"snapshots/%s/index.json"}`, s.ix[0].CreatedAt, dhPubCreated1)))

	res, err := s.prune(1)
	if err != nil {
		t.Fatal(err)
	}
	// Kept: the newest (keep 1) and the one latest.json names. Snapshot 2 goes.
	if res.SnapshotsDeleted != 1 {
		t.Errorf("result = %+v", res)
	}
	s.assertPresent(folderKeys(dhPubCreated1)...)
	s.assertPresent(folderKeys(dhPubCreated3)...)
	s.assertAbsent(folderKeys(dhPubCreated2)...)
	// B1 was snapshot 2's alone. A2 and A1 are snapshot 1's, kept now.
	s.assertAbsent(s.part(1, 0, 1))
	s.assertPresent(s.part(0, 0, 1), s.part(0, 0, 2), s.part(2, 0, 1))
	if got := string(s.bucket.object("dh/latest.json")); !strings.Contains(got, dhPubCreated1) {
		t.Errorf("latest.json = %s: it was touched", got)
	}
}

func TestDHPruneKeepsLatestsFolderEvenWhenItsIndexIsOutsideTheSnapshotsFolder(t *testing.T) {
	s := newPruneScene(t, 0)
	// A pointer at an index that is not in any snapshot folder: its parts are
	// still protected, and the folders are pruned by keep alone.
	idx, err := s.ix[0].Marshal()
	if err != nil {
		t.Fatal(err)
	}
	s.bucket.put("dh/elsewhere/index.json", idx)
	s.bucket.put("dh/latest.json", []byte(fmt.Sprintf(`{"format":1,"createdAt":%q,"index":"elsewhere/index.json"}`, s.ix[0].CreatedAt)))
	if _, err := s.prune(1); err != nil {
		t.Fatal(err)
	}
	s.assertPresent(s.part(0, 0, 1), s.part(0, 0, 2), "dh/elsewhere/index.json")
}

func TestDHPruneAKeptIndexThatCannotBeReadDeletesNothingAtAll(t *testing.T) {
	cases := map[string]func(s *pruneScene){
		"a GET that fails": func(s *pruneScene) {
			s.bucket.setFailGet(func(key string) (int, string) {
				if key == "dh/snapshots/"+dhPubCreated2+"/index.json" {
					return 500, "InternalError"
				}
				return 0, ""
			})
		},
		"an index that is not JSON": func(s *pruneScene) {
			s.bucket.put("dh/snapshots/"+dhPubCreated2+"/index.json", []byte("<html>not an index</html>"))
		},
		"an index of a format this build does not know": func(s *pruneScene) {
			s.bucket.put("dh/snapshots/"+dhPubCreated3+"/index.json", []byte(`{"format":9}`))
		},
		"an index that went missing after it was listed": func(s *pruneScene) {
			s.bucket.setFailGet(func(key string) (int, string) {
				if key == "dh/snapshots/"+dhPubCreated2+"/index.json" {
					return 404, "NoSuchKey"
				}
				return 0, ""
			})
		},
	}
	for name, break_ := range cases {
		t.Run(name, func(t *testing.T) {
			s := newPruneScene(t, 0)
			break_(s)
			before := len(s.bucket.snapshot())
			res, err := s.prune(2)
			if err == nil || !strings.Contains(err.Error(), "nothing was deleted") {
				t.Fatalf("err = %v, want one saying nothing was deleted", err)
			}
			if res != (dhPruneResult{}) {
				t.Errorf("result = %+v", res)
			}
			if n := s.bucket.deleteRequests(); n != 0 {
				t.Errorf("%d delete requests: not even the old folder may go when a kept index cannot be read", n)
			}
			if after := len(s.bucket.snapshot()); after != before {
				t.Errorf("%d objects before, %d after", before, after)
			}
		})
	}
}

func TestDHPruneLatestThatCannotBeResolvedDeletesNothing(t *testing.T) {
	cases := map[string][]byte{
		"missing":          nil,
		"not JSON":         []byte("nope"),
		"points up a path": []byte(`{"format":1,"createdAt":"x","index":"../other/index.json"}`),
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			s := newPruneScene(t, 0)
			s.bucket.mu.Lock()
			if body == nil {
				delete(s.bucket.objects, "dh/latest.json")
			} else {
				s.bucket.objects["dh/latest.json"] = body
			}
			s.bucket.mu.Unlock()
			if _, err := s.prune(1); err == nil {
				t.Fatal("no error")
			}
			if n := s.bucket.deleteRequests(); n != 0 {
				t.Errorf("%d delete requests", n)
			}
		})
	}
}

func TestDHPruneAListFailureEndsAsAWarningWithTheRunComplete(t *testing.T) {
	s := newPruneScene(t, 0)
	s.bucket.mu.Lock()
	s.bucket.failList = func() (int, string) { return 403, "AccessDenied" }
	s.bucket.mu.Unlock()
	// A fourth snapshot is published over the three, with the listing refused.
	res, err := s.publishFourth(2)
	if err != nil {
		t.Fatalf("a failed prune failed the publish: %v", err)
	}
	if res.URL == "" {
		t.Error("no url")
	}
	if !strings.HasPrefix(res.Warning, "Prune skipped: ") || !strings.Contains(res.Warning, "AccessDenied") {
		t.Errorf("warning = %q", res.Warning)
	}
	if strings.Contains(res.Warning, testSecret) || strings.Contains(s.narrated(), testSecret) {
		t.Error("the secret is in the warning or the narration")
	}
	if !strings.Contains(s.narrated(), res.Warning) {
		t.Errorf("the warning was not narrated:\n%s", s.narrated())
	}
	if n := s.bucket.deleteRequests(); n != 0 {
		t.Errorf("%d delete requests after a failed listing", n)
	}
	s.assertPresent(folderKeys(dhPubCreated1)...)
	// The new snapshot is published: latest.json names it.
	latest, perr := parseDHLatest(s.bucket.object("dh/latest.json"))
	if perr != nil || !strings.Contains(latest.Index, "20261101T040000Z") {
		t.Errorf("latest = %+v (%v)", latest, perr)
	}
}

func TestDHPruneADeleteFailureEndsAsAWarningAndLeavesTheBucketAsItWas(t *testing.T) {
	s := newPruneScene(t, 0)
	s.bucket.mu.Lock()
	s.bucket.failDelete = func([]string) (int, string) { return 403, "AccessDenied" }
	s.bucket.mu.Unlock()
	res, err := s.publishFourth(1)
	if err != nil || res.URL == "" {
		t.Fatalf("res %+v err %v", res, err)
	}
	if !strings.HasPrefix(res.Warning, "Prune skipped: delete old snapshots") || strings.Contains(res.Warning, testSecret) {
		t.Errorf("warning = %q", res.Warning)
	}
	if res.SnapshotsDeleted != 0 || res.PartsDeleted != 0 || res.BytesFreed != 0 {
		t.Errorf("result = %+v: nothing was deleted", res)
	}
	s.assertPresent(folderKeys(dhPubCreated1)...)
}

func TestDHPruneAKeyTheBucketCannotDeleteIsAWarningNamingHowManyAndCountsTheRest(t *testing.T) {
	s := newPruneScene(t, 0)
	a1 := s.part(0, 0, 1)
	s.bucket.mu.Lock()
	s.bucket.stuck = map[string]bool{a1: true}
	s.bucket.mu.Unlock()
	res, err := s.prune(2)
	if err == nil || !strings.Contains(err.Error(), "delete unreferenced parts") || !strings.Contains(err.Error(), "1 of 1 key(s) could not be deleted") {
		t.Fatalf("err = %v", err)
	}
	// The folder went before the parts were tried, and that is counted.
	if res.SnapshotsDeleted != 1 || res.PartsDeleted != 0 {
		t.Errorf("result = %+v", res)
	}
	s.assertAbsent(folderKeys(dhPubCreated1)...)
	s.assertPresent(a1)
}

func TestDHPrunePartialFailureIsCalledIncomplete(t *testing.T) {
	s := newPruneScene(t, 0)
	s.bucket.mu.Lock()
	s.bucket.stuck = map[string]bool{s.part(0, 0, 1): true}
	s.bucket.mu.Unlock()
	// The run itself prunes: a fourth snapshot, keeping three, retires the first.
	res, err := s.publishFourth(3)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(res.Warning, "Prune incomplete: ") || res.SnapshotsDeleted != 1 {
		t.Errorf("result = %+v", res)
	}
}

func TestDHPruneRefusesAKeyOutsideThePrefixBeforeAnyDeleteIsSent(t *testing.T) {
	for name, planted := range map[string]string{
		"another prefix's snapshot": "other/snapshots/" + dhPubCreated1 + "/index.json",
		"a sibling prefix":          "dh2/snapshots/" + dhPubCreated1 + "/index.json",
		"the prefix's own file":     "dh/latest.json",
	} {
		t.Run(name, func(t *testing.T) {
			s := newPruneScene(t, 0)
			s.bucket.mu.Lock()
			s.bucket.listExtra = []string{planted}
			s.bucket.mu.Unlock()
			before := len(s.bucket.snapshot())
			_, err := s.prune(1)
			if err == nil || !strings.Contains(err.Error(), planted) || !strings.Contains(err.Error(), "nothing was deleted") {
				t.Fatalf("err = %v, want a refusal naming %s", err, planted)
			}
			if n := s.bucket.deleteRequests(); n != 0 {
				t.Errorf("%d delete requests were sent", n)
			}
			if after := len(s.bucket.snapshot()); after != before {
				t.Errorf("%d objects before, %d after", before, after)
			}
		})
	}
}

func TestDHPruneKeyGuard(t *testing.T) {
	public, err := snapshotKeys("dh", "", dhPubTime1)
	if err != nil {
		t.Fatal(err)
	}
	private, err := snapshotKeys("dh/sub", "tok_en-1", dhPubTime1)
	if err != nil {
		t.Fatal(err)
	}
	bare, err := snapshotKeys("", "", dhPubTime1)
	if err != nil {
		t.Fatal(err)
	}
	h := strings.Repeat("e", 64)
	cases := []struct {
		name string
		keys SnapshotKeys
		key  string
		ok   bool
	}{
		{"a snapshot object", public, "dh/snapshots/" + dhPubCreated1 + "/index.json", true},
		{"a part", public, "dh/parts/" + h, true},
		{"outside the prefix", public, "other/snapshots/x/index.json", false},
		{"a sibling that shares the prefix text", public, "dh2/parts/" + h, false},
		{"inside the prefix, neither folder", public, "dh/latest.json", false},
		{"inside the prefix, a stray file", public, "dh/notes.txt", false},
		{"the bare snapshots name", public, "dh/snapshots", false},
		{"an empty key", public, "", false},
		{"a private-layout snapshot", private, "dh/sub/tok_en-1/snapshots/" + dhPubCreated1 + "/index.json", true},
		{"private parts stay at the root", private, "dh/sub/parts/" + h, true},
		{"another token's snapshot", private, "dh/sub/other/snapshots/x/index.json", false},
		{"no prefix: a snapshot", bare, "snapshots/" + dhPubCreated1 + "/index.json", true},
		{"no prefix: a part", bare, "parts/" + h, true},
		{"no prefix: neither", bare, "latest.json", false},
	}
	for _, c := range cases {
		err := checkDHPruneKeys(c.keys, []string{c.key})
		if (err == nil) != c.ok {
			t.Errorf("%s: %q: err = %v, want ok=%v", c.name, c.key, err, c.ok)
		}
	}
}

func TestDHPruneFollowsThePrivateLayout(t *testing.T) {
	f := newDHPublishFixture(t)
	keys, err := snapshotKeys("dh", "tok", dhPubTime3)
	if err != nil {
		t.Fatal(err)
	}
	mk := func(stamp string, parts ...string) {
		ix := DHIndex{Format: dhIndexFormat, CreatedAt: "2026-10-11T04:00:00Z", PartsBase: "../../../parts/", ServerFolder: "1_a"}
		lvl := DHIndexLevel{Folder: "f", Size: 3, SHA256: strings.Repeat("0", 64)}
		for _, p := range parts {
			lvl.Parts = append(lvl.Parts, DHPart{SHA256: p, Size: 1})
		}
		ix.Levels = []DHIndexLevel{lvl}
		data, err := ix.Marshal()
		if err != nil {
			t.Fatal(err)
		}
		f.bucket.put("dh/tok/snapshots/"+stamp+"/index.json", data)
		f.bucket.put("dh/tok/snapshots/"+stamp+"/f/DistantHorizons.sqlite", []byte("db"))
		for _, p := range parts {
			f.bucket.put("dh/parts/"+p, []byte("p"))
		}
	}
	h := func(c string) string { return strings.Repeat(c, 64) }
	mk(dhPubCreated1, h("1"), h("2"))
	mk(dhPubCreated2, h("2"), h("3"))
	mk(dhPubCreated3, h("3"), h("4"))
	f.bucket.put("dh/tok/latest.json", []byte(fmt.Sprintf(`{"format":1,"createdAt":"x","index":"snapshots/%s/index.json"}`, dhPubCreated3)))
	// A snapshot of another token under the same prefix is not this layout's.
	f.bucket.put("dh/old/snapshots/"+dhPubCreated1+"/index.json", []byte("{}"))

	res, err := pruneDHSnapshots(context.Background(), f.client, keys, 2, nil)
	if err != nil {
		t.Fatal(err)
	}
	if res.SnapshotsDeleted != 1 || res.PartsDeleted != 1 {
		t.Errorf("result = %+v", res)
	}
	got := f.bucket.snapshot()
	for _, gone := range []string{"dh/tok/snapshots/" + dhPubCreated1 + "/index.json", "dh/parts/" + h("1")} {
		if _, ok := got[gone]; ok {
			t.Errorf("%s survived", gone)
		}
	}
	for _, kept := range []string{"dh/parts/" + h("2"), "dh/parts/" + h("3"), "dh/parts/" + h("4"), "dh/tok/latest.json", "dh/old/snapshots/" + dhPubCreated1 + "/index.json"} {
		if _, ok := got[kept]; !ok {
			t.Errorf("%s was deleted", kept)
		}
	}
}

func TestDHPruneAnIncompleteFolderIsDeletedOnlyWhenOlderThanEveryKeptSnapshot(t *testing.T) {
	s := newPruneScene(t, 0)
	older := "dh/snapshots/20260901T040000Z/"
	newer := "dh/snapshots/20261201T040000Z/"
	for _, k := range []string{older + "pfx@minecraft@@overworld/DistantHorizons.sqlite", newer + "pfx@minecraft@@overworld/DistantHorizons.sqlite"} {
		s.bucket.put(k, []byte("half"))
	}
	res, err := s.prune(2)
	if err != nil {
		t.Fatal(err)
	}
	// A cut-off run does not count as a snapshot kept, so 2 and 3 are kept and 1
	// goes with the older stub; the newer stub might be a publish in progress.
	if res.SnapshotsDeleted != 2 {
		t.Errorf("result = %+v, want snapshot 1 and the older stub", res)
	}
	s.assertAbsent(older + "pfx@minecraft@@overworld/DistantHorizons.sqlite")
	s.assertPresent(newer + "pfx@minecraft@@overworld/DistantHorizons.sqlite")
	s.assertPresent(folderKeys(dhPubCreated2)...)
	s.assertPresent(folderKeys(dhPubCreated3)...)
}

func TestDHPruneNothingToDoSendsNoDelete(t *testing.T) {
	s := newPruneScene(t, 0)
	res, err := s.prune(3)
	if err != nil {
		t.Fatal(err)
	}
	if res != (dhPruneResult{}) || s.bucket.deleteRequests() != 0 {
		t.Errorf("result %+v, %d delete requests: three snapshots with keep 3 and no orphan is nothing to do", res, s.bucket.deleteRequests())
	}
	if !strings.Contains(strings.Join(s.pruneNarration, "\n"), "Nothing to prune") {
		t.Errorf("narration:\n%s", strings.Join(s.pruneNarration, "\n"))
	}
	if res, err := s.prune(0); err == nil || res != (dhPruneResult{}) {
		t.Errorf("keep 0: res %+v err %v, want a refusal", res, err)
	}
}

func TestDHPruneLatestPointingAtNothingIsAnError(t *testing.T) {
	f := newDHPublishFixture(t)
	keys, err := snapshotKeys("dh", "", dhPubTime1)
	if err != nil {
		t.Fatal(err)
	}
	f.bucket.put("dh/latest.json", []byte(fmt.Sprintf(`{"format":1,"createdAt":"x","index":"snapshots/%s/index.json"}`, dhPubCreated1)))
	// latest.json names an index that is not there, so nothing is known to be safe.
	if _, err := pruneDHSnapshots(context.Background(), f.client, keys, 2, nil); err == nil {
		t.Error("a pointer at nothing was accepted")
	}
	if n := f.bucket.deleteRequests(); n != 0 {
		t.Errorf("%d delete requests", n)
	}
}

func TestDHPublishWithoutKeepPrunesNothing(t *testing.T) {
	s := newPruneScene(t, 0)
	if n := s.bucket.deleteRequests(); n != 0 {
		t.Errorf("%d delete requests from a plan with no Keep", n)
	}
	s.assertPresent(folderKeys(dhPubCreated1)...)
}
