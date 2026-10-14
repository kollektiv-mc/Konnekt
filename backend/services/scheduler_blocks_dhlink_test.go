package services

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"konnekt/backend/models"
)

// ─── The private link in the blocks (#561) ─────────────────────────────────
//
// The publish and snapshot blocks place their keys by the destination's token,
// and the token must reach nothing but those keys: not the url output, not the
// console, not an error, a run record, the history, an event or a log line.

// privateBlockFixture is the block fixture with the R2 destination switched to a
// private link before anything is published (a record change only), and the
// token it got.
func privateBlockFixture(t *testing.T) (*uploadFixture, models.Destination, string) {
	t.Helper()
	f := dhBlockFixture(t)
	dest, found, err := f.dests.Lookup("R2")
	if err != nil || !found {
		t.Fatalf("destination: %v %v", found, err)
	}
	if _, err := f.dests.SetSnapshotLinkPrivate(context.Background(), dest.ID, true); err != nil {
		t.Fatal(err)
	}
	tok, err := f.dests.LinkToken(dest.ID)
	if err != nil || tok == "" {
		t.Fatalf("token %q, %v", tok, err)
	}
	return f, dest, tok
}

// stageForToken is stageFor for a destination with a private link: the staged
// index states the private layout's partsBase.
func (f *uploadFixture) stageForToken(t *testing.T, serverID, token string, dbs map[string][]byte) string {
	t.Helper()
	root, err := dhStagingRoot(f.dataDir, serverID)
	if err != nil {
		t.Fatal(err)
	}
	keys, err := snapshotKeys("dh", token, dhPubTime1)
	if err != nil {
		t.Fatal(err)
	}
	src := dhSource(t, dbs)
	src.ServerFolder = "7_alpha"
	ix, _, err := stageDHSnapshot(src, nil, root, keys, dhTestPart)
	if err != nil {
		t.Fatal(err)
	}
	rewriteIndex(t, root, ix)
	return root
}

// In private mode the block lands under the token and redacts its URL.
func TestDHPublishBlockPrivateModeRedactsTheURL(t *testing.T) {
	f, dest, tok := privateBlockFixture(t)
	f.stageForToken(t, "srv1", tok, dhPubDBs())

	cfg := publishConfig()
	cfg["prefix"] = "snap"
	res, out := f.execPublish("srv1", cfg)
	if res.Port != "onComplete" || res.Err != nil || res.Warning != "" {
		t.Fatalf("result = %+v", res)
	}
	objs := f.bucket.snapshot()
	for _, k := range []string{
		"dh/snap/" + tok + "/latest.json",
		"dh/snap/" + tok + "/snapshots/" + dhPubCreated1 + "/index.json",
		"dh/snap/" + tok + "/snapshots/" + dhPubCreated1 + "/index.html",
		"dh/snap/" + tok + "/snapshots/" + dhPubCreated1 + "/" + dhPubOverworld + "/" + dhDatabaseName,
	} {
		if _, ok := objs[k]; !ok {
			t.Errorf("%s is not in the bucket; have %v", k, f.bucket.keys())
		}
	}
	parts := 0
	for k := range objs {
		if strings.HasPrefix(k, "dh/snap/parts/") {
			parts++
		}
		if k == "dh/snap/latest.json" || strings.HasPrefix(k, "dh/snap/snapshots/") {
			t.Errorf("%s: a private publish wrote the public layout", k)
		}
	}
	if parts != 6 {
		t.Errorf("%d parts under dh/snap/parts/, want 6", parts)
	}
	ix, err := parseDHIndex(objs["dh/snap/"+tok+"/snapshots/"+dhPubCreated1+"/index.json"])
	if err != nil || ix.PartsBase != "../../../parts/" {
		t.Errorf("index %+v (%v)", ix, err)
	}

	// The url output and the console carry the marked-out address and no token.
	wantURL := f.bucket.URL + "/snapshots/dh/snap/[redacted]/latest.json"
	if out["url"] != wantURL {
		t.Errorf("url output = %v, want %s", out["url"], wantURL)
	}
	console := f.console("srv1")
	if !strings.Contains(console, "Published: "+wantURL) || !strings.Contains(console, "private link") || !strings.Contains(console, "Settings") {
		t.Errorf("console:\n%s", console)
	}
	for name, text := range map[string]string{"console": console, "events": f.events.text(), "outputs": jsonOf(t, out)} {
		if strings.Contains(text, tok) {
			t.Errorf("%s carries the token:\n%s", name, text)
		}
	}

	// The prefix was recorded, and Copy link hands out the real address.
	rec, err := f.dests.GetSnapshotLink(dest.ID)
	if err != nil {
		t.Fatal(err)
	}
	if want := f.bucket.URL + "/snapshots/dh/snap/" + tok + "/latest.json"; rec.Link != want || !rec.Private {
		t.Errorf("GetSnapshotLink = %+v, want %s", rec, want)
	}
}

