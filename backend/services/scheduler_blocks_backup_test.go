package services

import (
	"path/filepath"
	"strings"
	"testing"
)

// ─── action.backup targets (#25) ───────────────────────────────────────────
//
// The block used to take no config and always zipped the whole server, while
// its description promised the world. These pin both targets, and that a graph
// saved before the field existed (no target at all) keeps the old behaviour.

func TestExecBackupTargets(t *testing.T) {
	cases := []struct {
		name       string
		config     map[string]interface{}
		level      string // level-name written to server.properties; "" omits the file
		makeWorld  bool   // whether the level-name folder exists on disk
		wantPort   string
		wantKind   string
		wantWorld  string
		wantErrHas string
	}{
		{name: "missing target backs up the full server", config: map[string]interface{}{},
			level: "survival", makeWorld: true, wantPort: "onComplete", wantKind: "server"},
		{name: "empty target backs up the full server", config: map[string]interface{}{"target": ""},
			level: "survival", makeWorld: true, wantPort: "onComplete", wantKind: "server"},
		{name: "server target backs up the full server", config: map[string]interface{}{"target": "server"},
			level: "survival", makeWorld: true, wantPort: "onComplete", wantKind: "server"},
		{name: "active-world backs up the level-name world", config: map[string]interface{}{"target": "active-world"},
			level: "survival", makeWorld: true, wantPort: "onComplete", wantKind: "world", wantWorld: "survival"},
		{name: "active-world falls back to the default world name", config: map[string]interface{}{"target": "active-world"},
			level: "", makeWorld: false, wantPort: "onComplete", wantKind: "world", wantWorld: "world"},
		{name: "active-world with no world folder fails", config: map[string]interface{}{"target": "active-world"},
			level: "missing", makeWorld: false, wantPort: "onFailed", wantErrHas: "not found"},
		{name: "unknown target fails rather than guessing", config: map[string]interface{}{"target": "everything"},
			level: "survival", makeWorld: true, wantPort: "onFailed", wantErrHas: "unknown backup target"},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			svc, workDir := newBackupFixture(t)
			if c.level != "" {
				writeFile(t, filepath.Join(workDir, "server.properties"), "level-name="+c.level)
			}
			// The fixture creates an empty "world" folder; a file in it is
			// what lets the default-name case have something to zip.
			writeFile(t, filepath.Join(workDir, "world", "level.dat"), "default-world")
			if c.makeWorld {
				writeFile(t, filepath.Join(workDir, c.level, "level.dat"), "level-"+c.level)
			}

			ec := &ExecContext{
				ServerID: testServerID,
				Config:   c.config,
				svc:      serviceDeps{backup: svc},
				dataOut:  map[string]interface{}{},
			}
			res := execBackup(ec)

			if res.Port != c.wantPort {
				t.Fatalf("port = %q (err %v), want %q", res.Port, res.Err, c.wantPort)
			}
			if c.wantPort == "onFailed" {
				if res.Err == nil || !strings.Contains(res.Err.Error(), c.wantErrHas) {
					t.Errorf("err = %v, want it to contain %q", res.Err, c.wantErrHas)
				}
				if _, set := ec.dataOut["filename"]; set {
					t.Errorf("filename output set on failure: %v", ec.dataOut["filename"])
				}
				return
			}
			if res.Err != nil {
				t.Fatalf("unexpected error: %v", res.Err)
			}

			filename, ok := ec.dataOut["filename"].(string)
			if !ok || filename == "" {
				t.Fatalf("filename output = %v, want the backup's filename", ec.dataOut["filename"])
			}
			backups, err := svc.ListBackups(testServerID)
			if err != nil {
				t.Fatalf("ListBackups: %v", err)
			}
			if len(backups) != 1 {
				t.Fatalf("got %d backups, want 1: %+v", len(backups), backups)
			}
			got := backups[0]
			if got.Filename != filename {
				t.Errorf("listed filename = %q, output = %q", got.Filename, filename)
			}
			if got.Kind != c.wantKind {
				t.Errorf("Kind = %q, want %q", got.Kind, c.wantKind)
			}
			if got.World != c.wantWorld {
				t.Errorf("World = %q, want %q", got.World, c.wantWorld)
			}
		})
	}
}

func TestBackupBlockDeclaresItsTargetField(t *testing.T) {
	def := commandBlock(t, "action.backup")
	if len(def.ConfigSchema) != 1 {
		t.Fatalf("action.backup has %d config fields, want 1", len(def.ConfigSchema))
	}
	f := def.ConfigSchema[0]
	if f.Key != "target" || f.Type != "select" || f.Default != "server" {
		t.Errorf("field = %+v, want a select keyed target defaulting to server", f)
	}
	var values []string
	for _, o := range f.Options {
		values = append(values, o.Value)
	}
	if strings.Join(values, ",") != "server,active-world" {
		t.Errorf("options = %v, want server and active-world", values)
	}
}
