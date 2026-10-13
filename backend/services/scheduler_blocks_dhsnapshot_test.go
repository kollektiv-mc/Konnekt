package services

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"konnekt/backend/models"
)

// ─── action.dhSnapshot (#481) ──────────────────────────────────────────────
//
// The sequence itself is dhsnapshot_run_test.go. These tests are the block: its
// definition, its config, the services it reaches through an ExecContext, and
// what the engine does with the downtime it hands back.

// dhBlockFixture is the upload fixture (two servers, one bucket, real services)
// with a Distant Horizons install laid out in each server's folder.
func dhBlockFixture(t *testing.T) *uploadFixture {
	t.Helper()
	f := newUploadFixture(t)
	f.s.deps.dataDir = f.dataDir
	for dir, cfg := range map[string]string{
		f.workA: "serverId = 7\nserverKey = \"alpha\"\nlevelKeyPrefix = \"pa\"\n",
		f.workB: "serverId = 9\nserverKey = \"beta\"\nlevelKeyPrefix = \"pb\"\n",
	} {
		dhWrite(t, dir, "config/DistantHorizons.toml", []byte(cfg))
		writeJar(t, filepath.Join(dir, "mods", "DistantHorizons-3.3.3-b.jar"), dhFabricJar)
		dhWrite(t, filepath.Join(dir, "world"), "data/DistantHorizons.sqlite", dhRunDB(3*dhTestPart, byte(len(cfg))))
	}
	return f
}

func dhBlockConfig() map[string]interface{} {
	return map[string]interface{}{"leadSeconds": float64(0)}
}

// execDH runs the block's executor for one server with a context of the test's
// choosing.
func (f *uploadFixture) execDH(serverID string, cfg map[string]interface{}) (ExecResult, map[string]interface{}) {
	out := map[string]interface{}{}
	res := execDHSnapshot(&ExecContext{
		Ctx: context.Background(), ServerID: serverID, Config: cfg,
		svc: f.s.deps, dataOut: out,
	})
	return res, out
}

func TestDHSnapshotBlockDefinition(t *testing.T) {
	def := commandBlock(t, dhSnapshotBlockID)
	if def.ID != "action.dhSnapshot" || def.Category != "action" || def.Label != "Distant Horizons Snapshot" {
		t.Errorf("id %q, category %q, label %q", def.ID, def.Category, def.Label)
	}
	if got := strings.Join(def.Effects, ","); got != "stopsServer" {
		t.Errorf("effects = %q: the block stops the server on its face", got)
	}
	if def.TimeoutSeconds != 3*60*60 || blockTimeout(def) != 3*time.Hour {
		t.Errorf("timeout = %d s / %v, want 3 hours", def.TimeoutSeconds, blockTimeout(def))
	}
	if got := strings.Join(def.ControlInputs, ","); got != "trigger" {
		t.Errorf("control inputs = %s", got)
	}
	if got := strings.Join(def.ControlOutputs, ","); got != "onComplete,onFailed" {
		t.Errorf("control outputs = %s", got)
	}
	var outs []string
	for _, p := range def.DataOutputs {
		outs = append(outs, p.ID+":"+p.Type)
	}
	if got := strings.Join(outs, ","); got != "folder:string,bytesChanged:number,partsChanged:number,partsTotal:number,downtime:number" {
		t.Errorf("data outputs = %s", got)
	}
	fields := map[string]models.ConfigField{}
	var keys []string
	for _, f := range def.ConfigSchema {
		fields[f.Key] = f
		keys = append(keys, f.Key)
	}
	if got := strings.Join(keys, ","); got != "destination,prefix,output,leadSeconds,message" {
		t.Errorf("config keys = %s", got)
	}
	if f := fields["destination"]; f.Type != destinationFieldType || f.Required {
		t.Errorf("destination = %+v, want an optional destination field", f)
	}
	if f := fields["leadSeconds"]; f.Type != "number" || f.Default != 300 {
		t.Errorf("leadSeconds = %+v, want a number defaulting to 300", f)
	}
	if f := fields["message"]; f.Type != "string" || f.Default != dhDefaultMessage || !strings.Contains(dhDefaultMessage, "{time}") {
		t.Errorf("message = %+v", f)
	}
	for _, k := range []string{"prefix", "output"} {
		if f := fields[k]; f.Type != "string" || f.Required {
			t.Errorf("%s = %+v", k, f)
		}
	}
	// The stop grace is the app's, not a field of the block's.
	if _, ok := fields["grace"]; ok {
		t.Error("the block has a grace field of its own")
	}
}

func TestDHSnapshotBlockIsInTheRegistryAndWearsTheBadge(t *testing.T) {
	reg := NewBlockRegistry()
	registerBuiltins(reg)
	entry, ok := reg.Get(dhSnapshotBlockID)
	if !ok {
		t.Fatal("action.dhSnapshot is not registered")
	}
	node := models.Node{ID: "n", Type: dhSnapshotBlockID}
	if got := nodeEffects(entry.def, node, nil); len(got) != 1 || got[0] != EffectStopsServer {
		t.Errorf("nodeEffects = %v", got)
	}
}

func TestDHSnapshotTimeoutMakesRoomInTheRunCap(t *testing.T) {
	shrinkTimeouts(t, 60*time.Second, 30*time.Minute)
	s := newTestScheduler(t)
	g := slowGraph(dhSnapshotBlockID)
	if got := s.runDuration(g); got != 3*time.Hour {
		t.Errorf("runDuration = %v, want 3h", got)
	}
}