func jsonOf(t *testing.T, v any) string {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func TestDHPublishBlockRecordsThePrefixAfterAPublicPublishToo(t *testing.T) {
	f := dhBlockFixture(t)
	f.stageFor(t, "srv1", "7_alpha", dhPubDBs())
	res, out := f.execPublish("srv1", publishConfig())
	if res.Port != "onComplete" || strings.Contains(jsonOf(t, out), "redacted") {
		t.Fatalf("result = %+v, outputs %v: a public publish redacts nothing", res, out)
	}
	dest, _, _ := f.dests.Lookup("R2")
	link, err := f.dests.GetSnapshotLink(dest.ID)
	if err != nil || link.Link != f.bucket.URL+"/snapshots/dh/latest.json" || link.Private {
		t.Errorf("GetSnapshotLink = %+v, %v", link, err)
	}
	if list, _ := f.dests.List(); list[0].PrivateLink {
		t.Error("a public destination lists as private")
	}
}

// A publish whose staged snapshot was made for the other layout is refused with
// the message that already exists for a layout mismatch, and sends nothing.
func TestDHPublishBlockRefusesASnapshotStagedForTheOtherLayout(t *testing.T) {
	f, _, _ := privateBlockFixture(t)
	f.stageFor(t, "srv1", "7_alpha", dhPubDBs()) // staged public
	res, _ := f.execPublish("srv1", publishConfig())
	if res.Port != "onFailed" || res.Err == nil || !strings.Contains(res.Err.Error(), "different layout") {
		t.Fatalf("result = %+v", res)
	}
	if n := len(f.bucket.recorded()); n != 0 {
		t.Errorf("%d requests went out", n)
	}
}

// A failure in private mode hides the token everywhere.
func TestDHPublishBlockPrivateFailureHidesTheToken(t *testing.T) {
	logs := &captureHandler{}
	prev := slog.Default()
	slog.SetDefault(slog.New(logs))
	t.Cleanup(func() { slog.SetDefault(prev) })

	f, _, tok := privateBlockFixture(t)
	f.stageForToken(t, "srv1", tok, dhPubDBs())
	// The bucket takes the parts, then refuses the assembly of a key that carries
	// the token, and its own message echoes both the secret and the key back.
	f.bucket.setFailMultipart(func(op string, n int) (int, string) {
		if op == "copy" && n == 2 {
			return http.StatusForbidden, "SignatureDoesNotMatch"
		}
		return 0, ""
	})
	f.bucket.setFailGet(func(key string) (int, string) { return 0, "" })

	var visited []string
	registerTestMarker(f.s.registry, &visited)
	rec := f.run(publishGraph("srv1", publishConfig(), true))
	if rec.Status != "failed" || len(visited) != 1 {
		t.Fatalf("status %q, visited %v", rec.Status, visited)
	}
	var node models.NodeRunRecord
	for _, n := range rec.Nodes {
		if n.NodeID == "u1" {
			node = n
		}
	}
	if node.FiredPort != "onFailed" || !strings.Contains(node.Error, "SignatureDoesNotMatch") || !strings.Contains(node.Error, "[redacted]") {
		t.Errorf("node record = %+v: the key's token should read [redacted]", node)
	}

	history, err := os.ReadFile(filepath.Join(f.dataDir, "scheduler-history.json"))
	if err != nil {
		t.Fatal(err)
	}
	for name, text := range map[string]string{
		"run record": jsonOf(t, rec), "node record": jsonOf(t, node), "history": string(history),
		"events": f.events.text(), "console": f.console("srv1"), "log": logs.buf.String(),
	} {
		for _, leak := range []string{tok, testSecret} {
			if strings.Contains(text, leak) {
				t.Errorf("%s carries %q:\n%s", name, leak, text)
			}
		}
	}
	if _, ok := f.bucket.snapshot()["dh/"+tok+"/latest.json"]; ok {
		t.Error("latest.json was written by a failed run")
	}
}

func TestDHPublishBlockAndALinkMoveExcludeEachOther(t *testing.T) {
	f := dhBlockFixture(t)
	dest, _, _ := f.dests.Lookup("R2")
	f.stageFor(t, "srv1", "7_alpha", dhPubDBs())

	end, err := f.dests.beginMove(dest.ID)
	if err != nil {
		t.Fatal(err)
	}
	res, _ := f.execPublish("srv1", publishConfig())
	if res.Port != "onFailed" || res.Err == nil || !strings.Contains(res.Err.Error(), "being changed") {
		t.Fatalf("result = %+v: a publish must wait out a link change", res)
	}
	if n := len(f.bucket.recorded()); n != 0 {
		t.Errorf("%d requests went out", n)
	}
	end()

	if res, _ = f.execPublish("srv1", publishConfig()); res.Port != "onComplete" {
		t.Fatalf("result = %+v", res)
	}
	// The hold is released when the block finishes, success or not.
	if _, err := f.dests.SetSnapshotLinkPrivate(context.Background(), dest.ID, true); err != nil {
		t.Errorf("a move after a finished publish: %v", err)
	}
}

func TestDHSnapshotPlanTakesTheTokenAndScrubsIt(t *testing.T) {
	f, _, tok := privateBlockFixture(t)
	cfg := dhBlockConfig()
	cfg["destination"] = "R2"
	plan, scrub, err := dhPlanFor(&ExecContext{Ctx: context.Background(), ServerID: "srv1", Config: cfg, svc: f.s.deps})
	if err != nil {
		t.Fatal(err)
	}
	if plan.Token != tok {
		t.Errorf("plan token = %q, want the destination's", plan.Token)
	}
	if got := scrub("read dh/" + tok + "/latest.json " + testSecret); strings.Contains(got, tok) || strings.Contains(got, testSecret) || !strings.Contains(got, "dh/[redacted]/latest.json") {
		t.Errorf("scrub = %q", got)
	}

	// A public destination plans no token.
	dest, _, _ := f.dests.Lookup("R2")
	if _, err := f.dests.SetSnapshotLinkPrivate(context.Background(), dest.ID, false); err != nil {
		t.Fatal(err)
	}
	plan, _, err = dhPlanFor(&ExecContext{Ctx: context.Background(), ServerID: "srv1", Config: cfg, svc: f.s.deps})
	if err != nil || plan.Token != "" {
		t.Errorf("public plan token %q, %v", plan.Token, err)
	}
}

// A run in private mode finds the previous index under the token.
func TestDHSnapshotPrivateRunFindsPreviousIndexUnderToken(t *testing.T) {
	f := newDHRunFixture(t)
	if _, err := f.run(); err != nil {
		t.Fatal(err)
	}
	staged, err := os.ReadFile(filepath.Join(f.stageDir, dhIndexFile))
	if err != nil {
		t.Fatal(err)
	}
	first := f.stagedIndex()
	if first.PartsBase != "../../parts/" {
		t.Fatalf("an unbucketed run staged partsBase %q", first.PartsBase)
	}

	// The previous snapshot sits under the token; a stale copy sits at the public
	// layout, which a private run must not read.
	f.flipPart(4)
	f.log = nil
	f.narration = nil
	reader := latestPointing(t, "dh/"+testLinkToken, staged)
	f.plan.Bucket, f.plan.BucketLabel, f.plan.KeyPrefix, f.plan.Token = reader, `"R2"`, "dh", testLinkToken
	res, err := f.run()
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(reader.keys, " "); got != "dh/"+testLinkToken+"/latest.json dh/"+testLinkToken+"/snapshots/20261011T040000Z/index.json" {
		t.Errorf("read %v, want the pointer and index under the token", reader.keys)
	}
	if res.PartsChanged != 1 || res.PartsTotal != 6 {
		t.Errorf("result = %+v: the previous index was not found, so more was staged than changed", res)
	}
	if ix := f.stagedIndex(); ix.PartsBase != "../../../parts/" {
		t.Errorf("staged partsBase = %q, want the private layout's", ix.PartsBase)
	}
	if strings.Contains(strings.Join(f.narration, "\n"), testLinkToken) {
		t.Errorf("narration carries the token:\n%s", strings.Join(f.narration, "\n"))
	}

	// With no latest.json yet, the "first snapshot" line names the key, token marked out.
	g := newDHRunFixture(t)
	g.plan.Bucket, g.plan.BucketLabel, g.plan.KeyPrefix, g.plan.Token = &fakeIndexReader{}, `"R2"`, "dh", testLinkToken
	if _, err := g.run(); err != nil {
		t.Fatal(err)
	}
	said := strings.Join(g.narration, "\n")
	if strings.Contains(said, testLinkToken) || !strings.Contains(said, "No dh/[redacted]/latest.json") {
		t.Errorf("narration:\n%s", said)
	}
}

// A run in private mode writes under the token and marks it out of what it says.
func TestDHPublishPrivateRunWritesUnderTokenAndRedactsIt(t *testing.T) {
	f := newDHPublishFixture(t)
	f.plan.Token = testLinkToken
	keys, err := snapshotKeys("dh", testLinkToken, dhPubTime1)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	ix, _, err := stageDHSnapshot(dhSource(t, dhPubDBs()), nil, dir, keys, dhTestPart)
	if err != nil {
		t.Fatal(err)
	}
	rewriteIndex(t, dir, ix)

	res, err := f.publish(dir)
	if err != nil {
		t.Fatal(err)
	}
	if want := strings.Replace(f.client.ObjectURL("dh/"+testLinkToken+"/latest.json"), testLinkToken, "[redacted]", 1); res.URL != want {
		t.Errorf("url = %q, want %q", res.URL, want)
	}
	if strings.Contains(f.narrated(), testLinkToken) || !strings.Contains(f.narrated(), "Writing dh/[redacted]/latest.json, the last object") {
		t.Errorf("narration:\n%s", f.narrated())
	}
	if _, ok := f.bucket.snapshot()["dh/"+testLinkToken+"/latest.json"]; !ok {
		t.Errorf("objects: %v", f.bucket.keys())
	}
	// The same staged snapshot is refused by a public run, and the other way round.
	f.plan.Token = ""
	if _, err := f.publish(dir); err == nil || !strings.Contains(err.Error(), "different layout") {
		t.Errorf("a public run published a private staging: %v", err)
	}
}
