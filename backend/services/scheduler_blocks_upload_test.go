package services

import (
	"context"
	"encoding/json"
	"fmt"
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

// ─── action.upload (#480) ──────────────────────────────────────────────────
//
// The library is covered in upload_test.go. These tests drive the block the way a
// graph does: through the engine, with real services over temp directories and an
// in-memory bucket behind httptest.

type uploadFixture struct {
	s       *SchedulerService
	dests   *DestinationService
	server  *ServerService
	bucket  *fakeBucket
	dataDir string
	workA   string // srv1's working directory
	workB   string // srv2's
	events  *eventLog
}

// eventLog records every event the bus carries, as JSON, so a test can search all
// of them for a string.
type eventLog struct {
	mu   sync.Mutex
	logs []string
}

func (l *eventLog) text() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return strings.Join(l.logs, "\n")
}

func newUploadFixture(t *testing.T) *uploadFixture {
	t.Helper()
	dataDir := t.TempDir()
	f := &uploadFixture{dataDir: dataDir, bucket: newFakeBucket(t), events: &eventLog{}}

	f.workA = filepath.Join(t.TempDir(), "a")
	f.workB = filepath.Join(t.TempDir(), "b")
	writeFile(t, filepath.Join(f.workA, "world", "level.dat"), "level-a")
	writeFile(t, filepath.Join(f.workA, "world", "region", "r.0.0.mca"), "region-a")
	writeFile(t, filepath.Join(f.workA, "index.json"), "{}")
	writeFile(t, filepath.Join(f.workB, "world", "level.dat"), "level-b-secret-world")

	cfg := &ConfigService{}
	cfg.SetDataDir(dataDir)
	for id, dir := range map[string]string{"srv1": f.workA, "srv2": f.workB} {
		if err := cfg.SaveServerConfig(models.ServerConfig{ID: id, Name: id, WorkingDir: dir}); err != nil {
			t.Fatal(err)
		}
	}
	f.server = NewServerService()

	f.dests = NewDestinationService()
	f.dests.SetDataDir(dataDir)
	f.dests.httpClient = f.bucket.Client()
	f.dests.retryBase = time.Millisecond
	if _, err := f.dests.Save(models.Destination{
		Name: "R2", Endpoint: f.bucket.URL, Region: "auto", Bucket: "snapshots",
		Prefix: "dh", AccessKeyID: "AKIATESTKEY",
	}, testSecret); err != nil {
		t.Fatal(err)
	}

	f.s = &SchedulerService{
		running:   make(map[string]bool),
		lastFired: make(map[string]time.Time),
		stopTime:  make(chan struct{}),
		dataDir:   dataDir,
	}
	f.s.bus = NewEventBus()
	f.s.bus.Tap(func(event string, data any) {
		raw, err := json.Marshal(data)
		if err != nil {
			raw = []byte(fmt.Sprintf("%v", data))
		}
		f.events.mu.Lock()
		f.events.logs = append(f.events.logs, event+" "+string(raw))
		f.events.mu.Unlock()
	})
	backup := &BackupService{config: cfg, server: f.server, dataDir: dataDir}
	f.s.deps = serviceDeps{bus: f.s.bus, config: cfg, server: f.server, backup: backup, destinations: f.dests}
	f.s.registry = NewBlockRegistry()
	registerBuiltins(f.s.registry)
	registerDataBuiltins(f.s.registry)
	t.Cleanup(func() { awaitIdle(t, f.s) })
	return f
}

func (f *uploadFixture) console(serverID string) string {
	var lines []string
	for _, l := range f.server.GetConsoleHistory(serverID) {
		lines = append(lines, l.Line)
	}
	return strings.Join(lines, "\n")
}