// --- the engine records the downtime ---

func TestEngineCopiesDowntimeIntoTheNodeRecordAndEvent(t *testing.T) {
	s := newTestScheduler(t)
	var finished []map[string]interface{}
	s.bus.Tap(func(event string, data any) {
		if m, ok := data.(map[string]interface{}); ok && event == EventScheduleNodeFinished {
			finished = append(finished, m)
		}
	})
	must(s.registry.RegisterBlock(models.BlockDef{
		ID: "test.downtime", Category: "action",
		ControlInputs: []string{"trigger"}, ControlOutputs: []string{"onComplete", "onFailed"},
	}, func(e *ExecContext) ExecResult {
		if e.GetString("fail") != "" {
			return ExecResult{Port: "onFailed", Err: context.DeadlineExceeded, DowntimeMs: 130_000}
		}
		return ExecResult{Port: "onComplete", DowntimeMs: 130_000}
	}))

	for _, fail := range []string{"", "yes"} {
		finished = nil
		g := slowGraph("test.downtime")
		g.Nodes[1].Config = map[string]interface{}{"fail": fail}
		rec := s.runGraph(g, "t1", "manual", seed("t1"))
		awaitIdle(t, s)
		node := rec.Nodes[1]
		if node.DowntimeMs != 130_000 {
			t.Errorf("fail=%q: node record downtimeMs = %d, want 130000", fail, node.DowntimeMs)
		}
		raw, err := json.Marshal(node)
		if err != nil || !strings.Contains(string(raw), `"downtimeMs":130000`) {
			t.Errorf("fail=%q: record JSON = %s (%v)", fail, raw, err)
		}
		var event map[string]interface{}
		for _, m := range finished {
			if m["nodeId"] == "a1" {
				event = m
			}
		}
		if event == nil || event["downtimeMs"] != int64(130_000) {
			t.Errorf("fail=%q: node-finished event = %v, want downtimeMs 130000", fail, event)
		}
		if event != nil && event["serverID"] == nil {
			t.Errorf("fail=%q: the event lost its serverID", fail)
		}
	}
}

func TestEngineLeavesDowntimeOutOfOrdinaryNodes(t *testing.T) {
	s := newTestScheduler(t)
	var finished []map[string]interface{}
	s.bus.Tap(func(event string, data any) {
		if m, ok := data.(map[string]interface{}); ok && event == EventScheduleNodeFinished {
			finished = append(finished, m)
		}
	})
	var visited []string
	registerTestMarker(s.registry, &visited)
	g := slowGraph("test.marker")
	rec := s.runGraph(g, "t1", "manual", seed("t1"))
	awaitIdle(t, s)
	raw, err := json.Marshal(rec.Nodes)
	if err != nil || strings.Contains(string(raw), "downtimeMs") {
		t.Errorf("records = %s (%v): zero downtime must be absent", raw, err)
	}
	for _, m := range finished {
		if _, ok := m["downtimeMs"]; ok {
			t.Errorf("event %v carries a downtime", m)
		}
	}
}

// --- config ---

func TestDHLeadTime(t *testing.T) {
	tests := []struct {
		name string
		cfg  map[string]interface{}
		want time.Duration
		bad  bool
	}{
		{"absent is five minutes", map[string]interface{}{}, 5 * time.Minute, false},
		{"empty is five minutes", map[string]interface{}{"leadSeconds": ""}, 5 * time.Minute, false},
		{"a number", map[string]interface{}{"leadSeconds": float64(90)}, 90 * time.Second, false},
		{"typed into the field", map[string]interface{}{"leadSeconds": "45"}, 45 * time.Second, false},
		{"zero warns nobody", map[string]interface{}{"leadSeconds": float64(0)}, 0, false},
		{"the longest", map[string]interface{}{"leadSeconds": float64(1800)}, 30 * time.Minute, false},
		{"over the longest", map[string]interface{}{"leadSeconds": float64(1801)}, 0, true},
		{"negative", map[string]interface{}{"leadSeconds": float64(-1)}, 0, true},
		{"fractional", map[string]interface{}{"leadSeconds": 1.5}, 0, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := dhLeadTime(&ExecContext{Config: tc.cfg})
			if tc.bad != (err != nil) || got != tc.want {
				t.Errorf("got (%v, %v), want (%v, bad=%v)", got, err, tc.want, tc.bad)
			}
		})
	}
}

