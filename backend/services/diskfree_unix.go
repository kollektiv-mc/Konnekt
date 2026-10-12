//go:build !windows

package services

import (
	"fmt"
	"syscall"
)

// freeDiskBytes is the space a normal user can still write on the volume that
// holds dir, which must exist. It is Bavail (what is left for an unprivileged
// process), not Bfree, because the reserved blocks are not ours to fill. The
// conversions are there because the field types differ between Linux and the
// BSDs.
func freeDiskBytes(dir string) (uint64, error) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(dir, &st); err != nil {
		return 0, fmt.Errorf("read free space of %s: %w", dir, err)
	}
	return uint64(st.Bavail) * uint64(st.Bsize), nil
}