// uploadGraph is a trigger wired to one upload node, owned by serverID. When
// failMarker is set, the node's onFailed leads to a test.marker block.
func uploadGraph(serverID string, cfg map[string]interface{}, failMarker bool) models.Graph {
	g := models.Graph{
		ID: "up", ServerID: serverID, Enabled: true,
		Nodes: []models.Node{
			{ID: "t1", Type: "trigger.player", Config: map[string]interface{}{"type": "Joined"}},
			{ID: "u1", Type: uploadBlockID, Config: cfg},
		},
		Edges: []models.Edge{
			{ID: "e1", Kind: "control", Source: "t1", SourcePort: "onComplete", Target: "u1", TargetPort: "trigger"},
		},
	}
	if failMarker {
		g.Nodes = append(g.Nodes, models.Node{ID: "m1", Type: "test.marker", Config: map[string]interface{}{"markerId": "failed"}})
		g.Edges = append(g.Edges, models.Edge{ID: "e2", Kind: "control", Source: "u1", SourcePort: "onFailed", Target: "m1", TargetPort: "trigger"})
	}
	return g
}

func (f *uploadFixture) run(g models.Graph) models.RunRecord {
	return f.s.runGraph(g, "t1", "manual", seed("t1"))
}

func (f *uploadFixture) exec(serverID string, cfg map[string]interface{}) (ExecResult, map[string]interface{}) {
	out := map[string]interface{}{}
	res := execUpload(&ExecContext{
		Ctx: context.Background(), ServerID: serverID, Config: cfg,
		svc: f.s.deps, dataOut: out,
	})
	return res, out
}

func okConfig() map[string]interface{} {
	return map[string]interface{}{"destination": "R2", "source": "world", "prefix": "snap"}
}

// --- the definition ---

func TestUploadBlockDefinition(t *testing.T) {
	def := commandBlock(t, uploadBlockID)
	if def.Category != "action" || def.Label != "Upload to Bucket" {
		t.Errorf("category %q, label %q", def.Category, def.Label)
	}
	if got := strings.Join(def.ControlOutputs, ","); got != "onComplete,onFailed" {
		t.Errorf("control outputs = %s", got)
	}
	var outs []string
	for _, p := range def.DataOutputs {
		outs = append(outs, p.ID+":"+p.Type)
	}
	if got := strings.Join(outs, ","); got != "uploaded:number,skipped:number,bytes:number" {
		t.Errorf("data outputs = %s", got)
	}
	fields := map[string]models.ConfigField{}
	for _, f := range def.ConfigSchema {
		fields[f.Key] = f
	}
	if f := fields["destination"]; f.Type != "destination" || !f.Required {
		t.Errorf("destination field = %+v", f)
	}
	if f := fields["source"]; f.Type != "string" || !f.Required {
		t.Errorf("source field = %+v", f)
	}
	if f := fields["prefix"]; f.Type != "string" || f.Required {
		t.Errorf("prefix field = %+v", f)
	}
	if len(def.Effects) != 0 {
		t.Errorf("effects = %v: uploading takes nothing down", def.Effects)
	}
}

func TestUploadBlockDeclaresALongTimeLimitAndTheRunCapGrowsToFit(t *testing.T) {
	shrinkTimeouts(t, 60*time.Second, 30*time.Minute)
	def := commandBlock(t, uploadBlockID)
	if got := blockTimeout(def); got != 12*time.Hour {
		t.Errorf("blockTimeout = %v, want 12h", got)
	}
	s := newTestScheduler(t)
	if got := s.runDuration(uploadGraph("srv1", nil, false)); got != 12*time.Hour {
		t.Errorf("runDuration = %v, want the run cap to make room for the upload", got)
	}
}

// --- running ---