func TestDHStageDir(t *testing.T) {
	data, work, other := t.TempDir(), t.TempDir(), t.TempDir()
	e := func(output string) *ExecContext {
		return &ExecContext{ServerID: "srv1", Config: map[string]interface{}{"output": output}, svc: serviceDeps{dataDir: data}}
	}
	t.Run("the default is this server's folder under the data directory", func(t *testing.T) {
		got, err := dhStageDir(e(""), work)
		if want := filepath.Join(data, "dh-snapshots", "srv1"); err != nil || got != want {
			t.Errorf("got (%q, %v), want %q", got, err, want)
		}
	})
	t.Run("a folder elsewhere", func(t *testing.T) {
		want := filepath.Join(other, "snaps")
		got, err := dhStageDir(e(want+string(filepath.Separator)), work)
		if err != nil || got != want {
			t.Errorf("got (%q, %v), want %q", got, err, want)
		}
	})
	refused := []struct{ name, out string }{
		{"a relative path", "snaps"},
		{"the server's folder", work},
		{"a folder inside it", filepath.Join(work, "world", "snaps")},
		{"one that does not exist yet", filepath.Join(work, "new", "deeper")},
		{"a path that climbs back into it", work + string(filepath.Separator) + "a" + string(filepath.Separator) + ".." + string(filepath.Separator) + "b"},
	}
	for _, tc := range refused {
		t.Run("refuses "+tc.name, func(t *testing.T) {
			if _, err := dhStageDir(e(tc.out), work); err == nil {
				t.Errorf("%q was accepted", tc.out)
			}
		})
	}
	t.Run("a link into the server's folder is inside it", func(t *testing.T) {
		link := filepath.Join(other, "link")
		if err := os.Symlink(work, link); err != nil {
			t.Skipf("symlinks unavailable here: %v", err)
		}
		if _, err := dhStageDir(e(filepath.Join(link, "snaps")), work); err == nil {
			t.Error("a staging folder reached through a link into the server was accepted")
		}
	})
	t.Run("a server id that is not one segment", func(t *testing.T) {
		bad := &ExecContext{ServerID: "../x", Config: map[string]interface{}{}, svc: serviceDeps{dataDir: data}}
		if _, err := dhStageDir(bad, work); err == nil {
			t.Error("accepted ../x")
		}
	})
	t.Run("no data directory", func(t *testing.T) {
		none := &ExecContext{ServerID: "srv1", Config: map[string]interface{}{}}
		if _, err := dhStageDir(none, work); err == nil {
			t.Error("accepted an unknown data directory")
		}
	})
}

// --- per-server scoping ---

func TestDHSnapshotPlanBelongsToTheRunsServer(t *testing.T) {
	for _, tc := range []struct {
		server string
		b      bool // srv2's folder rather than srv1's
		key    string
	}{
		{"srv1", false, "7_alpha"},
		{"srv2", true, "9_beta"},
	} {
		t.Run(tc.server, func(t *testing.T) {
			f := dhBlockFixture(t)
			work := f.workA
			if tc.b {
				work = f.workB
			}
			cfg := dhBlockConfig()
			plan, _, err := dhPlanFor(&ExecContext{Ctx: context.Background(), ServerID: tc.server, Config: cfg, svc: f.s.deps})
			if err != nil {
				t.Fatal(err)
			}
			if plan.WorkingDir != work {
				t.Errorf("working dir = %s, want %s", plan.WorkingDir, work)
			}
			if plan.WorldDir != filepath.Join(work, "world") {
				t.Errorf("world dir = %s", plan.WorldDir)
			}
			if want := filepath.Join(f.dataDir, "dh-snapshots", tc.server); plan.StageDir != want {
				t.Errorf("staging dir = %s, want %s", plan.StageDir, want)
			}

			// Run the plan with a stand-in server: what it reads and writes is
			// this server's, and the other's staging folder is left alone.
			host := &fakeDHHost{running: true, canWarn: true}
			fx := &dhRunFixture{t: t}
			host.f = fx
			plan.Host = host
			plan.PartSize = dhTestPart
			plan.FreeSpace = func(string) (uint64, error) { return 1 << 40, nil }
			if _, err := runDHSnapshot(context.Background(), plan); err != nil {
				t.Fatal(err)
			}
			data, err := os.ReadFile(filepath.Join(plan.StageDir, dhIndexFile))
			if err != nil {
				t.Fatal(err)
			}
			ix, err := parseDHIndex(data)
			if err != nil || ix.ServerFolder != tc.key {
				t.Errorf("index serverFolder = %q (%v), want %q", ix.ServerFolder, err, tc.key)
			}
			other := "srv2"
			if tc.server == "srv2" {
				other = "srv1"
			}
			if _, err := os.Stat(filepath.Join(f.dataDir, "dh-snapshots", other)); err == nil {
				t.Errorf("%s's staging folder exists after a run for %s", other, tc.server)
			}
		})
	}
}

func TestDHSnapshotPlanTakesTheDestinationAndPrefixFromTheNode(t *testing.T) {
	f := dhBlockFixture(t)
	cfg := dhBlockConfig()
	cfg["destination"] = "r2"
	cfg["prefix"] = "/snap/"
	plan, scrub, err := dhPlanFor(&ExecContext{Ctx: context.Background(), ServerID: "srv1", Config: cfg, svc: f.s.deps})
	if err != nil {
		t.Fatal(err)
	}
	if plan.Bucket == nil || plan.KeyPrefix != "dh/snap" || plan.BucketLabel != `"R2"` {
		t.Errorf("bucket %v, prefix %q, label %q", plan.Bucket, plan.KeyPrefix, plan.BucketLabel)
	}
	if got := scrub("x " + testSecret); strings.Contains(got, testSecret) {
		t.Errorf("scrub kept the secret: %q", got)
	}

	for name, bad := range map[string]map[string]interface{}{
		"a missing destination": {"destination": "nowhere"},
		"a climbing prefix":     {"destination": "R2", "prefix": "../x"},
		"a bad lead time":       {"leadSeconds": float64(-5)},
		"a bad staging folder":  {"output": "relative"},
	} {
		if _, _, err := dhPlanFor(&ExecContext{ServerID: "srv1", Config: bad, svc: f.s.deps}); err == nil {
			t.Errorf("%s was accepted", name)
		}
	}
	if _, _, err := dhPlanFor(&ExecContext{ServerID: "ghost", Config: dhBlockConfig(), svc: f.s.deps}); err == nil {
		t.Error("a server with no config was accepted")
	}
	if _, _, err := dhPlanFor(&ExecContext{ServerID: "srv1", Config: dhBlockConfig(), svc: serviceDeps{}}); err == nil {
		t.Error("a scheduler with no services was accepted")
	}
	noDests := f.s.deps
	noDests.destinations = nil
	if _, _, err := dhPlanFor(&ExecContext{ServerID: "srv1", Config: cfg, svc: noDests}); err == nil {
		t.Error("a destination with no destination service was accepted")
	}
}

