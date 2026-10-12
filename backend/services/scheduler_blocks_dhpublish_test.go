package services

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"konnekt/backend/models"
)

// ─── action.dhPublish (#565, #562) ─────────────────────────────────────────
//
// The sequence is dhsnapshot_publish_test.go. These tests are the block: its
// definition, its config, the services it reaches through an ExecContext, the
// claim it shares with the snapshot block, and what the engine does with it.

func (f *uploadFixture) execPublish(serverID string, cfg map[string]interface{}) (ExecResult, map[string]interface{}) {
	out := map[string]interface{}{}
	res := execDHPublish(&ExecContext{
		Ctx: context.Background(), ServerID: serverID, Config: cfg,
		svc: f.s.deps, dataOut: out,
	})
	return res, out
}

// stageFor stages dbs as a snapshot in serverID's default staging folder, with
// the server folder the index will state, and returns the folder.
func (f *uploadFixture) stageFor(t *testing.T, serverID, serverFolder string, dbs map[string][]byte) string {
	t.Helper()
	root, err := dhStagingRoot(f.dataDir, serverID)
	if err != nil {
		t.Fatal(err)
	}
	keys, err := snapshotKeys("dh", "", dhPubTime1)
	if err != nil {
		t.Fatal(err)
	}
	src := dhSource(t, dbs)
	src.ServerFolder = serverFolder
	ix, _, err := stageDHSnapshot(src, nil, root, keys, dhTestPart)
	if err != nil {
		t.Fatal(err)
	}
	rewriteIndex(t, root, ix)
	return root
}

func publishConfig() map[string]interface{} {
	return map[string]interface{}{"destination": "R2"}
}

func publishGraph(serverID string, cfg map[string]interface{}, failMarker bool) models.Graph {
	g := uploadGraph(serverID, cfg, failMarker)
	g.Nodes[1].Type = dhPublishBlockID
	return g
}

func TestDHPublishBlockDefinition(t *testing.T) {
	def := commandBlock(t, dhPublishBlockID)
	if def.ID != "action.dhPublish" || def.Category != "action" || def.Label != "Publish DH Snapshot" {
		t.Errorf("id %q, category %q, label %q", def.ID, def.Category, def.Label)
	}
	if len(def.Effects) != 0 {
		t.Errorf("effects = %v: the server is up throughout a publish", def.Effects)
	}
	if def.TimeoutSeconds != 12*60*60 || blockTimeout(def) != 12*time.Hour {
		t.Errorf("timeout = %d s / %v, want 12 hours", def.TimeoutSeconds, blockTimeout(def))
	}
	if got := strings.Join(def.ControlInputs, ","); got != "trigger" {
		t.Errorf("control inputs = %s", got)
	}
	if got := strings.Join(def.ControlOutputs, ","); got != "onComplete,onFailed" {
		t.Errorf("control outputs = %s", got)
	}
	var ins, outs []string
	for _, p := range def.DataInputs {
		ins = append(ins, p.ID+":"+p.Type)
	}
	for _, p := range def.DataOutputs {
		outs = append(outs, p.ID+":"+p.Type)
	}
	if got := strings.Join(ins, ","); got != "folder:string" {
		t.Errorf("data inputs = %s", got)
	}
	if got := strings.Join(outs, ","); got != "url:string,partsUploaded:number,partsSkipped:number,bytesSent:number,levelsAssembled:number,snapshotsDeleted:number,partsDeleted:number,bytesFreed:number" {
		t.Errorf("data outputs = %s", got)
	}
	fields := map[string]models.ConfigField{}
	var keys []string
	for _, f := range def.ConfigSchema {
		fields[f.Key] = f
		keys = append(keys, f.Key)
	}
	if got := strings.Join(keys, ","); got != "destination,prefix,folder,keep" {
		t.Errorf("config keys = %s", got)
	}
	if f := fields["destination"]; f.Type != destinationFieldType || !f.Required {
		t.Errorf("destination = %+v, want a required destination field", f)
	}
	for _, k := range []string{"prefix", "folder"} {
		if f := fields[k]; f.Type != "string" || f.Required {
			t.Errorf("%s = %+v, want an optional string", k, f)
		}
	}
	// Retention is a number that starts at 3. The private link belongs to a later change.
	if f := fields["keep"]; f.Type != "number" || f.Required || f.Default != dhDefaultKeep || dhDefaultKeep != 3 {
		t.Errorf("keep = %+v, want an optional number defaulting to 3", f)
	}
	if _, ok := fields["token"]; ok {
		t.Error("the block has a \"token\" field already")
	}
	// Every data input is a config key too: the overlay model needs it.
	for _, p := range def.DataInputs {
		if _, ok := fields[p.ID]; !ok {
			t.Errorf("data input %q has no config key of the same name", p.ID)
		}
	}
}