func TestUploadBlockUploadsUnderBothPrefixesAndReportsTheCounts(t *testing.T) {
	f := newUploadFixture(t)

	res, out := f.exec("srv1", okConfig())
	if res.Port != "onComplete" || res.Err != nil {
		t.Fatalf("result = %+v", res)
	}
	want := "dh/snap/level.dat,dh/snap/region/r.0.0.mca"
	if got := strings.Join(f.bucket.requestsOf(http.MethodPut), ","); got != want {
		t.Errorf("keys = %s\nwant   %s: the destination's prefix, then the node's, then the path below the source folder", got, want)
	}
	if out["uploaded"] != float64(2) || out["skipped"] != float64(0) || out["bytes"] != float64(len("level-a")+len("region-a")) {
		t.Errorf("outputs = %v", out)
	}

	cfg := okConfig()
	cfg["destination"] = "r2" // a name matches ignoring case, as Save keeps them unique
	res, out = f.exec("srv1", cfg)
	if res.Port != "onComplete" || out["uploaded"] != float64(0) || out["skipped"] != float64(2) || out["bytes"] != float64(0) {
		t.Errorf("second run: %+v %v", res, out)
	}

	console := f.console("srv1")
	for _, want := range []string{`Uploading 2 file(s)`, `to "R2"`, "Upload finished: 2 sent", "Upload finished: 0 sent"} {
		if !strings.Contains(console, want) {
			t.Errorf("console lacks %q:\n%s", want, console)
		}
	}
}

func TestUploadBlockSingleFileAndNoPrefix(t *testing.T) {
	f := newUploadFixture(t)
	res, _ := f.exec("srv1", map[string]interface{}{"destination": "R2", "source": "index.json"})
	if res.Err != nil {
		t.Fatal(res.Err)
	}
	if got := f.bucket.requestsOf(http.MethodPut); len(got) != 1 || got[0] != "dh/index.json" {
		t.Errorf("PUTs = %v, want dh/index.json", got)
	}
}

func TestUploadBlockFailsThroughOnFailedWithAReadableError(t *testing.T) {
	f := newUploadFixture(t)
	f.bucket.setFail(func(string, int) (int, string) { return http.StatusForbidden, "AccessDenied" })

	var visited []string
	registerTestMarker(f.s.registry, &visited)
	rec := f.run(uploadGraph("srv1", okConfig(), true))

	if rec.Status != "failed" {
		t.Fatalf("status = %q", rec.Status)
	}
	if len(visited) != 1 || visited[0] != "failed" {
		t.Errorf("onFailed branch visited %v, want the failure marker", visited)
	}
	var node models.NodeRunRecord
	for _, n := range rec.Nodes {
		if n.NodeID == "u1" {
			node = n
		}
	}
	if node.FiredPort != "onFailed" {
		t.Errorf("fired %q, want onFailed", node.FiredPort)
	}
	for _, want := range []string{"refused the upload", "403", "access key"} {
		if !strings.Contains(node.Error, want) {
			t.Errorf("node error %q lacks %q", node.Error, want)
		}
	}
	if !strings.Contains(f.console("srv1"), "Upload failed:") {
		t.Errorf("console does not say the upload failed:\n%s", f.console("srv1"))
	}
}