func TestDHSnapshotMessageDefaultsWhenBlank(t *testing.T) {
	f := dhBlockFixture(t)
	for _, msg := range []interface{}{nil, "", "   "} {
		cfg := dhBlockConfig()
		cfg["message"] = msg
		plan, _, err := dhPlanFor(&ExecContext{ServerID: "srv1", Config: cfg, svc: f.s.deps})
		if err != nil || plan.Message != dhDefaultMessage {
			t.Errorf("message %v: got %q (%v)", msg, plan.Message, err)
		}
	}
	cfg := dhBlockConfig()
	cfg["message"] = "Back in a bit: {time}"
	plan, _, err := dhPlanFor(&ExecContext{ServerID: "srv1", Config: cfg, svc: f.s.deps})
	if err != nil || plan.Message != "Back in a bit: {time}" {
		t.Errorf("got %q (%v)", plan.Message, err)
	}
}

func TestUploadRootsIncludeOnlyThisServersSnapshotStaging(t *testing.T) {
	f := dhBlockFixture(t)
	staged := filepath.Join(f.dataDir, "dh-snapshots", "srv1")
	writeFile(t, filepath.Join(staged, "index.json"), "{}")
	writeFile(t, filepath.Join(staged, "parts", strings.Repeat("a", 64)), "part")
	writeFile(t, filepath.Join(f.dataDir, "dh-snapshots", "srv2", "index.json"), "{}")

	tests := []struct {
		name    string
		server  string
		source  string
		allowed bool
	}{
		{"its own staging folder", "srv1", staged, true},
		{"one file in it", "srv1", filepath.Join(staged, "index.json"), true},
		{"another server's staging folder", "srv1", filepath.Join(f.dataDir, "dh-snapshots", "srv2"), false},
		{"another server's staged index", "srv1", filepath.Join(f.dataDir, "dh-snapshots", "srv2", "index.json"), false},
		{"all the staging folders at once", "srv1", filepath.Join(f.dataDir, "dh-snapshots"), false},
		{"the other server, from its own side", "srv2", staged, false},
		{"the secret keys, still", "srv1", filepath.Join(f.dataDir, destinationSecretsDir), false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			before := len(f.bucket.recorded())
			res, _ := f.exec(tc.server, map[string]interface{}{"destination": "R2", "source": tc.source})
			if tc.allowed {
				if res.Err != nil {
					t.Fatalf("refused: %v", res.Err)
				}
				return
			}
			if res.Port != "onFailed" || res.Err == nil || !strings.Contains(res.Err.Error(), "outside") {
				t.Fatalf("result = %+v, want a refusal for being outside", res)
			}
			if n := len(f.bucket.recorded()) - before; n != 0 {
				t.Errorf("%d requests went out before the refusal", n)
			}
		})
	}
	// A wired folder uploads under the key prefix, which is how PR 9's block and
	// this one's output meet.
	f.exec("srv1", map[string]interface{}{"destination": "R2", "source": staged, "prefix": "stage"})
	if got := strings.Join(f.bucket.requestsOf(http.MethodPut), " "); !strings.Contains(got, "dh/stage/index.json") || !strings.Contains(got, "dh/stage/parts/"+strings.Repeat("a", 64)) {
		t.Errorf("PUTs = %v", got)
	}
}

func TestUploadRootsWithoutADataDirectoryAddNoStagingRoot(t *testing.T) {
	f := newUploadFixture(t) // its deps carry no dataDir
	roots := uploadRoots(&ExecContext{ServerID: "srv1", svc: f.s.deps}, f.workA)
	for _, r := range roots {
		if strings.Contains(r, dhStagingFolder) {
			t.Errorf("roots = %v", roots)
		}
	}
}

func TestSchedulerSetDataDirGivesTheBlocksTheDataDirectory(t *testing.T) {
	s := newTestScheduler(t)
	dir := t.TempDir()
	s.SetDataDir(dir)
	if s.deps.dataDir != dir {
		t.Errorf("deps.dataDir = %q, want %q", s.deps.dataDir, dir)
	}
}

// --- running the block against real services ---

func TestDHSnapshotRefusesAServerThatIsNotRunningAndTouchesNothing(t *testing.T) {
	f := dhBlockFixture(t)
	res, out := f.execDH("srv1", dhBlockConfig())
	if res.Port != "onFailed" || res.Err == nil || !strings.Contains(res.Err.Error(), "not running") {
		t.Fatalf("result = %+v", res)
	}
	if res.DowntimeMs != 0 || len(out) != 0 {
		t.Errorf("downtime %d, outputs %v: nothing happened", res.DowntimeMs, out)
	}
	if _, err := os.Stat(filepath.Join(f.dataDir, "dh-snapshots")); err == nil {
		t.Error("a staging folder was created")
	}
	if !strings.Contains(f.console("srv1"), "Distant Horizons snapshot failed:") {
		t.Errorf("console does not say it failed:\n%s", f.console("srv1"))
	}
}