func TestDHPublishBlockIsRegisteredAndWearsNoBadge(t *testing.T) {
	reg := NewBlockRegistry()
	registerBuiltins(reg)
	entry, ok := reg.Get(dhPublishBlockID)
	if !ok {
		t.Fatal("action.dhPublish is not registered")
	}
	if got := nodeEffects(entry.def, models.Node{ID: "n", Type: dhPublishBlockID}, nil); len(got) != 0 {
		t.Errorf("nodeEffects = %v", got)
	}
}

func TestDHPublishTimeoutMakesRoomInTheRunCap(t *testing.T) {
	shrinkTimeouts(t, 60*time.Second, 30*time.Minute)
	s := newTestScheduler(t)
	if got := s.runDuration(slowGraph(dhPublishBlockID)); got != 12*time.Hour {
		t.Errorf("runDuration = %v, want 12h", got)
	}
}

// --- the folder ---

func TestDHPublishFolder(t *testing.T) {
	data, work, other := t.TempDir(), t.TempDir(), t.TempDir()
	own := filepath.Join(data, "dh-snapshots", "srv1")
	theirs := filepath.Join(data, "dh-snapshots", "srv2")
	for _, d := range []string{own, theirs, filepath.Join(own, "sub"), filepath.Join(work, "world"), filepath.Join(other, "snaps")} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	e := func(folder string) *ExecContext {
		return &ExecContext{ServerID: "srv1", Config: map[string]interface{}{"folder": folder}, svc: serviceDeps{dataDir: data}}
	}

	good := []struct{ name, folder, want string }{
		{"empty is this server's staging folder", "", own},
		{"blank is too", "   ", own},
		{"this server's folder named outright", own, own},
		{"a folder inside it", filepath.Join(own, "sub"), filepath.Join(own, "sub")},
		{"a folder elsewhere", filepath.Join(other, "snaps"), filepath.Join(other, "snaps")},
	}
	for _, tc := range good {
		t.Run(tc.name, func(t *testing.T) {
			got, err := dhPublishFolder(e(tc.folder), work)
			// The default is handed back as built, since it may not exist yet; a
			// named folder comes back resolved, which on Windows also expands a
			// short name such as RUNNER~1.
			want := tc.want
			if strings.TrimSpace(tc.folder) != "" {
				if resolved, rerr := filepath.EvalSymlinks(tc.want); rerr == nil {
					want = resolved
				}
			}
			if err != nil || got != want {
				t.Errorf("got (%q, %v), want %q", got, err, want)
			}
		})
	}

	refused := []struct{ name, folder, want string }{
		{"a relative path", "snaps", "absolute"},
		{"one that does not exist", filepath.Join(other, "nope"), "cannot be read"},
		{"the server's folder", work, "inside the server's folder"},
		{"a folder inside it", filepath.Join(work, "world"), "inside the server's folder"},
		{"another server's staging folder", theirs, "belongs to another server"},
		{"all the staging folders at once", filepath.Join(data, "dh-snapshots"), "belongs to another server"},
		{"another server's by a path that climbs", filepath.Join(own, "..", "srv2"), "belongs to another server"},
	}
	for _, tc := range refused {
		t.Run("refuses "+tc.name, func(t *testing.T) {
			_, err := dhPublishFolder(e(tc.folder), work)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("err = %v, want it to contain %q", err, tc.want)
			}
		})
	}
	t.Run("a link into another server's folder is that folder", func(t *testing.T) {
		link := filepath.Join(other, "link")
		if err := os.Symlink(theirs, link); err != nil {
			t.Skipf("symlinks unavailable here: %v", err)
		}
		if _, err := dhPublishFolder(e(link), work); err == nil || !strings.Contains(err.Error(), "another server") {
			t.Errorf("err = %v", err)
		}
	})
	t.Run("a link into the server's folder is inside it", func(t *testing.T) {
		link := filepath.Join(other, "worldlink")
		if err := os.Symlink(filepath.Join(work, "world"), link); err != nil {
			t.Skipf("symlinks unavailable here: %v", err)
		}
		if _, err := dhPublishFolder(e(link), work); err == nil || !strings.Contains(err.Error(), "inside the server's folder") {
			t.Errorf("err = %v", err)
		}
	})
	t.Run("a server id that is not one segment", func(t *testing.T) {
		bad := &ExecContext{ServerID: "../x", Config: map[string]interface{}{}, svc: serviceDeps{dataDir: data}}
		if _, err := dhPublishFolder(bad, work); err == nil {
			t.Error("accepted ../x")
		}
	})
	t.Run("no data directory", func(t *testing.T) {
		if _, err := dhPublishFolder(&ExecContext{ServerID: "srv1", Config: map[string]interface{}{}}, work); err == nil {
			t.Error("accepted an unknown data directory")
		}
	})
}

