package services

import (
	"archive/zip"
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
)

// A Forge/NeoForge download is an *installer*, not a server. Running it with
// `-jar` starts the installer rather than a server, which is the most likely
// first mistake anyone makes with a fresh NeoForge download — so Konnekt
// recognises one on sight and offers to run it properly instead.

// InstallerInfo describes a Forge/NeoForge installer jar.
type InstallerInfo struct {
	IsInstaller bool   `json:"isInstaller"`
	Loader      string `json:"loader"`    // "neoforge" | "forge" | "" (unrecognised)
	Version     string `json:"version"`   // loader version, e.g. "21.1.72"
	MCVersion   string `json:"mcVersion"` // e.g. "1.21.1"
}

// installProfile is the subset of install_profile.json we read. The file is
// present in every Forge and NeoForge installer and in no server jar, which is
// what makes it the detection marker.
type installProfile struct {
	Profile   string `json:"profile"`   // "NeoForge" | "forge"
	Version   string `json:"version"`   // "neoforge-21.1.72" | "1.20.1-forge-47.2.0"
	Minecraft string `json:"minecraft"` // "1.21.1"
}

// reInstallerName matches the installer filenames both projects publish, used
// to recover a version when install_profile.json is unparseable.
var reInstallerName = regexp.MustCompile(`(?i)^(?:neoforge|forge)-(.+?)-installer\.jar$`)

// InspectInstaller reports whether jarPath is a Forge/NeoForge installer and
// what it installs. A jar carrying the marker but unreadable metadata is still
// an installer — just one we describe less precisely.
func InspectInstaller(jarPath string) (InstallerInfo, error) {
	if jarPath == "" {
		return InstallerInfo{}, nil
	}

	r, err := zip.OpenReader(jarPath)
	if err != nil {
		// Not a zip at all, so not an installer. Not an error worth surfacing:
		// the caller is asking a yes/no question about a file the user picked.
		return InstallerInfo{}, nil
	}
	defer r.Close()

	var profileEntry *zip.File
	for _, f := range r.File {
		if f.Name == "install_profile.json" {
			profileEntry = f
			break
		}
	}
	if profileEntry == nil {
		return InstallerInfo{}, nil
	}

	info := InstallerInfo{IsInstaller: true}

	data, err := readZipEntry(profileEntry)
	if err == nil {
		var p installProfile
		if json.Unmarshal(data, &p) == nil {
			info.MCVersion = p.Minecraft
			switch strings.ToLower(p.Profile) {
			case "neoforge":
				info.Loader = "neoforge"
			case "forge":
				info.Loader = "forge"
			}
			info.Version = loaderVersion(p.Version, p.Minecraft)
		}
	}

	// Fall back to the filename for anything the profile did not give us.
	base := baseName(jarPath)
	if m := reInstallerName.FindStringSubmatch(base); m != nil {
		if info.Version == "" {
			info.Version = m[1]
		}
		if info.Loader == "" {
			if strings.HasPrefix(strings.ToLower(base), "neoforge") {
				info.Loader = "neoforge"
			} else {
				info.Loader = "forge"
			}
		}
	}

	return info, nil
}

// loaderVersion reduces install_profile.json's "version" to the loader version
// alone: "neoforge-21.1.72" → "21.1.72", "1.20.1-forge-47.2.0" → "47.2.0".
func loaderVersion(version, mcVersion string) string {
	if version == "" {
		return ""
	}
	if idx := strings.LastIndex(version, "-forge-"); idx >= 0 {
		return version[idx+len("-forge-"):]
	}
	v := strings.TrimPrefix(version, "neoforge-")
	if mcVersion != "" {
		v = strings.TrimPrefix(v, mcVersion+"-")
	}
	return v
}

// InstallerService runs a Forge/NeoForge installer, reporting its output over
// the bus. The installer takes 30–90s and reports no percentage, only log
// lines, so progress is the log itself.
type InstallerService struct {
	ctx     context.Context
	bus     *EventBus
	mu      sync.Mutex
	running bool
	cmd     *exec.Cmd // the running installer, for Abort
	aborted bool
}

func NewInstallerService() *InstallerService {
	return &InstallerService{}
}

func (s *InstallerService) SetContext(ctx context.Context) { s.ctx = ctx }
func (s *InstallerService) SetBus(b *EventBus)             { s.bus = b }

