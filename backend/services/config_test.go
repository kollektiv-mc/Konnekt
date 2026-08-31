package services

import (
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"konnekt/backend/models"
)

// newTestConfigService points a ConfigService at a data directory that does not
// exist yet — the state a first run is in before startup's MkdirAll, and the
// state any run is in if that MkdirAll failed. Every save below therefore also
// asserts that the writer creates its own directory.
func newTestConfigService(t *testing.T) *ConfigService {
	t.Helper()
	s := NewConfigService()
	s.SetDataDir(filepath.Join(t.TempDir(), "konnekt"))
	return s
}

func TestServerConfigsRoundTripThroughAMissingDataDir(t *testing.T) {
	s := newTestConfigService(t)

	configs, err := s.GetServerConfigs()
	if err != nil {
		t.Fatalf("GetServerConfigs on a fresh install: %v", err)
	}
	if len(configs) != 0 {
		t.Errorf("fresh install = %v, want no servers", configs)
	}

	want := models.ServerConfig{
		ID:         "srv1",
		Name:       "Survival",
		JarPath:    filepath.Join("servers", "survival", "server.jar"),
		JvmArgs:    []string{"-Xmx4G"},
		WorkingDir: filepath.Join("servers", "survival"),
		MCVersion:  "1.20.1",
		Loader:     "paper",
	}
	if err := s.SaveServerConfig(want); err != nil {
		t.Fatalf("SaveServerConfig: %v", err)
	}

	got, err := s.GetServerConfig("srv1")
	if err != nil {
		t.Fatalf("GetServerConfig: %v", err)
	}
	// ServerConfig carries a slice field, so it is not comparable with ==.
	if !reflect.DeepEqual(*got, want) {
		t.Errorf("round trip = %+v, want %+v", *got, want)
	}
}

func TestSaveServerConfigUpsertsByID(t *testing.T) {
	s := newTestConfigService(t)

	if err := s.SaveServerConfig(models.ServerConfig{ID: "srv1", Name: "Old"}); err != nil {
		t.Fatalf("first save: %v", err)
	}
	if err := s.SaveServerConfig(models.ServerConfig{ID: "srv1", Name: "New"}); err != nil {
		t.Fatalf("second save: %v", err)
	}
	if err := s.SaveServerConfig(models.ServerConfig{ID: "srv2", Name: "Other"}); err != nil {
		t.Fatalf("third save: %v", err)
	}

	configs, err := s.GetServerConfigs()
	if err != nil {
		t.Fatalf("GetServerConfigs: %v", err)
	}
	if len(configs) != 2 {
		t.Fatalf("configs = %+v, want 2 entries", configs)
	}
	if configs[0].Name != "New" {
		t.Errorf("srv1 name = %q, want the updated %q", configs[0].Name, "New")
	}
}

func TestDeleteServerConfigLeavesTheOthers(t *testing.T) {
	s := newTestConfigService(t)

	for _, id := range []string{"srv1", "srv2", "srv3"} {
		if err := s.SaveServerConfig(models.ServerConfig{ID: id, Name: id}); err != nil {
			t.Fatalf("save %s: %v", id, err)
		}
	}
	if err := s.DeleteServerConfig("srv2"); err != nil {
		t.Fatalf("DeleteServerConfig: %v", err)
	}

	configs, err := s.GetServerConfigs()
	if err != nil {
		t.Fatalf("GetServerConfigs: %v", err)
	}
	if len(configs) != 2 {
		t.Fatalf("configs = %+v, want 2 entries", configs)
	}
	for _, c := range configs {
		if c.ID == "srv2" {
			t.Errorf("srv2 survived the delete: %+v", configs)
		}
	}
	if _, err := s.GetServerConfig("srv2"); err == nil {
		t.Error("GetServerConfig(\"srv2\") = nil error, want a not-found error")
	}
}

func TestActiveServerIDRoundTripsThroughAMissingDataDir(t *testing.T) {
	s := newTestConfigService(t)

	id, err := s.GetActiveServerID()
	if err != nil {
		t.Fatalf("GetActiveServerID on a fresh install: %v", err)
	}
	if id != "" {
		t.Errorf("fresh install = %q, want empty", id)
	}

	if err := s.SetActiveServerID("srv1"); err != nil {
		t.Fatalf("SetActiveServerID: %v", err)
	}
	if id, err = s.GetActiveServerID(); err != nil || id != "srv1" {
		t.Errorf("GetActiveServerID = (%q, %v), want (\"srv1\", nil)", id, err)
	}
}

