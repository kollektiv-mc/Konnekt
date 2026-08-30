package services

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"konnekt/backend/models"
)

type ConfigService struct {
	dataDir string
}

func NewConfigService() *ConfigService {
	return &ConfigService{}
}

func (s *ConfigService) SetDataDir(dir string) {
	s.dataDir = dir
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

func (s *ConfigService) SaveServerConfig(cfg models.ServerConfig) error {
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
	return s.writeServerConfigs(configs)
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
	return s.writeServerConfigs(filtered)
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
