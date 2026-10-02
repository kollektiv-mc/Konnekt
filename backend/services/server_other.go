//go:build !windows

package services

import (
	"os/exec"
	"syscall"
)

func (s *serverInstance) createJob() {}
func (s *serverInstance) closeJob()  {}

// newKillOnCloseJob and closeKillOnCloseJob are the Windows Job Object helpers
// (server_windows.go). Here the process group and Pdeathsig set by
// configureProcAttr do that job, so there is nothing to create.
func newKillOnCloseJob(pid int) uintptr { return 0 }
func closeKillOnCloseJob(job uintptr)   {}

// hideConsoleWindow is a Windows concern; other platforms start no console.
func hideConsoleWindow(cmd *exec.Cmd) {}

// killTree signals the whole process group rooted at pid (see server_linux.go /
// server_unix.go, which put the Java process in its own group via Setpgid before
// Start). The negative pid is the POSIX convention for "the group", so this
// reaches children a plain os.Process.Kill on pid alone would miss.
func killTree(pid int) {
	_ = syscall.Kill(-pid, syscall.SIGKILL) //nolint:errcheck // best-effort; most commonly fails because the process already exited
}
