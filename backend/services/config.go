package services

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"konnekt/backend/models"
)

type ConfigService struct {
	dataDir string
}

func NewConfigService() *ConfigService {
	return &ConfigService{}
}

// SetDataDir points the service at the app data directory and repairs the active
// server id if it is already dangling on disk (#363). Doing it here rather than
// lazily is what makes the invariant true for everything that reads the id
// afterwards, including the scheduler's own migration: app.go calls this before
// schedulerService.SetDataDir, so the id that migration resolves against has
// already been checked against a real config.
func (s *ConfigService) SetDataDir(dir string) {
	s.dataDir = dir
	if err := s.reconcileActiveServer(); err != nil {
		slog.Error("config: repairing the active server id", "error", err)
	}
}

// reconcileActiveServer enforces the one rule the rest of the app reads this
// file by: active_server.json names a server that exists, or is empty only when
// there are none.
//
// Nothing held that rule before. SetActiveServerID was the only writer and the
// sidebar its only caller, so deleting the server you were on left the file
// naming it, and the frontend store worked the correction out three times over
// without ever writing it back (#363). Go and the UI then disagreed about which
// server was active, silently, until the user happened to click one.
//
// It writes only when the file is actually wrong. A healthy install rewrites
// nothing on launch, the same discipline the scheduler's graph migration holds.
func (s *ConfigService) reconcileActiveServer() error {
	configs, err := s.GetServerConfigs()
	if err != nil {
		return err
	}
	active, err := s.GetActiveServerID()
	if err != nil {
		return err
	}
	for _, c := range configs {
		if c.ID == active {
			return nil
		}
	}
	// The first config, which is what the sidebar's own fallback picks, so the
	// file and the UI land on the same server rather than on two defensible ones.
	next := ""
	if len(configs) > 0 {
		next = configs[0].ID
	}
	if next == active {
		// Both empty: there is nothing to name and nothing to correct. Writing
		// here would create the file just to say so.
		return nil
	}
	return s.SetActiveServerID(next)
}

func (s *ConfigService) GetServerConfigs() ([]models.ServerConfig, error) {
	data, err := os.ReadFile(filepath.Join(s.dataDir, "servers.json"))
	if os.IsNotExist(err) {
		return []models.ServerConfig{}, nil
	}
	if err != nil {
		return nil, err
	}
	var configs []models.ServerConfig
	if err := json.Unmarshal(data, &configs); err != nil {
		return nil, err
	}
	return configs, nil
}

func (s *ConfigService) GetServerConfig(id string) (*models.ServerConfig, error) {
	configs, err := s.GetServerConfigs()
	if err != nil {
		return nil, err
	}
	for i, c := range configs {
		if c.ID == id {
			return &configs[i], nil
		}
	}
	return nil, fmt.Errorf("server config %q not found", id)
}

