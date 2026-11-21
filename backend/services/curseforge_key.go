package services

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"konnekt/backend/models"
)

// curseForgeBuiltInKey is Konnekt's own CurseForge API key. It is empty in the
// source and in every build until Overwolf approves a key for Konnekt; a
// release build would then set it with
//
//	-ldflags "-X konnekt/backend/services.curseForgeBuiltInKey=$CURSEFORGE_API_KEY"
//
// from a CI secret. A key the user saves in Settings takes precedence, so a
// revoked or rate-limited built-in key never locks anyone out.
var curseForgeBuiltInKey = ""

// curseForgeKeyFile holds the key the user saved, owner-only in the data dir
// (agent_docs/SECURITY_CHECKLIST.md § S2.2), and separate from settings.json
// because GetAppSettings is readable over Remote Access and this is a
// credential.
const curseForgeKeyFile = "curseforge_api_key"

// curseForgeKeyCheckTimeout bounds the one request a save makes to check the key.
const curseForgeKeyCheckTimeout = 15 * time.Second

// curseForgeAPIKey is the key every CurseForge request and download carries:
// the saved one, else the built-in one, else "".
func (s *ModService) curseForgeAPIKey() string {
	s.cfKeyMu.Lock()
	defer s.cfKeyMu.Unlock()
	if !s.cfKeyLoaded {
		s.cfKey = s.readCurseForgeKeyLocked()
		s.cfKeyLoaded = true
	}
	if s.cfKey != "" {
		return s.cfKey
	}
	return curseForgeBuiltInKey
}

func (s *ModService) readCurseForgeKeyLocked() string {
	if s.dataDir == "" {
		return ""
	}
	data, err := os.ReadFile(filepath.Join(s.dataDir, curseForgeKeyFile))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

// CurseForgeStatus says whether CurseForge is usable and where its key comes
// from, never what the key is.
func (s *ModService) CurseForgeStatus() models.CurseForgeStatus {
	s.curseForgeAPIKey() // loads the saved key on first use
	s.cfKeyMu.Lock()
	defer s.cfKeyMu.Unlock()
	return models.CurseForgeStatus{KeySet: s.cfKey != "", BuiltIn: curseForgeBuiltInKey != ""}
}

// validCurseForgeKey refuses what cannot be a key before it is sent anywhere:
// it travels in a header, so a control character or a newline would at best
// fail the request and at worst split it.
func validCurseForgeKey(key string) error {
	if key == "" {
		return errors.New("the API key is empty")
	}
	if len(key) > 256 {
		return errors.New("that is too long to be a CurseForge API key")
	}
	for _, r := range key {
		if r <= ' ' || r > '~' {
			return errors.New("a CurseForge API key has no spaces or special characters; check what was pasted")
		}
	}
	return nil
}

// SetCurseForgeKey checks key against CurseForge and, if it works, saves it.
// A key CurseForge refuses is not saved, so the field never holds one that
// would fail every search later.
func (s *ModService) SetCurseForgeKey(key string) error {
	key = strings.TrimSpace(key)
	if err := validCurseForgeKey(key); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(s.baseContext(), curseForgeKeyCheckTimeout)
	defer cancel()
	if err := s.checkCurseForgeKey(ctx, key); err != nil {
		return err
	}
	s.cfKeyMu.Lock()
	defer s.cfKeyMu.Unlock()
	if err := WritePrivateDataFile(s.dataDir, curseForgeKeyFile, []byte(key)); err != nil {
		return fmt.Errorf("save the CurseForge API key: %w", err)
	}
	s.cfKey, s.cfKeyLoaded = key, true
	s.announceSources()
	return nil
}

// ClearCurseForgeKey deletes the saved key. CurseForge falls back to the
// built-in key, or switches off where there is none.
func (s *ModService) ClearCurseForgeKey() error {
	s.cfKeyMu.Lock()
	defer s.cfKeyMu.Unlock()
	if s.dataDir != "" {
		if err := os.Remove(filepath.Join(s.dataDir, curseForgeKeyFile)); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("remove the CurseForge API key: %w", err)
		}
	}
	s.cfKey, s.cfKeyLoaded = "", true
	s.announceSources()
	return nil
}

// announceSources tells every mods tile that a source switched on or off.
func (s *ModService) announceSources() {
	if s.bus != nil {
		s.bus.Emit(EventModSourcesChanged, nil)
	}
}