// --- running the block ---

func TestDHPublishBlockPublishesTheRunsServersStagedFolder(t *testing.T) {
	f := dhBlockFixture(t)
	f.stageFor(t, "srv1", "7_alpha", dhPubDBs())
	f.stageFor(t, "srv2", "9_beta", map[string][]byte{dhPubOverworld: dhBytes(2*dhTestPart, 9)})

	cfg := publishConfig()
	cfg["prefix"] = "/snap/"
	res, out := f.execPublish("srv1", cfg)
	if res.Port != "onComplete" || res.Err != nil {
		t.Fatalf("result = %+v", res)
	}
	wantURL := f.bucket.URL + "/snapshots/dh/snap/latest.json"
	want := map[string]interface{}{
		"url": wantURL, "partsUploaded": 6.0, "partsSkipped": 0.0, "levelsAssembled": 2.0,
		"bytesSent": float64(3*dhTestPart + 100 + 2*dhTestPart),
	}
	for k, v := range want {
		if out[k] != v {
			t.Errorf("output %s = %v, want %v", k, out[k], v)
		}
	}
	// The destination's prefix, then the node's, then the snapshot's layout.
	if _, ok := f.bucket.snapshot()["dh/snap/latest.json"]; !ok {
		t.Errorf("objects = %v", f.bucket.keys())
	}
	index, err := parseDHIndex(f.bucket.object("dh/snap/snapshots/" + dhPubCreated1 + "/index.json"))
	if err != nil || index.ServerFolder != "7_alpha" {
		t.Errorf("published index = %+v (%v): srv1 must publish srv1's folder, not srv2's", index, err)
	}
	for _, k := range f.bucket.keys() {
		if strings.Contains(k, "9_beta") {
			t.Errorf("srv2's snapshot reached the bucket: %s", k)
		}
	}
	console := f.console("srv1")
	for _, w := range []string{"Uploading 6 part(s)", `to "R2"`, "Assembling " + dhPubOverworld, "Published: " + wantURL} {
		if !strings.Contains(console, w) {
			t.Errorf("console lacks %q:\n%s", w, console)
		}
	}
	if strings.Contains(f.console("srv2"), "Uploading") {
		t.Error("srv2's console heard about srv1's publish")
	}
}