// validServerID rejects an id that is not one plain path segment. A server id
// is minted in the frontend and joined straight into data-dir paths by the
// backup, mod-manifest, config-backup and loader-snapshot services, so an id
// of "../../x" would point every one of them at a caller-chosen directory
// (#307). Same shape as validateWorldName and validateFilename; called where
// an id is persisted and at every join, since a persisted id is trusted from
// then on. Nothing decodes the id, so a strict check costs nothing.
func validServerID(id string) error {
	if id == "" || id == "." || id == ".." {
		return fmt.Errorf("invalid server id %q", id)
	}
	if id != filepath.Base(id) || strings.ContainsAny(id, `/\`) {
		return fmt.Errorf("invalid server id %q: must be a single path segment", id)
	}
	return nil
}

func (s *ConfigService) SaveServerConfig(cfg models.ServerConfig) error {
	if err := validServerID(cfg.ID); err != nil {
		return err
	}
	// The Minecraft version and loader are what every Modrinth query is filtered
	// by, and a value that is not a Minecraft version filters all of them down to
	// nothing while Modrinth still answers 200 — a failure with no error to show.
	// Rejecting the pair on the way in means it cannot be stored again, from
	// detection or from the editor, whatever either of them believes.
	cfg.MCVersion, cfg.Loader = sanitizeTarget(cfg.MCVersion, cfg.Loader)

	configs, err := s.GetServerConfigs()
	if err != nil {
		return err
	}
	for i, c := range configs {
		if c.ID == cfg.ID {
			configs[i] = cfg
			return s.writeServerConfigs(configs)
		}
	}
	configs = append(configs, cfg)
	if err := s.writeServerConfigs(configs); err != nil {
		return err
	}
	// A first server adopts the empty active id, so the backend agrees with the
	// sidebar, which has always selected it (#363).
	return s.reconcileActiveServer()
}

func (s *ConfigService) DeleteServerConfig(id string) error {
	configs, err := s.GetServerConfigs()
	if err != nil {
		return err
	}
	filtered := configs[:0]
	for _, c := range configs {
		if c.ID != id {
			filtered = append(filtered, c)
		}
	}
	if err := s.writeServerConfigs(filtered); err != nil {
		return err
	}
	// Deleting the server you are on used to leave the active id naming it
	// (#363), which is the state everything downstream reads as a real server.
	return s.reconcileActiveServer()
}

func (s *ConfigService) writeServerConfigs(configs []models.ServerConfig) error {
	data, err := json.Marshal(configs)
	if err != nil {
		return err
	}
	return WriteDataFile(s.dataDir, "servers.json", data)
}

func (s *ConfigService) GetActiveServerID() (string, error) {
	data, err := os.ReadFile(filepath.Join(s.dataDir, "active_server.json"))
	if os.IsNotExist(err) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	var id string
	if err := json.Unmarshal(data, &id); err != nil {
		return "", err
	}
	return id, nil
}

func (s *ConfigService) SetActiveServerID(id string) error {
	data, err := json.Marshal(id)
	if err != nil {
		return err
	}
	return WriteDataFile(s.dataDir, "active_server.json", data)
}

// DefaultNavWidth is the left navbar's width in CSS pixels for a settings file
// that has never carried one. It matches the frontend's NAV_WIDTH_DEFAULT
// (frontend/src/lib/navWidth.ts), which is what a reset falls back to; the two
// are separate constants because neither side can import the other's.
const DefaultNavWidth = 192

func (s *ConfigService) GetAppSettings() (models.AppSettings, error) {
	defaults := models.AppSettings{
		Theme:                            "dark",
		SkinId:                           "default",
		AccentColor:                      "#4ade80",
		SuccessColor:                     "#22c55e",
		WarningColor:                     "#f59e0b",
		DangerColor:                      "#f87171",
		BackgroundStyle:                  "solid",
		StopGraceSeconds:                 60,
		ConsoleBufferLines:               1000,
		SchedulerPaletteCollapsed:        true,
		SchedulerPaletteClosedCategories: map[string]bool{},
		NavClosedSections:                map[string]bool{"widgets": true, "layouts": true},
		CheckUpdatesOnStartup:            true,
		UpdateChannel:                    UpdateChannelStable,
		NavWidth:                         DefaultNavWidth,
	}
	data, err := os.ReadFile(filepath.Join(s.dataDir, "app_settings.json"))
	if os.IsNotExist(err) {
		return defaults, nil
	}
	if err != nil {
		return defaults, err
	}
	settings := defaults
	if err := json.Unmarshal(data, &settings); err != nil {
		return defaults, err
	}
	return settings, nil
}

// StopGrace returns the configured stop grace as a duration, for the callers
// that pass it into ServerService.Stop/Restart. Settings unreadable → 0,
// which stop() maps to its own default.
func (s *ConfigService) StopGrace() time.Duration {
	settings, err := s.GetAppSettings()
	if err != nil {
		return 0
	}
	return time.Duration(settings.StopGraceSeconds) * time.Second
}

func (s *ConfigService) SaveAppSettings(settings models.AppSettings) error {
	data, err := json.Marshal(settings)
	if err != nil {
		return err
	}
	return WriteDataFile(s.dataDir, "app_settings.json", data)
}