// A missing app_settings.json must read as the full default set rather than a
// zero AppSettings — a zero ConsoleBufferLines would give the console tile an
// unbounded (or empty) buffer, and a zero theme an unstyled app.
func TestAppSettingsFallBackToDefaultsThenRoundTrip(t *testing.T) {
	s := newTestConfigService(t)

	defaults, err := s.GetAppSettings()
	if err != nil {
		t.Fatalf("GetAppSettings on a fresh install: %v", err)
	}
	if defaults.Theme != "dark" || defaults.ConsoleBufferLines != 1000 {
		t.Errorf("defaults = %+v, want theme dark and a 1000-line console buffer", defaults)
	}

	saved := defaults
	saved.Theme = "light"
	saved.ConsoleBufferLines = 250
	if err := s.SaveAppSettings(saved); err != nil {
		t.Fatalf("SaveAppSettings: %v", err)
	}

	got, err := s.GetAppSettings()
	if err != nil {
		t.Fatalf("GetAppSettings after save: %v", err)
	}
	if got.Theme != "light" || got.ConsoleBufferLines != 250 {
		t.Errorf("round trip = %+v, want theme light and a 250-line console buffer", got)
	}
}

// A settings file written by an older build is missing the keys added since.
// Those must come back as their defaults, not as Go zero values, because
// GetAppSettings unmarshals *onto* the default struct.
func TestAppSettingsFillGapsInAnOlderFileWithDefaults(t *testing.T) {
	s := newTestConfigService(t)
	if err := WriteDataFile(s.dataDir, "app_settings.json", []byte(`{"theme":"light"}`)); err != nil {
		t.Fatalf("setup: %v", err)
	}

	got, err := s.GetAppSettings()
	if err != nil {
		t.Fatalf("GetAppSettings: %v", err)
	}
	if got.Theme != "light" {
		t.Errorf("theme = %q, want the stored %q", got.Theme, "light")
	}
	if got.ConsoleBufferLines != 1000 {
		t.Errorf("ConsoleBufferLines = %d, want the default 1000 for a key the file lacks", got.ConsoleBufferLines)
	}
	if !got.CheckUpdatesOnStartup {
		t.Error("CheckUpdatesOnStartup = false, want the default true for a key the file lacks")
	}
	if got.StopGraceSeconds != 60 {
		t.Errorf("StopGraceSeconds = %d, want the default 60 for a key the file lacks", got.StopGraceSeconds)
	}
	// The frontend resolves a 0 to the same default, so this is the second of
	// two belts rather than the only one. It is here because the file written
	// back by the next SaveAppSettings carries whatever came out of here, and
	// a 0 persisted once is a 0 every launch after.
	if got.NavWidth != DefaultNavWidth {
		t.Errorf("NavWidth = %d, want the default %d for a key the file lacks", got.NavWidth, DefaultNavWidth)
	}
	// The navbar opens on Servers and Tiles and folds Widgets and Layouts away.
	// Only the closed ones are named: a key that is not there is open, so this
	// map is the whole first-run shape and asserting it whole is what catches a
	// section quietly changing sides.
	want := map[string]bool{"widgets": true, "layouts": true}
	if !reflect.DeepEqual(got.NavClosedSections, want) {
		t.Errorf("NavClosedSections = %v, want %v for a key the file lacks", got.NavClosedSections, want)
	}
}

// StopGrace is the duration form Stop's callers pass down; on a fresh install
// it is the 60-second default.
func TestStopGraceConvertsSecondsToDuration(t *testing.T) {
	s := newTestConfigService(t)
	if got := s.StopGrace(); got != 60*time.Second {
		t.Errorf("StopGrace() = %s, want 60s", got)
	}
}

// The Minecraft version and loader filter every Modrinth query, and a value
// that is not a Minecraft version filters all of them away while Modrinth still
// answers 200 — an empty mods tile with no error anywhere. Refusing the pair on
// the way in is what stops it being stored a second time, whether it came from
// detection or from someone typing it into the editor.
func TestSaveServerConfigRefusesAnImpossibleVersionPair(t *testing.T) {
	s := newTestConfigService(t)

	// The shape a NeoForge installer's version.json used to leave behind.
	if err := s.SaveServerConfig(models.ServerConfig{
		ID:        "srv1",
		Name:      "smp",
		MCVersion: "neoforge-21.1.233",
		Loader:    "vanilla",
	}); err != nil {
		t.Fatalf("save: %v", err)
	}

	got, err := s.GetServerConfig("srv1")
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if got.MCVersion != "" || got.Loader != "" {
		t.Errorf("stored (%q, %q), want both dropped so detection can re-derive them",
			got.MCVersion, got.Loader)
	}
	if got.Name != "smp" {
		t.Errorf("Name = %q, want the rest of the config untouched", got.Name)
	}
}

func TestSaveServerConfigKeepsAPlausibleVersionPair(t *testing.T) {
	s := newTestConfigService(t)

	if err := s.SaveServerConfig(models.ServerConfig{
		ID: "srv1", MCVersion: "1.21.1", Loader: "neoforge",
	}); err != nil {
		t.Fatalf("save: %v", err)
	}

	got, err := s.GetServerConfig("srv1")
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if got.MCVersion != "1.21.1" || got.Loader != "neoforge" {
		t.Errorf("stored (%q, %q), want it kept verbatim", got.MCVersion, got.Loader)
	}
}