func TestDHPublishBlockUsesThePublicBaseURLOfTheDestination(t *testing.T) {
	f := dhBlockFixture(t)
	f.stageFor(t, "srv1", "7_alpha", dhPubDBs())
	if _, err := f.dests.Save(models.Destination{
		Name: "CDN", Endpoint: f.bucket.URL, Region: "auto", Bucket: "snapshots", Prefix: "dh",
		PublicBaseURL: "https://dl.example.com", AccessKeyID: "AKIATESTKEY",
	}, testSecret); err != nil {
		t.Fatal(err)
	}
	res, out := f.execPublish("srv1", map[string]interface{}{"destination": "CDN"})
	if res.Port != "onComplete" || out["url"] != "https://dl.example.com/dh/latest.json" {
		t.Errorf("result %+v, url %v", res, out["url"])
	}
}

func TestDHPublishBlockRefusesAnotherServersStagingFolder(t *testing.T) {
	f := dhBlockFixture(t)
	theirs := f.stageFor(t, "srv2", "9_beta", dhPubDBs())

	cfg := publishConfig()
	cfg["folder"] = theirs
	res, _ := f.execPublish("srv1", cfg)
	if res.Port != "onFailed" || res.Err == nil || !strings.Contains(res.Err.Error(), "another server") {
		t.Fatalf("result = %+v", res)
	}
	if n := len(f.bucket.recorded()); n != 0 {
		t.Errorf("%d requests went out", n)
	}
	// The same folder is fine for the server it belongs to.
	if res, _ = f.execPublish("srv2", cfg); res.Port != "onComplete" {
		t.Errorf("srv2 publishing its own folder: %+v", res)
	}
}

func TestDHPublishBlockWithNothingStagedSaysToRunTheSnapshotFirst(t *testing.T) {
	f := dhBlockFixture(t)
	res, _ := f.execPublish("srv1", publishConfig())
	if res.Port != "onFailed" || res.Err == nil || !strings.Contains(res.Err.Error(), "run a Distant Horizons snapshot first") {
		t.Fatalf("result = %+v", res)
	}
	if !strings.Contains(f.console("srv1"), "Publish failed:") {
		t.Errorf("console does not say it failed:\n%s", f.console("srv1"))
	}
}

func TestDHPublishBlockRefusals(t *testing.T) {
	f := dhBlockFixture(t)
	f.stageFor(t, "srv1", "7_alpha", dhPubDBs())
	noDests := f.s.deps
	noDests.destinations = nil
	for name, tc := range map[string]struct {
		cfg  map[string]interface{}
		deps serviceDeps
		srv  string
		want string
	}{
		"no destination":       {map[string]interface{}{}, f.s.deps, "srv1", "no destination chosen"},
		"a blank destination":  {map[string]interface{}{"destination": "  "}, f.s.deps, "srv1", "no destination chosen"},
		"a deleted one":        {map[string]interface{}{"destination": "Gone"}, f.s.deps, "srv1", `"Gone" no longer exists`},
		"a climbing prefix":    {map[string]interface{}{"destination": "R2", "prefix": "../x"}, f.s.deps, "srv1", "must not contain"},
		"a relative folder":    {map[string]interface{}{"destination": "R2", "folder": "stage"}, f.s.deps, "srv1", "absolute"},
		"no destination svc":   {publishConfig(), noDests, "srv1", "not available"},
		"no services at all":   {publishConfig(), serviceDeps{}, "srv1", "not available"},
		"a server with no cfg": {publishConfig(), f.s.deps, "ghost", ""},
	} {
		t.Run(name, func(t *testing.T) {
			out := map[string]interface{}{}
			res := execDHPublish(&ExecContext{Ctx: context.Background(), ServerID: tc.srv, Config: tc.cfg, svc: tc.deps, dataOut: out})
			if res.Port != "onFailed" || res.Err == nil || !strings.Contains(res.Err.Error(), tc.want) {
				t.Errorf("result = %+v, want onFailed containing %q", res, tc.want)
			}
			if len(out) != 0 {
				t.Errorf("outputs = %v on a refusal", out)
			}
			if !dhClaim(tc.srv) {
				t.Error("the claim was not released")
			}
			dhRelease(tc.srv)
		})
	}
	if n := len(f.bucket.recorded()); n != 0 {
		t.Errorf("%d requests went out for refused runs", n)
	}
}

