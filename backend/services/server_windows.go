//go:build windows

package services

import (
	"os/exec"
	"strconv"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// configureProcAttr is a no-op on Windows: process-tree cleanup is handled by
// the Job Object assigned in createJob after Start, not via SysProcAttr.
func configureProcAttr(cmd *exec.Cmd) {}

// jobobjectBasicLimitInformation mirrors JOBOBJECT_BASIC_LIMIT_INFORMATION.
// Explicit padding matches the Windows SDK layout on 64-bit.
type jobobjectBasicLimitInformation struct {
	PerProcessUserTimeLimit int64
	PerJobUserTimeLimit     int64
	LimitFlags              uint32
	_                       uint32 // pad: align SIZE_T to 8 bytes
	MinimumWorkingSetSize   uintptr
	MaximumWorkingSetSize   uintptr
	ActiveProcessLimit      uint32
	_                       uint32 // pad: align ULONG_PTR to 8 bytes
	Affinity                uintptr
	PriorityClass           uint32
	SchedulingClass         uint32
}

// createJob ties the freshly started Java process to this process's lifetime.
func (s *serverInstance) createJob() {
	s.job = newKillOnCloseJob(s.cmd.Process.Pid)
}

// closeJob releases the Job Object handle after the Java process has exited normally.
func (s *serverInstance) closeJob() {
	closeKillOnCloseJob(s.job)
	s.job = 0
}

// newKillOnCloseJob creates a Windows Job Object with
// JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE and assigns the process to it, so the OS
// kills that process and its children when this process exits for any reason.
// It returns the job handle, or 0 when any step failed: the job is a safety
// net, and a process without one still runs and still dies on an explicit stop.
// Shared by the server and the tunnel, which both must not outlive Konnekt.
func newKillOnCloseJob(pid int) uintptr {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return 0
	}

	info := jobobjectBasicLimitInformation{
		LimitFlags: windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
	}
	_, err = windows.SetInformationJobObject(
		job,
		2, // JobObjectBasicLimitInformation
		uintptr(unsafe.Pointer(&info)),
		uint32(unsafe.Sizeof(info)),
	)
	if err != nil {
		_ = windows.CloseHandle(job) //nolint:errcheck // error-path cleanup; job is being discarded either way
		return 0
	}

	proc, err := windows.OpenProcess(windows.PROCESS_ALL_ACCESS, false, uint32(pid))
	if err != nil {
		_ = windows.CloseHandle(job) //nolint:errcheck // error-path cleanup; job is being discarded either way
		return 0
	}
	defer windows.CloseHandle(proc)

	if err := windows.AssignProcessToJobObject(job, proc); err != nil {
		_ = windows.CloseHandle(job) //nolint:errcheck // error-path cleanup; job is being discarded either way
		return 0
	}

	return uintptr(job)
}

// closeKillOnCloseJob releases a handle from newKillOnCloseJob. 0 is a no-op.
func closeKillOnCloseJob(job uintptr) {
	if job != 0 {
		_ = windows.CloseHandle(windows.Handle(job)) //nolint:errcheck // normal teardown; the process is exiting regardless
	}
}

// hideConsoleWindow stops a console program started from this GUI app from
// opening a console window of its own. cloudflared is a console binary and
// would flash one for as long as the tunnel runs.
func hideConsoleWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: windows.CREATE_NO_WINDOW}
}

func killTree(pid int) {
	_ = exec.Command("taskkill", "/F", "/T", "/PID", strconv.Itoa(pid)).Run() //nolint:errcheck // best-effort escalation; already the last-resort fallback
}
