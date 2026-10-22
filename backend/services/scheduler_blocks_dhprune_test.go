package services

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"konnekt/backend/models"
)

// ─── action.dhPublish retention (#560) ─────────────────────────────────────
//
// The prune itself is dhsnapshot_prune_test.go. These tests are the block: the
// keep value, how a prune's trouble reaches the run record, the event and the
// console, and that it never fails the node.

func TestParseDHKeep(t *testing.T) {
	cases := []struct {
		name string
		in   interface{}
		want int
		bad  bool
	}{
		{"absent", nil, 3, false},
		{"empty", "", 3, false},
		{"blank", "  ", 3, false},
		{"a number", float64(3), 3, false},
		{"one", float64(1), 1, false},
		{"a number as text", "5", 5, false},
		{"a number as text with spaces", " 7 ", 7, false},
		{"an int", 4, 4, false},
		{"zero", float64(0), 0, true},
		{"negative", float64(-2), 0, true},
		{"a fraction", 1.5, 0, true},
		{"a fraction as text", "2.5", 0, true},
		{"text", "many", 0, true},
		{"a bool", true, 0, true},
		{"NaN", "NaN", 0, true},
		{"infinity", "Inf", 0, true},
		{"too many to count", float64(1e12), 0, true},
		{"a list", []interface{}{1}, 0, true},
	}
	for _, c := range cases {
		got, err := parseDHKeep(c.in)
		if (err != nil) != c.bad || (!c.bad && got != c.want) {
			t.Errorf("%s: parseDHKeep(%v) = %d, %v", c.name, c.in, got, err)
		}
	}
}

func TestValidateGraphRetentionRejects0And1Point5AndAccepts3(t *testing.T) {
	graph := func(cfg map[string]interface{}) models.Graph {
		return models.Graph{Nodes: []models.Node{{ID: "p1", Type: dhPublishBlockID, Config: cfg}}}
	}
	for _, keep := range []interface{}{float64(0), 1.5, float64(-1), "zero", true} {
		issues := validateGraphRetention(graph(map[string]interface{}{"keep": keep}))
		if len(issues) != 1 || issues[0].NodeID != "p1" || !strings.Contains(issues[0].Text, "whole number of at least 1") {
			t.Errorf("keep %v: issues = %q", keep, issues)
		}
	}
	for _, keep := range []interface{}{float64(3), float64(1), "3", "", nil, "{{n1.count}}", "@keepCount"} {
		if issues := validateGraphRetention(graph(map[string]interface{}{"keep": keep})); len(issues) != 0 {
			t.Errorf("keep %v: issues = %q", keep, issues)
		}
	}
	if issues := validateGraphRetention(graph(map[string]interface{}{})); len(issues) != 0 {
		t.Errorf("no keep at all: issues = %q, want the default", issues)
	}
	// Only the publish block has a keep.
	other := models.Graph{Nodes: []models.Node{{ID: "x", Type: "action.upload", Config: map[string]interface{}{"keep": float64(0)}}}}
	if issues := validateGraphRetention(other); len(issues) != 0 {
		t.Errorf("another block: issues = %q", issues)
	}
}

// An invalid keep fails the run before anything is sent, and the error is advice.
func TestDHPublishInvalidKeepFailsBeforeSending(t *testing.T) {
	f := dhBlockFixture(t)
	f.stageFor(t, "srv1", "7_alpha", dhPubDBs())
	cfg := publishConfig()
	cfg["keep"] = 0.0
	g := publishGraph("srv1", cfg, false)

	warnings, err := f.s.GraphWarnings("srv1", g)
	if err != nil || len(warnings) != 1 || warnings[0].NodeID != "u1" || !strings.Contains(warnings[0].Text, "whole number of at least 1") {
		t.Errorf("GraphWarnings = %q (%v): the editor should be told while the graph is built", warnings, err)
	}
	rec := f.run(g)
	if rec.Status != "failed" || !strings.Contains(rec.Error, "validation failed") || !strings.Contains(rec.Error, "whole number of at least 1") {
		t.Errorf("run = %q %q", rec.Status, rec.Error)
	}
	if n := len(f.bucket.recorded()); n != 0 {
		t.Errorf("%d requests went out for a graph that cannot run", n)
	}

	// A value only known at run time is judged by the block, before the claim is
	// of any use and before anything is sent.
	res, _ := f.execPublish("srv1", map[string]interface{}{"destination": "R2", "keep": 1.5})
	if res.Port != "onFailed" || res.Err == nil || !strings.Contains(res.Err.Error(), "whole number of at least 1") {
		t.Errorf("result = %+v", res)
	}
	if n := len(f.bucket.recorded()); n != 0 {
		t.Errorf("%d requests went out", n)
	}
}