func TestDHPublishBlockFailureEndsOnFailedAndTheSecretIsNowhere(t *testing.T) {
	logs := &captureHandler{}
	prev := slog.Default()
	slog.SetDefault(slog.New(logs))
	t.Cleanup(func() { slog.SetDefault(prev) })

	f := dhBlockFixture(t)
	f.stageFor(t, "srv1", "7_alpha", dhPubDBs())
	// The bucket takes the parts and then refuses the assembly with a message
	// that echoes the secret back.
	f.bucket.setFailMultipart(func(op string, n int) (int, string) {
		if op == "copy" && n == 2 {
			return http.StatusForbidden, "SignatureDoesNotMatch"
		}
		return 0, ""
	})

	var visited []string
	registerTestMarker(f.s.registry, &visited)
	rec := f.run(publishGraph("srv1", publishConfig(), true))
	if rec.Status != "failed" {
		t.Fatalf("status = %q", rec.Status)
	}
	if len(visited) != 1 || visited[0] != "failed" {
		t.Errorf("onFailed branch visited %v", visited)
	}
	var node models.NodeRunRecord
	for _, n := range rec.Nodes {
		if n.NodeID == "u1" {
			node = n
		}
	}
	if node.FiredPort != "onFailed" || !strings.Contains(node.Error, "SignatureDoesNotMatch") {
		t.Errorf("node record = %+v", node)
	}
	if f.bucket.openUploads() != 0 {
		t.Error("an upload was left open")
	}
	if _, ok := f.bucket.snapshot()["dh/latest.json"]; ok {
		t.Error("latest.json was written by a failed run")
	}

	raw, err := json.Marshal(rec)
	if err != nil {
		t.Fatal(err)
	}
	history, err := os.ReadFile(filepath.Join(f.dataDir, "scheduler-history.json"))
	if err != nil {
		t.Fatal(err)
	}
	for name, text := range map[string]string{
		"run record": string(raw), "history": string(history), "events": f.events.text(),
		"console": f.console("srv1"), "log": logs.buf.String(),
	} {
		if strings.Contains(text, testSecret) {
			t.Errorf("%s carries the secret:\n%s", name, text)
		}
	}
	if !strings.Contains(string(raw), "redacted") {
		t.Errorf("the echoed secret was dropped rather than marked: %s", raw)
	}
	if !strings.Contains(f.console("srv1"), "Publish failed:") {
		t.Errorf("console:\n%s", f.console("srv1"))
	}
}

