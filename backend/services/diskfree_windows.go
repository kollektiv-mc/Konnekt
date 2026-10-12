//go:build windows

package services

import (
	"fmt"
	"syscall"
	"unsafe"
)

var procGetDiskFreeSpaceExW = syscall.NewLazyDLL("kernel32.dll").NewProc("GetDiskFreeSpaceExW")

// freeDiskBytes is the space the calling user can still write on the volume that
// holds dir, which must exist: GetDiskFreeSpaceExW's first figure, which honours
// per-user quotas where the total free space does not.
func freeDiskBytes(dir string) (uint64, error) {
	p, err := syscall.UTF16PtrFromString(dir)
	if err != nil {
		return 0, fmt.Errorf("read free space of %s: %w", dir, err)
	}
	var avail, total, free uint64
	r, _, callErr := procGetDiskFreeSpaceExW.Call(
		uintptr(unsafe.Pointer(p)),
		uintptr(unsafe.Pointer(&avail)),
		uintptr(unsafe.Pointer(&total)),
		uintptr(unsafe.Pointer(&free)),
	)
	if r == 0 {
		return 0, fmt.Errorf("read free space of %s: %w", dir, callErr)
	}
	return avail, nil
}