func TestDHSnapshotRefusesAnEmptyServerKeyBeforeWarningAnyone(t *testing.T) {
	f := dhBlockFixture(t)
	stdin := runningInstance(t, f.server)
	dhWrite(t, f.workA, "config/DistantHorizons.toml", []byte("serverId = 7\nserverKey = \"\"\nlevelKeyPrefix = \"pa\"\n"))

	rec := f.run(dhGraph("srv1", map[string]interface{}{"leadSeconds": float64(60)}))
	if rec.Status != "failed" || !strings.Contains(rec.Error, "serverKey is empty") {
		t.Fatalf("run = %s %q", rec.Status, rec.Error)
	}
	if got := stdin(); len(got) != 0 {
		t.Errorf("the console received %v: nobody should have been warned and nothing stopped", got)
	}
	if !f.server.IsRunning("srv1") {
		t.Error("the server is not running any more")
	}
}

func TestDHSnapshotUnreachableDestinationRefusesAndTheSecretIsNowhere(t *testing.T) {
	logs := &captureHandler{}
	prev := slog.Default()
	slog.SetDefault(slog.New(logs))
	t.Cleanup(func() { slog.SetDefault(prev) })

	f := dhBlockFixture(t)
	stdin := runningInstance(t, f.server)
	// Every read is refused with a message that echoes the secret back.
	f.bucket.setFailGet(func(string) (int, string) { return http.StatusForbidden, "SignatureDoesNotMatch" })

	cfg := dhBlockConfig()
	cfg["destination"] = "R2"
	cfg["prefix"] = "snap"
	rec := f.run(dhGraph("srv1", cfg))
	if rec.Status != "failed" || !strings.Contains(rec.Error, "cannot read the previous snapshot") {
		t.Fatalf("run = %s %q", rec.Status, rec.Error)
	}
	if got := f.bucket.requestsOf(http.MethodGet); len(got) != 1 || got[0] != "dh/snap/latest.json" {
		t.Errorf("GETs = %v, want dh/snap/latest.json", got)
	}
	if got := stdin(); len(got) != 0 {
		t.Errorf("console received %v before the refusal", got)
	}

	raw, err := json.Marshal(rec)
	if err != nil {
		t.Fatal(err)
	}
	history, err := os.ReadFile(filepath.Join(f.dataDir, "scheduler-history.json"))
	if err != nil {
		t.Fatal(err)
	}
	surfaces := map[string]string{
		"run record": string(raw), "history": string(history), "events": f.events.text(),
		"console": f.console("srv1"), "log": logs.buf.String(),
	}
	for name, text := range surfaces {
		if strings.Contains(text, testSecret) {
			t.Errorf("%s carries the secret:\n%s", name, text)
		}
	}
	if !strings.Contains(string(raw), "redacted") {
		t.Errorf("the echoed secret was dropped rather than marked: %s", raw)
	}
}