func TestDHPublishBlockThroughTheEngineTakesTheWiredFolder(t *testing.T) {
	f := dhBlockFixture(t)
	// Not the default folder: only a wired value can have found this one.
	staged := f.stageFor(t, "srv1", "7_alpha", dhPubDBs())
	moved := filepath.Join(t.TempDir(), "moved")
	if err := os.Rename(staged, moved); err != nil {
		t.Fatal(err)
	}
	must(f.s.registry.RegisterBlock(models.BlockDef{
		ID: "test.folder", Category: "action",
		ControlInputs: []string{"trigger"}, ControlOutputs: []string{"onComplete"},
		DataOutputs: []models.DataPort{{ID: "folder", Label: "Folder", Type: "string"}},
	}, func(e *ExecContext) ExecResult {
		e.SetOutput("folder", moved)
		return ExecResult{Port: "onComplete"}
	}))
	g := publishGraph("srv1", publishConfig(), false)
	g.Nodes = append(g.Nodes, models.Node{ID: "s1", Type: "test.folder"})
	g.Edges = []models.Edge{
		{ID: "e0", Kind: "control", Source: "t1", SourcePort: "onComplete", Target: "s1", TargetPort: "trigger"},
		{ID: "e1", Kind: "control", Source: "s1", SourcePort: "onComplete", Target: "u1", TargetPort: "trigger"},
		{ID: "d1", Kind: "data", Source: "s1", SourcePort: "folder", Target: "u1", TargetPort: "folder"},
	}
	rec := f.run(g)
	if rec.Status != "success" {
		t.Fatalf("run = %q %q", rec.Status, rec.Error)
	}
	if _, ok := f.bucket.snapshot()["dh/latest.json"]; !ok {
		t.Errorf("objects = %v", f.bucket.keys())
	}
}

func TestDHPublishValidationNeedsADestination(t *testing.T) {
	f := newUploadFixture(t)
	if issues := validateGraphDestinations(publishGraph("srv1", map[string]interface{}{}, false), f.s.registry, f.dests); len(issues) != 1 || !strings.Contains(issues[0], "no destination chosen") {
		t.Errorf("none: issues = %q", issues)
	}
	if issues := validateGraphDestinations(publishGraph("srv1", publishConfig(), false), f.s.registry, f.dests); len(issues) != 0 {
		t.Errorf("a saved destination: issues = %q", issues)
	}
	if issues := validateGraphDestinations(publishGraph("srv1", map[string]interface{}{"destination": "gone"}, false), f.s.registry, f.dests); len(issues) != 1 || !strings.Contains(issues[0], `"gone" does not exist`) {
		t.Errorf("a missing one: issues = %q", issues)
	}
}

// --- the claim ---

func TestDHClaimIsPerServerAndReleased(t *testing.T) {
	if !dhClaim("a") {
		t.Fatal("a free claim was refused")
	}
	if dhClaim("a") {
		t.Error("a held claim was given twice")
	}
	if !dhClaim("b") {
		t.Error("another server's claim was refused: servers share nothing")
	}
	dhRelease("a")
	if !dhClaim("a") {
		t.Error("a released claim was refused")
	}
	dhRelease("a")
	dhRelease("b")
	dhRelease("never-held") // releasing nothing is not an error
}

