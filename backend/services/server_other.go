//go:build !windows

package services

import "syscall"

func (s *serverInstance) createJob() {}
func (s *serverInstance) closeJob()  {}

// killTree signals the whole process group rooted at pid (see server_linux.go /
// server_unix.go, which put the Java process in its own group via Setpgid before
// Start). The negative pid is the POSIX convention for "the group", so this
// reaches children a plain os.Process.Kill on pid alone would miss.
func killTree(pid int) {
	_ = syscall.Kill(-pid, syscall.SIGKILL) //nolint:errcheck // best-effort; most commonly fails because the process already exited
}