func TestDHSnapshotMissingBucketKeyIsAFirstSnapshotNotAFailure(t *testing.T) {
	f := dhBlockFixture(t)
	runningInstance(t, f.server)
	// A run past the preflight would stop a process the fixture does not have, so
	// this stops at the preflight, which is where the (404) read is made.
	cfg := dhBlockConfig()
	cfg["destination"] = "R2"
	plan, _, err := dhPlanFor(&ExecContext{Ctx: context.Background(), ServerID: "srv1", Config: cfg, svc: f.s.deps})
	if err != nil {
		t.Fatal(err)
	}
	plan.fillDefaults()
	pre, err := plan.preflight(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if pre.prev != nil || pre.prevFromBucket {
		t.Errorf("preflight = %+v, want no previous index", pre)
	}
	if got := f.bucket.requestsOf(http.MethodGet); len(got) != 1 || got[0] != "dh/latest.json" {
		t.Errorf("GETs = %v", got)
	}
}

// --- the real host ---

func dhHostFixture(t *testing.T) (*ServerService, func() []string, *rconRecorder, serverDHHost) {
	t.Helper()
	srv, _ := newServerFixture()
	stdin := runningInstance(t, srv)
	rec := newRconRecorder()
	enableRcon(srv, rconServerLoop(t, rec.serve))
	e := &ExecContext{Ctx: context.Background(), ServerID: fixtureServerID, svc: serviceDeps{server: srv, rcon: NewRconService()}}
	return srv, stdin, rec, serverDHHost{e: e, cfg: models.ServerConfig{ID: fixtureServerID}}
}

func TestServerDHHostSaysOverRconWhenItIsConfirmed(t *testing.T) {
	_, stdin, rec, host := dhHostFixture(t)
	if !host.CanWarn() || !host.IsRunning() {
		t.Fatal("a running server with RCON cannot warn")
	}
	if err := host.Say("Stopping in 5 minutes"); err != nil {
		t.Fatal(err)
	}
	if got := rec.commands(t, 1); len(got) != 1 || got[0] != "say Stopping in 5 minutes" {
		t.Errorf("RCON got %v", got)
	}
	if got := stdin(); len(got) != 0 {
		t.Errorf("the console got %v as well", got)
	}
}

func TestServerDHHostFallsBackToTheConsoleWithoutRcon(t *testing.T) {
	srv, _ := newServerFixture()
	stdin := runningInstance(t, srv)
	e := &ExecContext{ServerID: fixtureServerID, svc: serviceDeps{server: srv, rcon: NewRconService()}}
	host := serverDHHost{e: e}
	if !host.CanWarn() {
		t.Fatal("a running server takes commands on its console")
	}
	if err := host.Say("line one\nstop"); err != nil {
		t.Fatal(err)
	}
	got := stdin()
	for i := 0; i < 50 && len(got) == 0; i++ {
		time.Sleep(5 * time.Millisecond)
		got = stdin()
	}
	// A newline in the message would run the rest as a console command of its own.
	if len(got) != 1 || got[0] != "say line one stop" {
		t.Errorf("console got %v", got)
	}
}

func TestServerDHHostFallsBackToTheConsoleWhenRconDrops(t *testing.T) {
	srv, _ := newServerFixture()
	stdin := runningInstance(t, srv)
	rec := newRconRecorder(1) // hangs up after auth
	enableRcon(srv, rconServerLoop(t, rec.serve))
	e := &ExecContext{ServerID: fixtureServerID, svc: serviceDeps{server: srv, rcon: NewRconService()}}
	if err := (serverDHHost{e: e}).Say("hello"); err != nil {
		t.Fatal(err)
	}
	got := stdin()
	for i := 0; i < 50 && len(got) == 0; i++ {
		time.Sleep(5 * time.Millisecond)
		got = stdin()
	}
	if len(got) != 1 || got[0] != "say hello" {
		t.Errorf("console got %v", got)
	}
}

func TestServerDHHostReportsBothChannelsWhenNeitherWorks(t *testing.T) {
	srv, _ := newServerFixture()
	runningInstance(t, srv)
	breakStdin(t, srv)
	rec := newRconRecorder(1)
	enableRcon(srv, rconServerLoop(t, rec.serve))
	e := &ExecContext{ServerID: fixtureServerID, svc: serviceDeps{server: srv, rcon: NewRconService()}}
	err := (serverDHHost{e: e}).Say("hello")
	if err == nil || !strings.Contains(err.Error(), "RCON:") || !strings.Contains(err.Error(), "console:") {
		t.Errorf("err = %v, want both channels named", err)
	}
	if err := (serverDHHost{e: &ExecContext{ServerID: fixtureServerID, svc: serviceDeps{server: srv}}}).Say("x"); err == nil {
		t.Error("a console that is broken and no RCON said it was fine")
	}
}

func TestServerDHHostCannotWarnAServerThatIsNotRunning(t *testing.T) {
	srv, _ := newServerFixture()
	host := serverDHHost{e: &ExecContext{ServerID: fixtureServerID, svc: serviceDeps{server: srv}}}
	if host.IsRunning() || host.CanWarn() {
		t.Error("a stopped server with no RCON can be warned")
	}
}

// --- validation ---

func dhGraph(serverID string, cfg map[string]interface{}) models.Graph {
	g := uploadGraph(serverID, cfg, false)
	g.Nodes[1].Type = dhSnapshotBlockID
	return g
}

func TestGraphWarningsForTheSnapshotBlockSayTheWarningGoesThroughTheConsole(t *testing.T) {
	reg := NewBlockRegistry()
	registerBuiltins(reg)
	snap := dhGraph("srv1", dhBlockConfig())

	got := graphWarnings(snap, reg, false)
	if len(got) != 1 || got[0] != dhSnapshotConsoleWarning {
		t.Fatalf("warnings = %v, want only the console advice", got)
	}
	if !containsAll(got[0], "RCON is not confirmed", "through the", "console") || strings.Contains(got[0], "cannot be sent") {
		t.Errorf("text = %q", got[0])
	}
	if got := graphWarnings(snap, reg, true); len(got) != 0 {
		t.Errorf("with RCON: warnings = %v", got)
	}

	// A plain Stop beside it still cannot warn, and says so in its own line.
	stop := stopGraph(t, "__stop__", false)
	snap.Nodes = append(snap.Nodes, stop.Nodes[1])
	snap.Nodes[len(snap.Nodes)-1].ID = "stop"
	got = graphWarnings(snap, reg, false)
	if len(got) != 2 || got[0] != rconUnconfirmedWarning || got[1] != dhSnapshotConsoleWarning {
		t.Errorf("warnings = %v", got)
	}
}

func TestGraphWarningsMethodAsksRconForASnapshotGraph(t *testing.T) {
	s := newTestScheduler(t)
	srv, _ := newServerFixture()
	s.deps.server = srv
	g := dhGraph(fixtureServerID, dhBlockConfig())

	got, err := s.GraphWarnings(fixtureServerID, g)
	if err != nil || len(got) != 1 || got[0] != dhSnapshotConsoleWarning {
		t.Fatalf("without RCON: %v, %v", got, err)
	}
	enableRcon(srv, "127.0.0.1:25575")
	got, err = s.GraphWarnings(fixtureServerID, g)
	if err != nil || len(got) != 0 {
		t.Fatalf("with RCON: %v, %v", got, err)
	}
}

func TestSnapshotNodeMayLeaveItsDestinationEmptyButNotNameAMissingOne(t *testing.T) {
	f := newUploadFixture(t)
	reg := f.s.registry
	node := func(dest interface{}) models.Graph {
		cfg := dhBlockConfig()
		if dest != nil {
			cfg["destination"] = dest
		}
		return dhGraph("srv1", cfg)
	}
	for _, empty := range []interface{}{nil, "", "  "} {
		if issues := validateGraphDestinations(node(empty), reg, f.dests); len(issues) != 0 {
			t.Errorf("destination %q: issues = %q, want none", empty, issues)
		}
	}
	if issues := validateGraphDestinations(node("R2"), reg, f.dests); len(issues) != 0 {
		t.Errorf("a saved destination: issues = %q", issues)
	}
	issues := validateGraphDestinations(node("gone"), reg, f.dests)
	if len(issues) != 1 || !strings.Contains(issues[0], `"gone" does not exist`) {
		t.Errorf("a missing destination: issues = %q", issues)
	}
	// Upload to Bucket's destination is still required.
	up := uploadGraph("srv1", map[string]interface{}{"source": "x"}, false)
	if issues := validateGraphDestinations(up, reg, f.dests); len(issues) != 1 || !strings.Contains(issues[0], "no destination chosen") {
		t.Errorf("upload with none: issues = %q", issues)
	}
}

func TestRunWithAMissingOptionalDestinationRunsAsAFirstLocalSnapshot(t *testing.T) {
	// The engine's own destination check must let an empty optional one through:
	// the block then fails on its own terms (the server is not running), not
	// with "destination validation failed".
	f := dhBlockFixture(t)
	rec := f.run(dhGraph("srv1", dhBlockConfig()))
	if strings.Contains(rec.Error, "destination validation failed") {
		t.Errorf("run error = %q", rec.Error)
	}
	if !strings.Contains(rec.Error, "not running") {
		t.Errorf("run error = %q, want the block's own refusal", rec.Error)
	}
}

// --- the whole block against a real ServerService ---
//
// ServerService has a launchCmd seam, so these runs start, warn, stop and start
// a real (fake) child process: one that appends everything on its stdin to a
// file, which is how the test reads what the players' console was told, and in
// what order relative to the stop.

// consoleLogFixture makes srv1 a running server whose child process logs its
// stdin to the returned file, and starts it.
func consoleLogFixture(t *testing.T, f *uploadFixture) (logPath string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("captures the console through sh")
	}
	logPath = filepath.Join(t.TempDir(), "console.log")
	f.server.launchCmd = func(string, string, []string) (*exec.Cmd, error) {
		return exec.Command("sh", "-c", `cat >> "$0"`, logPath), nil
	}
	t.Cleanup(func() {
		if err := f.server.ForceStop("srv1"); err != nil {
			t.Errorf("force stop: %v", err)
		}
	})
	if err := f.server.Start("srv1", "", nil, f.workA); err != nil {
		t.Fatal(err)
	}
	return logPath
}

