//go:build windows

package services

import (
	"os/exec"
	"strconv"
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

// createJob creates a Windows Job Object, sets JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
// so the OS kills the entire Java process tree when this process exits for any reason,
// then assigns the freshly started Java process to the job.
func (s *serverInstance) createJob() {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return
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
		return
	}

	proc, err := windows.OpenProcess(windows.PROCESS_ALL_ACCESS, false, uint32(s.cmd.Process.Pid))
	if err != nil {
		_ = windows.CloseHandle(job) //nolint:errcheck // error-path cleanup; job is being discarded either way
		return
	}
	defer windows.CloseHandle(proc)

	if err := windows.AssignProcessToJobObject(job, proc); err != nil {
		_ = windows.CloseHandle(job) //nolint:errcheck // error-path cleanup; job is being discarded either way
		return
	}

	s.job = uintptr(job)
}

// closeJob releases the Job Object handle after the Java process has exited normally.
func (s *serverInstance) closeJob() {
	if s.job != 0 {
		_ = windows.CloseHandle(windows.Handle(s.job)) //nolint:errcheck // normal teardown; the process is exiting regardless
		s.job = 0
	}
}

func killTree(pid int) {
	_ = exec.Command("taskkill", "/F", "/T", "/PID", strconv.Itoa(pid)).Run() //nolint:errcheck // best-effort escalation; already the last-resort fallback
}