func TestDHClaimIsSafeUnderConcurrency(t *testing.T) {
	const workers = 32
	var wg sync.WaitGroup
	var mu sync.Mutex
	granted := 0
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if dhClaim("race") {
				mu.Lock()
				granted++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	dhRelease("race")
	if granted != 1 {
		t.Errorf("%d goroutines got the claim, want exactly one", granted)
	}
}

func TestDHPublishAndSnapshotRefuseEachOtherWhileTheClaimIsHeld(t *testing.T) {
	f := dhBlockFixture(t)
	f.stageFor(t, "srv1", "7_alpha", dhPubDBs())

	if !dhClaim("srv1") {
		t.Fatal("could not take the claim")
	}
	pub, _ := f.execPublish("srv1", publishConfig())
	snap, snapOut := f.execDH("srv1", dhBlockConfig())
	dhRelease("srv1")
	for name, res := range map[string]ExecResult{"publish": pub, "snapshot": snap} {
		if res.Port != "onFailed" || res.Err == nil || !strings.Contains(res.Err.Error(), "already running for this server") {
			t.Errorf("%s while the claim is held: %+v", name, res)
		}
	}
	if n := len(f.bucket.recorded()); len(snapOut) != 0 || n != 0 {
		t.Errorf("a refused run did something: outputs %v, %d requests", snapOut, n)
	}
	// Another server's claim is its own.
	if !dhClaim("srv2") {
		t.Error("srv1's claim blocked srv2")
	}
	dhRelease("srv2")

	// Released: both run again.
	if res, _ := f.execPublish("srv1", publishConfig()); res.Port != "onComplete" {
		t.Errorf("publish after the release: %+v", res)
	}
}

func TestDHClaimIsReleasedOnEveryExit(t *testing.T) {
	f := dhBlockFixture(t)
	f.stageFor(t, "srv1", "7_alpha", dhPubDBs())
	attempts := []struct {
		name string
		run  func() ExecResult
	}{
		{"a publish that succeeds", func() ExecResult { r, _ := f.execPublish("srv1", publishConfig()); return r }},
		{"a publish refused for its config", func() ExecResult { r, _ := f.execPublish("srv1", map[string]interface{}{}); return r }},
		{"a publish that fails in the bucket", func() ExecResult {
			f.bucket.setFailGet(func(string) (int, string) { return http.StatusForbidden, "AccessDenied" })
			defer f.bucket.setFailGet(nil)
			r, _ := f.execPublish("srv1", publishConfig())
			return r
		}},
		{"a snapshot refused because the server is not running", func() ExecResult { r, _ := f.execDH("srv1", dhBlockConfig()); return r }},
	}
	for _, a := range attempts {
		a.run()
		if !dhClaim("srv1") {
			t.Fatalf("%s left the claim held", a.name)
		}
		dhRelease("srv1")
	}
}

// A publish that is running holds the claim, so the snapshot block cannot start
// staging into the folder it is reading.
func TestDHSnapshotCannotStartWhileAPublishIsRunning(t *testing.T) {
	f := dhBlockFixture(t)
	f.stageFor(t, "srv1", "7_alpha", dhPubDBs())
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	f.bucket.setFailGet(func(string) (int, string) {
		once.Do(func() { close(entered) })
		<-release
		return 0, ""
	})

	done := make(chan ExecResult, 1)
	go func() {
		res, _ := f.execPublish("srv1", publishConfig())
		done <- res
	}()
	<-entered

	snap, _ := f.execDH("srv1", dhBlockConfig())
	if snap.Port != "onFailed" || snap.Err == nil || !strings.Contains(snap.Err.Error(), "already running for this server") {
		t.Errorf("the snapshot while a publish runs: %+v", snap)
	}
	pub2, _ := f.execPublish("srv1", publishConfig())
	if pub2.Port != "onFailed" || pub2.Err == nil || !strings.Contains(pub2.Err.Error(), "already running for this server") {
		t.Errorf("a second publish: %+v", pub2)
	}
	close(release)
	select {
	case res := <-done:
		if res.Port != "onComplete" {
			t.Errorf("the publish that held the claim: %+v", res)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the publish never finished")
	}
	if !dhClaim("srv1") {
		t.Error("the claim was not released when the publish ended")
	}
	dhRelease("srv1")
}

func TestDHPublishUploadsThePageWithTheHTMLContentType(t *testing.T) {
	f := dhBlockFixture(t)
	f.stageFor(t, "srv1", "7_alpha", dhPubDBs())
	if res, _ := f.execPublish("srv1", publishConfig()); res.Port != "onComplete" {
		t.Fatalf("result = %+v", res)
	}
	page := "dh/snapshots/" + dhPubCreated1 + "/index.html"
	if got := f.bucket.contentType(page); got != "text/html; charset=utf-8" {
		t.Errorf("page content type = %q", got)
	}
	body := f.bucket.object(page)
	if !bytes.Contains(body, []byte("7_alpha")) || !bytes.Contains(body, []byte(dhPubOverworld+"/DistantHorizons.sqlite")) {
		t.Errorf("page:\n%s", body)
	}
}