func readConsoleLog(t *testing.T, path string, wantLines int) []string {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for {
		data, err := os.ReadFile(path)
		var got []string
		if err == nil && len(data) > 0 {
			got = strings.Split(strings.TrimRight(string(data), "\n"), "\n")
		}
		if len(got) >= wantLines || time.Now().After(deadline) {
			return got
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestDHSnapshotRunsEndToEndAndRestartsTheServer(t *testing.T) {
	f := dhBlockFixture(t)
	logPath := consoleLogFixture(t, f)

	cfg := map[string]interface{}{"leadSeconds": float64(1), "message": "Snapshot in {time}"}
	res, out := f.execDH("srv1", cfg)
	if res.Port != "onComplete" || res.Err != nil {
		t.Fatalf("result = %+v", res)
	}

	// The warning, then the stop, in that order, on the console.
	lines := readConsoleLog(t, logPath, 2)
	if len(lines) != 2 || lines[0] != "say Snapshot in 1 second" || lines[1] != "stop" {
		t.Errorf("console saw %q, want the warning and then stop", lines)
	}
	if !f.server.IsRunning("srv1") {
		t.Error("the server was not started again")
	}

	stage := filepath.Join(f.dataDir, "dh-snapshots", "srv1")
	if out["folder"] != stage || out["partsChanged"] != float64(1) || out["partsTotal"] != float64(1) || out["bytesChanged"] != float64(3*dhTestPart) {
		t.Errorf("outputs = %v", out)
	}
	if d, _ := out["downtime"].(float64); d <= 0 || res.DowntimeMs <= 0 {
		t.Errorf("downtime output %v, result %d ms: the stop-to-start time was not measured", out["downtime"], res.DowntimeMs)
	}
	if _, err := os.Stat(filepath.Join(stage, dhIndexFile)); err != nil {
		t.Errorf("no index.json staged: %v", err)
	}
	// Starting the server clears its console, so only the closing line survives.
	if !strings.Contains(f.console("srv1"), "Server started again after") {
		t.Errorf("console:\n%s", f.console("srv1"))
	}
}

func TestDHSnapshotRunRecordCarriesTheDowntimeEvenWhenTheCopyFailsAndTheServerIsBack(t *testing.T) {
	f := dhBlockFixture(t)
	logPath := consoleLogFixture(t, f)
	if err := os.WriteFile(filepath.Join(f.workA, "world", "data", "DistantHorizons.sqlite-wal"), []byte("log"), 0644); err != nil {
		t.Fatal(err)
	}

	var visited []string
	registerTestMarker(f.s.registry, &visited)
	g := dhGraph("srv1", map[string]interface{}{"leadSeconds": float64(0)})
	g.Nodes = append(g.Nodes, models.Node{ID: "m1", Type: "test.marker", Config: map[string]interface{}{"markerId": "failed"}})
	g.Edges = append(g.Edges, models.Edge{ID: "e2", Kind: "control", Source: "u1", SourcePort: "onFailed", Target: "m1", TargetPort: "trigger"})

	rec := f.run(g)
	if rec.Status != "failed" || !strings.Contains(rec.Error, "did not close the database cleanly") {
		t.Fatalf("run = %s %q", rec.Status, rec.Error)
	}
	if len(visited) != 1 {
		t.Errorf("onFailed branch visited %v", visited)
	}
	var node models.NodeRunRecord
	for _, n := range rec.Nodes {
		if n.NodeID == "u1" {
			node = n
		}
	}
	if node.FiredPort != "onFailed" || node.DowntimeMs <= 0 {
		t.Errorf("node record = %+v: want onFailed with the measured downtime", node)
	}
	if !f.server.IsRunning("srv1") {
		t.Error("the server was left down after a refused copy")
	}
	if lines := readConsoleLog(t, logPath, 1); len(lines) < 1 || lines[0] != "stop" {
		t.Errorf("console saw %q: no warning was asked for, and the server was stopped", lines)
	}
	if !strings.Contains(f.console("srv1"), "Distant Horizons snapshot failed:") {
		t.Errorf("console does not say it failed:\n%s", f.console("srv1"))
	}
}

func TestDHSnapshotHostStopsAndStartsTheRunsServer(t *testing.T) {
	f := dhBlockFixture(t)
	consoleLogFixture(t, f)
	cfg, err := f.s.deps.config.GetServerConfig("srv1")
	if err != nil {
		t.Fatal(err)
	}
	host := serverDHHost{e: &ExecContext{ServerID: "srv1", svc: f.s.deps}, cfg: *cfg}
	if !host.IsRunning() {
		t.Fatal("the fixture server is not running")
	}
	if err := host.Stop(time.Minute); err != nil {
		t.Fatal(err)
	}
	if host.IsRunning() {
		t.Error("still running after Stop")
	}
	if err := host.Stop(time.Minute); err == nil {
		t.Error("stopping a stopped server was not an error")
	}
	if err := host.Start(); err != nil {
		t.Fatal(err)
	}
	if !host.IsRunning() {
		t.Error("not running after Start")
	}
}

func TestFinishDHSnapshot(t *testing.T) {
	f := dhBlockFixture(t)
	scrub := func(s string) string { return strings.ReplaceAll(s, "hunter2", "[redacted]") }
	newCtx := func() (*ExecContext, map[string]interface{}) {
		out := map[string]interface{}{}
		return &ExecContext{ServerID: "srv1", svc: f.s.deps, dataOut: out}, out
	}

	t.Run("a failure keeps the downtime, scrubs the text and sets no staged-folder outputs", func(t *testing.T) {
		e, out := newCtx()
		res := finishDHSnapshot(e, dhRunResult{Folder: "x", Downtime: 90 * time.Second}, errors.New("bucket said hunter2"), scrub)
		if res.Port != "onFailed" || res.DowntimeMs != 90_000 || res.Err == nil || strings.Contains(res.Err.Error(), "hunter2") {
			t.Errorf("result = %+v", res)
		}
		if _, ok := out["folder"]; ok || out["downtime"] != 90.0 {
			t.Errorf("outputs = %v", out)
		}
		if strings.Contains(f.console("srv1"), "hunter2") || !strings.Contains(f.console("srv1"), "[redacted]") {
			t.Errorf("console:\n%s", f.console("srv1"))
		}
	})
	t.Run("a refusal has no downtime to report", func(t *testing.T) {
		e, out := newCtx()
		res := finishDHSnapshot(e, dhRunResult{}, errors.New("no"), scrub)
		if res.DowntimeMs != 0 || len(out) != 0 {
			t.Errorf("result %+v, outputs %v", res, out)
		}
	})
	t.Run("a success sets every output", func(t *testing.T) {
		e, out := newCtx()
		res := finishDHSnapshot(e, dhRunResult{Folder: "/stage", BytesChanged: 4096, PartsChanged: 2, PartsTotal: 9, Downtime: 2*time.Minute + 10*time.Second}, nil, scrub)
		if res.Port != "onComplete" || res.Err != nil || res.DowntimeMs != 130_000 {
			t.Errorf("result = %+v", res)
		}
		want := map[string]interface{}{"folder": "/stage", "bytesChanged": 4096.0, "partsChanged": 2.0, "partsTotal": 9.0, "downtime": 130.0}
		for k, v := range want {
			if out[k] != v {
				t.Errorf("output %s = %v, want %v", k, out[k], v)
			}
		}
	})
}

// A downtime the run measured is never recorded as none. Milliseconds()
// truncates, so a stop and start that took under a millisecond (a fake server
// in CI) came out as 0, which the engine reads as "this node stopped nothing"
// and leaves off the run record.
func TestFinishDHSnapshotRoundsADowntimeUpToAMillisecond(t *testing.T) {
	cases := []struct {
		downtime time.Duration
		wantMs   int64
	}{
		{0, 0},
		{300 * time.Microsecond, 1},
		{time.Millisecond, 1},
		{1500 * time.Microsecond, 2},
		{42 * time.Second, 42000},
	}
	for _, tc := range cases {
		e := &ExecContext{dataOut: map[string]interface{}{}}
		res := finishDHSnapshot(e, dhRunResult{Downtime: tc.downtime}, nil, func(s string) string { return s })
		if res.DowntimeMs != tc.wantMs {
			t.Errorf("downtime %s recorded as %d ms, want %d", tc.downtime, res.DowntimeMs, tc.wantMs)
		}
	}
}
