package services

import (
	"context"
	"slices"
	"testing"
)

func modpackExec(s *ModService) *ExecContext {
	return &ExecContext{
		Ctx: context.Background(), ServerID: testServerID,
		Config: map[string]interface{}{}, dataOut: map[string]interface{}{},
		svc: serviceDeps{mods: s},
	}
}

func TestModpackBlocksCheckSyncThenReportUpToDate(t *testing.T) {
	s, workDir, packDir := newSyncFixture(t, "21.1.252")
	m := packMod{key: "create", file: "create-1.jar", jar: neoJar(t, "create", "1"), projectID: "P"}
	cdn := cdnFor(t, m)
	allowDownloads(s, cdn)
	writePack(t, packDir, "1.0.0", cdn.URL, []packMod{m}, nil)
	bindFolder(t, s, packDir, nil, nil)

	check := modpackExec(s)
	if res := execModpackCheck(check); res.Port != "onUpdate" || res.Err != nil {
		t.Fatalf("check = %+v, want onUpdate", res)
	}
	if check.dataOut["newVersion"] != "1.0.0" || check.dataOut["changes"] != float64(1) {
		t.Fatalf("check outputs = %v", check.dataOut)
	}

	sync := modpackExec(s)
	if res := execModpackSync(sync); res.Port != "onComplete" || res.Err != nil {
		t.Fatalf("sync = %+v, want onComplete", res)
	}
	if sync.dataOut["added"] != float64(1) || sync.dataOut["version"] != "1.0.0" {
		t.Fatalf("sync outputs = %v", sync.dataOut)
	}
	if got := modsOnDisk(t, workDir); !slices.Equal(got, []string{"create-1.jar"}) {
		t.Fatalf("mods/ = %v", got)
	}

	again := modpackExec(s)
	if res := execModpackCheck(again); res.Port != "onUpToDate" {
		t.Fatalf("second check = %+v, want onUpToDate", res)
	}
	if again.dataOut["version"] != "1.0.0" {
		t.Fatalf("applied version = %v, want 1.0.0", again.dataOut["version"])
	}
	if res := execModpackSync(modpackExec(s)); res.Port != "onUpToDate" {
		t.Fatalf("second sync = %+v, want onUpToDate", res)
	}
}

func TestModpackSyncFailsOnABlocker(t *testing.T) {
	s, workDir, packDir := newSyncFixture(t, "21.1.249")
	m := packMod{key: "create", file: "create-1.jar", jar: neoJar(t, "create", "1")}
	cdn := cdnFor(t, m)
	allowDownloads(s, cdn)
	writePack(t, packDir, "1.0.0", cdn.URL, []packMod{m}, nil)
	bindFolder(t, s, packDir, nil, nil)

	if res := execModpackSync(modpackExec(s)); res.Port != "onFailed" || res.Err == nil {
		t.Fatalf("sync = %+v, want onFailed on the loader mismatch", res)
	}
	if got := modsOnDisk(t, workDir); len(got) != 0 {
		t.Fatalf("mods/ = %v, want untouched", got)
	}
}

func TestModpackBlocksFailWithoutTheModService(t *testing.T) {
	for _, run := range []ExecFunc{execModpackCheck, execModpackSync} {
		if res := run(modpackExec(nil)); res.Port != "onFailed" || res.Err == nil {
			t.Fatalf("got %+v, want onFailed", res)
		}
	}
}
