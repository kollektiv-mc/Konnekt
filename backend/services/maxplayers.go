package services

import (
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"

	"konnekt/backend/models"
)

// defaultMaxPlayers is what a vanilla server.properties ships with, and what
// is shown when nothing better can be read.
const defaultMaxPlayers = 20

var errNoWorkingDir = errors.New("server: no working directory configured")

// propsStamp identifies one version of server.properties cheaply enough to
// check on every status read, so the file is parsed only when it changes.
type propsStamp struct {
	modTime time.Time
	size    int64
}

// diskMaxPlayers caches max-players as last read from a stopped server's
// server.properties. It has its own lock because it does file I/O, which must
// not happen under the instance's mu. A leaf: nothing is acquired inside it.
type diskMaxPlayers struct {
	mu    sync.Mutex
	stamp propsStamp
	value int
}

// SetConfig lets a stopped server find its server.properties. Called once at
// startup, like SetBus; until then, and for an id with no config, the stopped
// figure falls back to what the last boot read.
func (s *ServerService) SetConfig(cfg *ConfigService) {
	s.workingDir = func(serverID string) (string, error) {
		c, err := cfg.GetServerConfig(serverID)
		if err != nil {
			return "", err
		}
		if c.WorkingDir == "" {
			return "", errNoWorkingDir
		}
		return c.WorkingDir, nil
	}
}

// PushStatus emits a fresh server:status for serverID, for a change the 10s
// stats tick would otherwise take up to ten seconds to show.
func (s *ServerService) PushStatus(serverID string) {
	s.bus.Emit(EventServerStatus, models.ServerStatusEvent{ServerStatus: s.Status(serverID), ServerID: serverID})
}

// resolveMaxPlayers is the one answer for max-players. A running server read
// the file at boot and does not re-read it until the next one, so its figure
// is the booted value. A stopped server has no such value that is still true:
// the file may have been edited since, or never read at all because the server
// has not been started from Konnekt this session, so it is read from disk.
func (s *serverInstance) resolveMaxPlayers(running bool, booted int) int {
	if !running {
		if n, ok := s.maxPlayersOnDisk(); ok {
			return n
		}
	}
	if booted == 0 {
		return defaultMaxPlayers
	}
	return booted
}

// maxPlayersOnDisk costs one stat per call, and a parse only when the file's
// size or modification time has moved since the last one. false means the
// file could not be found or read.
func (s *serverInstance) maxPlayersOnDisk() (int, bool) {
	dir, err := s.workingDir(s.id)
	if err != nil {
		return 0, false
	}
	path := filepath.Join(dir, "server.properties")
	info, err := os.Stat(path)
	if err != nil {
		return 0, false
	}
	stamp := propsStamp{modTime: info.ModTime(), size: info.Size()}

	s.diskMax.mu.Lock()
	defer s.diskMax.mu.Unlock()
	if stamp == s.diskMax.stamp {
		return s.diskMax.value, true
	}
	props, err := readProperties(path)
	if err != nil {
		return 0, false
	}
	s.diskMax.stamp = stamp
	s.diskMax.value = propInt(props, "max-players", defaultMaxPlayers)
	return s.diskMax.value, true
}