// stageAt stages dbs as a snapshot taken at created in serverID's staging folder,
// against prev, replacing what was staged.
func (f *uploadFixture) stageAt(t *testing.T, serverID, serverFolder string, dbs map[string][]byte, prev *DHIndex, created time.Time) DHIndex {
	t.Helper()
	root, err := dhStagingRoot(f.dataDir, serverID)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(root); err != nil {
		t.Fatal(err)
	}
	keys, err := snapshotKeys("dh", "", created)
	if err != nil {
		t.Fatal(err)
	}
	src := dhSource(t, dbs)
	src.ServerFolder = serverFolder
	ix, _, err := stageDHSnapshot(src, prev, root, keys, dhTestPart)
	if err != nil {
		t.Fatal(err)
	}
	rewriteIndex(t, root, ix)
	return ix
}

// twoPublishedOneStaged puts snapshots 1 and 2 in the bucket through the real publish, and
// stages a third for the block to publish.
func (f *uploadFixture) twoPublishedOneStaged(t *testing.T) (ix [3]DHIndex) {
	t.Helper()
	client := newTestS3Client(t, f.bucket.s3TestServer)
	dbs2 := dhPubDBs()
	dbs2[dhPubOverworld] = flip(dbs2[dhPubOverworld], dhTestPart+5)
	dbs3 := dhPubDBs()
	dbs3[dhPubOverworld] = flip(flip(dbs3[dhPubOverworld], dhTestPart+9), 2*dhTestPart+3)
	for i, step := range []struct {
		dbs  map[string][]byte
		time time.Time
	}{{dhPubDBs(), dhPubTime1}, {dbs2, dhPubTime2}} {
		var prev *DHIndex
		if i > 0 {
			prev = &ix[i-1]
		}
		ix[i] = f.stageAt(t, "srv1", "7_alpha", step.dbs, prev, step.time)
		root, err := dhStagingRoot(f.dataDir, "srv1")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := runDHPublish(context.Background(), dhPublishPlan{Store: client, Label: `"R2"`, KeyPrefix: "dh", StageDir: root}); err != nil {
			t.Fatal(err)
		}
	}
	ix[2] = f.stageAt(t, "srv1", "7_alpha", dbs3, &ix[1], dhPubTime3)
	return ix
}

func nodeRecord(t *testing.T, rec models.RunRecord, id string) models.NodeRunRecord {
	t.Helper()
	for _, n := range rec.Nodes {
		if n.NodeID == id {
			return n
		}
	}
	t.Fatalf("no node %s in %+v", id, rec.Nodes)
	return models.NodeRunRecord{}
}

func TestDHPublishBlockPrunesAndReportsWhatItDeleted(t *testing.T) {
	f := dhBlockFixture(t)
	ix := f.twoPublishedOneStaged(t)
	cfg := publishConfig()
	cfg["keep"] = 2.0

	rec := f.run(publishGraph("srv1", cfg, false))
	if rec.Status != "success" {
		t.Fatalf("run = %q %q", rec.Status, rec.Error)
	}
	node := nodeRecord(t, rec, "u1")
	if node.Warning != "" || node.FiredPort != "onComplete" {
		t.Errorf("node = %+v", node)
	}
	raw, err := json.Marshal(rec)
	if err != nil || strings.Contains(string(raw), `"warning"`) {
		t.Errorf("a clean run carries a warning field: %s (%v)", raw, err)
	}
	if event := f.events.text(); strings.Contains(event, `"warning"`) {
		t.Errorf("a clean run's events carry a warning:\n%s", event)
	}
	for _, k := range folderKeys(dhPubCreated1) {
		if _, ok := f.bucket.snapshot()[k]; ok {
			t.Errorf("%s survived", k)
		}
	}
	if _, ok := f.bucket.snapshot()[partKey(ix[0].Levels[0].Parts[1].SHA256)]; ok {
		t.Error("the part only snapshot 1 used survived")
	}

	// The outputs, read through the executor so they are the block's own.
	f2 := dhBlockFixture(t)
	f2.twoPublishedOneStaged(t)
	cfg2 := publishConfig()
	cfg2["keep"] = "2"
	res, out := f2.execPublish("srv1", cfg2)
	if res.Port != "onComplete" || res.Warning != "" {
		t.Fatalf("result = %+v", res)
	}
	if out["snapshotsDeleted"] != 1.0 || out["partsDeleted"] != 1.0 {
		t.Errorf("outputs = %v", out)
	}
	if b, _ := out["bytesFreed"].(float64); b <= 0 {
		t.Errorf("bytesFreed = %v", out["bytesFreed"])
	}
	if !strings.Contains(f2.console("srv1"), "Pruned: 1 snapshot(s) and 1 part(s) deleted") {
		t.Errorf("console:\n%s", f2.console("srv1"))
	}
}

