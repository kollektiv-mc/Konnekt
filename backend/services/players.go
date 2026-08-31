package services

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"konnekt/backend/models"
)

type PlayerService struct {
	config *ConfigService
	server *ServerService
	rcon   *RconService // reserved for Phase 3 (LuckPerms)
}

func NewPlayerService(cfg *ConfigService, srv *ServerService, rcon *RconService) *PlayerService {
	return &PlayerService{config: cfg, server: srv, rcon: rcon}
}

type opsEntry struct {
	UUID  string `json:"uuid"`
	Name  string `json:"name"`
	Level int    `json:"level"`
}

type whitelistEntry struct {
	UUID string `json:"uuid"`
	Name string `json:"name"`
}

type bannedPlayerEntry struct {
	UUID   string `json:"uuid"`
	Name   string `json:"name"`
	Reason string `json:"reason"`
}

func loadJSON[T any](path string) []T {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var out []T
	_ = json.Unmarshal(data, &out) //nolint:errcheck // intentional degrade-to-empty: out stays its nil zero value on parse failure
	return out
}

func opsIndex(entries []opsEntry) map[string]opsEntry {
	m := make(map[string]opsEntry, len(entries))
	for _, e := range entries {
		m[strings.ToLower(e.Name)] = e
	}
	return m
}

func whitelistIndex(entries []whitelistEntry) map[string]struct{} {
	m := make(map[string]struct{}, len(entries))
	for _, e := range entries {
		m[strings.ToLower(e.Name)] = struct{}{}
	}
	return m
}

func banIndex(entries []bannedPlayerEntry) map[string]bannedPlayerEntry {
	m := make(map[string]bannedPlayerEntry, len(entries))
	for _, e := range entries {
		m[strings.ToLower(e.Name)] = e
	}
	return m
}

func (s *PlayerService) workingDir(serverID string) (string, error) {
	cfg, err := s.config.GetServerConfig(serverID)
	if err != nil {
		return "", err
	}
	return cfg.WorkingDir, nil
}

func decorate(p *models.Player, dir string, ops map[string]opsEntry, wl map[string]struct{}, bans map[string]bannedPlayerEntry) {
	key := strings.ToLower(p.Name)
	if op, ok := ops[key]; ok {
		p.OpLevel = op.Level
	}
	if _, ok := wl[key]; ok {
		p.Whitelisted = true
	}
	if ban, ok := bans[key]; ok {
		p.Banned = true
		p.BanReason = ban.Reason
	}
	// last online from playerdata/<uuid>.dat mtime
	if p.UUID != "" && !p.Online {
		datPath := filepath.Join(dir, "world", "playerdata", p.UUID+".dat")
		if info, err := os.Stat(datPath); err == nil {
			p.LastOnline = info.ModTime().UnixMilli()
		}
	}
}

// GetRoster returns all online players enriched with OP/whitelist/ban status.
func (s *PlayerService) GetRoster(serverID string) ([]models.Player, error) {
	dir, err := s.workingDir(serverID)
	if err != nil {
		return nil, err
	}

	ops := opsIndex(loadJSON[opsEntry](filepath.Join(dir, "ops.json")))
	wl := whitelistIndex(loadJSON[whitelistEntry](filepath.Join(dir, "whitelist.json")))
	bans := banIndex(loadJSON[bannedPlayerEntry](filepath.Join(dir, "banned-players.json")))

	online := s.server.GetActivePlayers(serverID)
	result := make([]models.Player, 0, len(online))
	for _, p := range online {
		decorate(&p, dir, ops, wl, bans)
		result = append(result, p)
	}
	return result, nil
}

// GetDetail returns detail for a single player (online or offline stub).
func (s *PlayerService) GetDetail(serverID, name string) (models.Player, error) {
	dir, err := s.workingDir(serverID)
	if err != nil {
		return models.Player{}, err
	}

	ops := opsIndex(loadJSON[opsEntry](filepath.Join(dir, "ops.json")))
	wl := whitelistIndex(loadJSON[whitelistEntry](filepath.Join(dir, "whitelist.json")))
	bans := banIndex(loadJSON[bannedPlayerEntry](filepath.Join(dir, "banned-players.json")))

	var p models.Player
	for _, op := range s.server.GetActivePlayers(serverID) {
		if strings.EqualFold(op.Name, name) {
			p = op
			break
		}
	}
	if p.Name == "" {
		p.Name = name
	}

	decorate(&p, dir, ops, wl, bans)
	return p, nil
}