// InstallServer runs `java -jar <jarPath> --installServer <targetDir>` in the
// background and returns as soon as it has started. Completion arrives as
// EventInstallFinished or EventInstallFailed; everything the installer prints
// arrives as EventInstallLog in between.
func (s *InstallerService) InstallServer(jarPath, targetDir string) error {
	if jarPath == "" || targetDir == "" {
		return fmt.Errorf("installer jar and target directory are both required")
	}

	info, _ := InspectInstaller(jarPath)
	if !info.IsInstaller {
		return fmt.Errorf("%s is not a Forge/NeoForge installer", filepath.Base(jarPath))
	}

	if _, err := exec.LookPath("java"); err != nil {
		return fmt.Errorf("java not found in PATH — install Java and ensure it is accessible")
	}

	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return fmt.Errorf("an install is already running")
	}
	s.running = true
	s.aborted = false
	s.mu.Unlock()

	if err := os.MkdirAll(targetDir, 0755); err != nil {
		s.finish(false, targetDir, info, fmt.Errorf("create %s: %w", targetDir, err))
		return err
	}

	s.bus.Emit(EventInstallStarted, map[string]any{"targetDir": targetDir})

	for _, removed := range repairPartialInstall(targetDir) {
		s.bus.Emit(EventInstallLog, map[string]any{
			"line": "Removed truncated " + removed + " from an earlier attempt.",
		})
	}

	cmd := exec.Command("java", "-jar", jarPath, "--installServer", targetDir)
	cmd.Dir = targetDir

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		s.finish(false, targetDir, info, err)
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		s.finish(false, targetDir, info, err)
		return err
	}

	configureProcAttr(cmd) // own process group, so Abort's killTree reaches children

	if err := cmd.Start(); err != nil {
		s.finish(false, targetDir, info, fmt.Errorf("start installer: %w", err))
		return err
	}

	s.mu.Lock()
	s.cmd = cmd
	s.mu.Unlock()

	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); s.streamLog(stdout) }()
	go func() { defer wg.Done(); s.streamLog(stderr) }()

	go func() {
		wg.Wait() // drain both pipes before Wait closes them
		err := cmd.Wait()
		s.finish(err == nil, targetDir, info, err)
	}()

	return nil
}

func (s *InstallerService) streamLog(r io.Reader) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	for sc.Scan() {
		s.bus.Emit(EventInstallLog, map[string]any{"line": sc.Text()})
	}
}

// repairPartialInstall deletes install artifacts that an aborted or failed run
// left truncated and that the installer will not re-verify on the next attempt.
// Returns the paths removed, relative to targetDir.
//
// Only the vanilla server jar qualifies. Everything under libraries/ is
// checksum-checked by the installer on each run ("File … exists. Checksum
// valid."), so those self-heal; the Minecraft server jar is the exception — a
// retry logs "Considering Minecraft server jar" and moves on without
// re-downloading or reporting a check. A half-downloaded copy therefore
// survives until the BUNDLER_EXTRACT processor opens it as a zip and dies with
// "zip END header not found", failing the whole install.
//
// Deleting a copy that provably will not open as a zip is safe: it is an
// install artifact, not user data, and the installer re-downloads it.
func repairPartialInstall(targetDir string) []string {
	pattern := filepath.Join(targetDir, "libraries", "net", "minecraft", "server", "*", "*.jar")
	matches, err := filepath.Glob(pattern)
	if err != nil {
		return nil
	}

	var removed []string
	for _, path := range matches {
		r, err := zip.OpenReader(path)
		if err == nil {
			r.Close()
			continue
		}
		if os.Remove(path) == nil {
			if rel, relErr := filepath.Rel(targetDir, path); relErr == nil {
				removed = append(removed, rel)
			} else {
				removed = append(removed, path)
			}
		}
	}
	return removed
}

// Abort kills a running installer. No-op when nothing is running. The install
// settles as install:failed, so the modal and the sidebar chip clear the same
// way they would for any other failure.
func (s *InstallerService) Abort() error {
	s.mu.Lock()
	if !s.running || s.cmd == nil || s.cmd.Process == nil {
		s.mu.Unlock()
		return nil
	}
	s.aborted = true
	pid := s.cmd.Process.Pid
	s.mu.Unlock()

	killTree(pid)
	return nil
}

func (s *InstallerService) finish(ok bool, targetDir string, info InstallerInfo, err error) {
	s.mu.Lock()
	s.running = false
	s.cmd = nil
	aborted := s.aborted
	s.mu.Unlock()

	if aborted {
		s.bus.Emit(EventInstallFailed, map[string]any{
			"error": "Install aborted. A partial download is left behind; retrying repairs it.",
		})
		return
	}

	if ok {
		s.bus.Emit(EventInstallFinished, map[string]any{
			"targetDir": targetDir,
			"mcVersion": info.MCVersion,
			"loader":    info.Loader,
		})
		return
	}
	msg := "installer failed"
	if err != nil {
		msg = err.Error()
	}
	s.bus.Emit(EventInstallFailed, map[string]any{"error": msg})
}