// A prune failure is a warning on the record, the event and the console.
func TestDHPublishBlockPruneFailureIsAWarningEverywhere(t *testing.T) {
	for name, fail := range map[string]func(b *fakeBucket){
		"the listing is refused": func(b *fakeBucket) {
			b.failList = func() (int, string) { return 403, "AccessDenied" }
		},
		"the delete is refused": func(b *fakeBucket) {
			b.failDelete = func([]string) (int, string) { return 403, "AccessDenied" }
		},
	} {
		t.Run(name, func(t *testing.T) {
			f := dhBlockFixture(t)
			f.twoPublishedOneStaged(t)
			f.bucket.mu.Lock()
			fail(f.bucket)
			f.bucket.mu.Unlock()
			cfg := publishConfig()
			cfg["keep"] = 1.0

			var visited []string
			registerTestMarker(f.s.registry, &visited)
			rec := f.run(publishGraph("srv1", cfg, true))
			if rec.Status != "success" || rec.Error != "" {
				t.Fatalf("run = %q %q: a prune that fails must not fail the run", rec.Status, rec.Error)
			}
			if len(visited) != 0 {
				t.Errorf("onFailed branch visited %v", visited)
			}
			node := nodeRecord(t, rec, "u1")
			if node.Status != "success" || node.FiredPort != "onComplete" || node.Error != "" {
				t.Errorf("node = %+v: it must still fire onComplete", node)
			}
			if !strings.HasPrefix(node.Warning, "Prune skipped: ") || !strings.Contains(node.Warning, "AccessDenied") {
				t.Errorf("warning = %q", node.Warning)
			}
			if _, ok := f.bucket.snapshot()["dh/latest.json"]; !ok {
				t.Error("latest.json is gone")
			}
			latest, err := parseDHLatest(f.bucket.object("dh/latest.json"))
			if err != nil || !strings.Contains(latest.Index, dhPubCreated3) {
				t.Errorf("latest = %+v (%v): the snapshot was published", latest, err)
			}

			raw, err := json.Marshal(rec)
			if err != nil || !strings.Contains(string(raw), `"warning":"Prune skipped: `) {
				t.Errorf("record JSON lacks the warning: %s (%v)", raw, err)
			}
			history, err := os.ReadFile(filepath.Join(f.dataDir, "scheduler-history.json"))
			if err != nil {
				t.Fatal(err)
			}
			finished := ""
			for _, line := range strings.Split(f.events.text(), "\n") {
				if strings.HasPrefix(line, EventScheduleNodeFinished+" ") && strings.Contains(line, `"nodeId":"u1"`) {
					finished = line
				}
			}
			if !strings.Contains(finished, `"warning":"Prune skipped: `) || !strings.Contains(finished, `"serverID":"srv1"`) {
				t.Errorf("node-finished event = %q: want the warning and the serverID on it", finished)
			}
			if !strings.Contains(f.console("srv1"), "Prune skipped: ") || !strings.Contains(f.console("srv1"), "Published: ") {
				t.Errorf("console:\n%s", f.console("srv1"))
			}
			for what, text := range map[string]string{
				"record": string(raw), "history": string(history), "events": f.events.text(), "console": f.console("srv1"),
			} {
				if strings.Contains(text, testSecret) {
					t.Errorf("%s carries the secret", what)
				}
			}
			if !strings.Contains(string(history), "Prune skipped") {
				t.Errorf("history lacks the warning:\n%s", history)
			}
		})
	}
}

func TestDHPublishBlockWarningIsScrubbedLikeEveryOtherError(t *testing.T) {
	f := dhBlockFixture(t)
	f.twoPublishedOneStaged(t)
	// The bucket echoes the secret back inside its refusal. The client scrubs its
	// own errors; the block scrubs what it hands the engine as well.
	f.bucket.mu.Lock()
	f.bucket.failList = func() (int, string) { return 403, "AccessDenied" }
	f.bucket.mu.Unlock()
	cfg := publishConfig()
	cfg["keep"] = 1.0
	res, out := f.execPublish("srv1", cfg)
	if res.Port != "onComplete" || res.Err != nil || res.Warning == "" {
		t.Fatalf("result = %+v", res)
	}
	if strings.Contains(res.Warning, testSecret) || !strings.Contains(res.Warning, "redacted") {
		t.Errorf("warning = %q: the echoed secret must be marked, not shown", res.Warning)
	}
	if out["snapshotsDeleted"] != 0.0 || out["partsDeleted"] != 0.0 || out["bytesFreed"] != 0.0 {
		t.Errorf("outputs = %v: the three counts are set even when the prune did not run", out)
	}
	if out["url"] == "" || out["url"] == nil {
		t.Errorf("outputs = %v: the url is the publish's and is kept", out)
	}
}