func TestUploadBlockSecretIsInNoRunRecordEventLogOrConsole(t *testing.T) {
	logs := &captureHandler{}
	prev := slog.Default()
	slog.SetDefault(slog.New(logs))
	t.Cleanup(func() { slog.SetDefault(prev) })

	f := newUploadFixture(t)
	// Every request is refused with a message that echoes the secret back, and
	// the first run also passes through a retried 5xx that does.
	f.bucket.setFail(func(_ string, puts int) (int, string) {
		if puts == 1 {
			return http.StatusBadGateway, "BadGateway"
		}
		return http.StatusForbidden, "SignatureDoesNotMatch"
	})

	rec := f.run(uploadGraph("srv1", okConfig(), false))
	if rec.Status != "failed" {
		t.Fatalf("status = %q", rec.Status)
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
		"run record": string(raw),
		"history":    string(history),
		"events":     f.events.text(),
		"console":    f.console("srv1"),
		"log":        logs.buf.String(),
	}
	for name, text := range surfaces {
		if strings.Contains(text, testSecret) {
			t.Errorf("%s carries the secret:\n%s", name, text)
		}
	}
	if !strings.Contains(string(raw), "redacted") {
		t.Errorf("the echoed secret was dropped silently rather than marked: %s", raw)
	}
	// The secret file itself is the one place it lives, and is the only one.
	err = filepath.Walk(f.dataDir, func(p string, info os.FileInfo, werr error) error {
		if werr != nil || info.IsDir() {
			return werr
		}
		data, rerr := os.ReadFile(p)
		if rerr != nil {
			return rerr
		}
		inSecrets := strings.Contains(filepath.ToSlash(p), "/"+destinationSecretsDir+"/")
		if strings.Contains(string(data), testSecret) && !inSecrets {
			t.Errorf("%s holds the secret outside %s", p, destinationSecretsDir)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// --- validation ---

func TestUploadRunFailsBeforeAnythingRunsWhenTheDestinationIsGone(t *testing.T) {
	f := newUploadFixture(t)
	var visited []string
	registerTestMarker(f.s.registry, &visited)

	tests := []struct {
		name string
		cfg  map[string]interface{}
		want string
	}{
		{"no destination", map[string]interface{}{"source": "world"}, "no destination chosen"},
		{"blank destination", map[string]interface{}{"destination": "  ", "source": "world"}, "no destination chosen"},
		{"unknown destination", map[string]interface{}{"destination": "Old bucket", "source": "world"}, `"Old bucket" does not exist`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rec := f.run(uploadGraph("srv1", tc.cfg, true))
			if rec.Status != "failed" || !strings.Contains(rec.Error, "destination validation failed") || !strings.Contains(rec.Error, tc.want) {
				t.Fatalf("record = %q %q, want a validation failure containing %q", rec.Status, rec.Error, tc.want)
			}
			if len(rec.Nodes) != 0 || len(visited) != 0 {
				t.Errorf("nodes ran: %v %v", rec.Nodes, visited)
			}
		})
	}
	if n := len(f.bucket.recorded()); n != 0 {
		t.Errorf("%d requests for runs that were refused", n)
	}
}

func TestUploadRunFailsWhenTheDestinationWasDeletedAfterTheGraphWasSaved(t *testing.T) {
	f := newUploadFixture(t)
	g := uploadGraph("srv1", okConfig(), false)
	if _, err := f.s.SaveGraph("srv1", g); err != nil {
		t.Fatal(err)
	}
	list, err := f.dests.List()
	if err != nil || len(list) != 1 {
		t.Fatalf("destinations = %v, %v", list, err)
	}
	if err := f.dests.Delete(list[0].ID); err != nil {
		t.Fatal(err)
	}

	rec, err := f.s.RunGraphNow("srv1", "up")
	if err != nil {
		t.Fatal(err)
	}
	if rec.Status != "failed" || !strings.Contains(rec.Error, `"R2" does not exist`) {
		t.Fatalf("record = %q %q", rec.Status, rec.Error)
	}
	hist, err := f.s.GetRunHistory("srv1")
	if err != nil || len(hist) != 1 || hist[0].Error != rec.Error {
		t.Errorf("history = %+v, %v; want the refused run recorded", hist, err)
	}
}

func TestExecUploadRefusesWithoutADestinationItself(t *testing.T) {
	f := newUploadFixture(t)
	for name, cfg := range map[string]map[string]interface{}{
		"none":    {"source": "world"},
		"deleted": {"destination": "Gone", "source": "world"},
	} {
		res, _ := f.exec("srv1", cfg)
		if res.Port != "onFailed" || res.Err == nil {
			t.Errorf("%s: result = %+v, want onFailed", name, res)
		}
	}
	// A scheduler built without destinations reports it rather than panicking.
	res := execUpload(&ExecContext{Ctx: context.Background(), ServerID: "srv1", Config: okConfig(), svc: serviceDeps{}, dataOut: map[string]interface{}{}})
	if res.Port != "onFailed" || res.Err == nil {
		t.Errorf("no services: %+v", res)
	}
}

func TestGraphWarningsReportsAnUploadWithNowhereToGo(t *testing.T) {
	f := newUploadFixture(t)
	got, err := f.s.GraphWarnings("srv1", uploadGraph("srv1", map[string]interface{}{"destination": "Gone", "source": "world"}, false))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || !strings.Contains(got[0], `"Gone" does not exist`) {
		t.Errorf("warnings = %q", got)
	}
	got, err = f.s.GraphWarnings("srv1", uploadGraph("srv1", okConfig(), false))
	if err != nil || len(got) != 0 {
		t.Errorf("a good destination: warnings = %q, %v", got, err)
	}
}

func TestValidateGraphDestinations(t *testing.T) {
	f := newUploadFixture(t)
	node := func(cfg map[string]interface{}) models.Graph { return uploadGraph("srv1", cfg, false) }

	tests := []struct {
		name  string
		g     models.Graph
		dests *DestinationService
		want  string // empty means clean
	}{
		{"saved destination", node(okConfig()), f.dests, ""},
		{"matches ignoring case", node(map[string]interface{}{"destination": "r2"}), f.dests, ""},
		{"empty", node(map[string]interface{}{"destination": ""}), f.dests, "no destination chosen"},
		{"absent key", node(map[string]interface{}{}), f.dests, "no destination chosen"},
		{"not a string", node(map[string]interface{}{"destination": 7.0}), f.dests, "no destination chosen"},
		{"unknown", node(map[string]interface{}{"destination": "Other"}), f.dests, `"Other" does not exist`},
		{"no service", node(okConfig()), nil, "not available"},
		{"a graph without upload nodes", probeGraph("g", "srv1"), f.dests, ""},
	}
	reg := f.s.registry
	registerServerProbe(reg, new([]string))
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			issues := validateGraphDestinations(tc.g, reg, tc.dests)
			if tc.want == "" {
				if len(issues) != 0 {
					t.Fatalf("issues = %q, want none", issues)
				}
				return
			}
			if len(issues) != 1 || !strings.Contains(issues[0], tc.want) || !strings.Contains(issues[0], "Upload to Bucket (u1)") {
				t.Fatalf("issues = %q, want one naming the node and containing %q", issues, tc.want)
			}
		})
	}

	// A destinations file that cannot be read is reported, not mistaken for an
	// empty list.
	if err := os.WriteFile(filepath.Join(f.dataDir, destinationsFile), []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	issues := validateGraphDestinations(node(okConfig()), reg, f.dests)
	if len(issues) != 1 || !strings.Contains(issues[0], "could not be read") {
		t.Errorf("corrupt list: issues = %q", issues)
	}
}

// --- where a source may come from ---

func TestUploadBlockRefusesSourcesOutsideTheServersFolders(t *testing.T) {
	f := newUploadFixture(t)
	writeFile(t, filepath.Join(f.dataDir, "backups", "srv1", "server", "full.zip"), "zip")
	writeFile(t, filepath.Join(f.dataDir, "backups", "srv2", "server", "other.zip"), "zip")
	writeFile(t, filepath.Join(f.dataDir, "remote.json"), `{"passwordHash":"x"}`)
	home := t.TempDir()
	writeFile(t, filepath.Join(home, ".ssh", "id_rsa"), "private")

	secretFile := filepath.Join(f.dataDir, destinationSecretsDir)
	tests := []struct {
		name    string
		server  string
		source  string
		allowed bool
	}{
		{"its own folder", "srv1", "world", true},
		{"its own backups", "srv1", filepath.Join(f.dataDir, "backups", "srv1"), true},
		{"a path up and out", "srv1", filepath.Join("..", ".."), false},
		{"another folder on disk", "srv1", filepath.Join(home, ".ssh"), false},
		{"a file on disk", "srv1", filepath.Join(home, ".ssh", "id_rsa"), false},
		{"another server's folder", "srv1", f.workB, false},
		{"another server's backups", "srv1", filepath.Join(f.dataDir, "backups", "srv2"), false},
		{"the whole data directory", "srv1", f.dataDir, false},
		{"the secret access keys", "srv1", secretFile, false},
		{"the remote access file", "srv1", filepath.Join(f.dataDir, "remote.json"), false},
		{"the other server, from its own side", "srv2", f.workA, false},
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
}

func TestUploadBlockRefusesASymlinkThatReachesOut(t *testing.T) {
	f := newUploadFixture(t)
	home := t.TempDir()
	writeFile(t, filepath.Join(home, ".ssh", "id_rsa"), "private")
	if err := os.Symlink(filepath.Join(home, ".ssh"), filepath.Join(f.workA, "innocent")); err != nil {
		t.Skipf("symlinks unavailable here: %v", err)
	}
	if err := os.Symlink(filepath.Join(home, ".ssh", "id_rsa"), filepath.Join(f.workA, "world", "note.txt")); err != nil {
		t.Fatal(err)
	}

	for _, source := range []string{"innocent", "world", "."} {
		before := len(f.bucket.recorded())
		res, _ := f.exec("srv1", map[string]interface{}{"destination": "R2", "source": source})
		if res.Port != "onFailed" || res.Err == nil || !strings.Contains(res.Err.Error(), "outside") {
			t.Errorf("source %q: result = %+v, want a refusal", source, res)
		}
		if n := len(f.bucket.recorded()) - before; n != 0 {
			t.Errorf("source %q: %d requests went out; the folder holds a link out and nothing may be sent", source, n)
		}
	}
	for k := range f.bucket.snapshot() {
		t.Errorf("the bucket holds %s", k)
	}
}

func TestUploadBlockReadsTheWorkingDirectoryOfTheRunsServer(t *testing.T) {
	f := newUploadFixture(t)
	// The same relative source, two servers: each gets its own files, and the
	// graph has no way to name the other's folder.
	if res, _ := f.exec("srv1", okConfig()); res.Err != nil {
		t.Fatal(res.Err)
	}
	if res, _ := f.exec("srv2", okConfig()); res.Err != nil {
		t.Fatal(res.Err)
	}
	if got := string(f.bucket.object("dh/snap/level.dat")); got != "level-b-secret-world" {
		t.Errorf("the second server's run left %q, want its own file", got)
	}
	if f.bucket.object("dh/snap/region/r.0.0.mca") == nil {
		t.Error("the first server's run uploaded nothing")
	}

	res, _ := f.exec("no-such-server", okConfig())
	if res.Port != "onFailed" || res.Err == nil {
		t.Errorf("an unknown server: %+v", res)
	}
}

// --- limits ---

func TestUploadBlockRefusesAFileOverTheLimitBeforeSendingAnything(t *testing.T) {
	old := maxUploadObjectBytes
	maxUploadObjectBytes = 7
	t.Cleanup(func() { maxUploadObjectBytes = old })

	f := newUploadFixture(t)
	res, _ := f.exec("srv1", okConfig()) // region-a is 8 bytes, level-a is 7
	if res.Port != "onFailed" || res.Err == nil {
		t.Fatalf("result = %+v", res)
	}
	for _, want := range []string{"r.0.0.mca", "5 GiB", "nothing was uploaded"} {
		if !strings.Contains(res.Err.Error(), want) {
			t.Errorf("error %q lacks %q", res.Err, want)
		}
	}
	if n := len(f.bucket.recorded()); n != 0 {
		t.Errorf("%d requests went out; level.dat sorts first and must not have gone alone", n)
	}
}

func TestUploadBlockStopsWhenItsContextEnds(t *testing.T) {
	f := newUploadFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	res := execUpload(&ExecContext{Ctx: ctx, ServerID: "srv1", Config: okConfig(), svc: f.s.deps, dataOut: map[string]interface{}{}})
	if res.Port != "onFailed" || res.Err == nil {
		t.Fatalf("result = %+v, want onFailed", res)
	}
	if n := len(f.bucket.requestsOf(http.MethodPut)); n != 0 {
		t.Errorf("%d PUTs after the run was cancelled", n)
	}
}

func TestUploadBlockBadPrefixFailsTheNode(t *testing.T) {
	f := newUploadFixture(t)
	cfg := okConfig()
	cfg["prefix"] = "../elsewhere"
	res, _ := f.exec("srv1", cfg)
	if res.Port != "onFailed" || res.Err == nil || !strings.Contains(res.Err.Error(), "..") {
		t.Errorf("result = %+v", res)
	}
}
