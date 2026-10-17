package services

import (
	"context"
	"fmt"

	"github.com/shirou/gopsutil/v4/mem"
)

// memoryReader is gopsutil's mem.VirtualMemoryWithContext, as a parameter so a
// test can answer for a machine it is not running on.
type memoryReader func(context.Context) (*mem.VirtualMemoryStat, error)

// TotalPhysicalMemoryMB is the machine's installed RAM in megabytes, for the
// server form to compare a heap setting against (#120). It is the host's, not a
// server's, and does not change while the app runs.
func TotalPhysicalMemoryMB(ctx context.Context) (int, error) {
	return physicalMemoryMB(ctx, mem.VirtualMemoryWithContext)
}

func physicalMemoryMB(ctx context.Context, read memoryReader) (int, error) {
	vm, err := read(ctx)
	if err != nil {
		return 0, fmt.Errorf("read physical memory: %w", err)
	}
	if vm == nil || vm.Total == 0 {
		return 0, fmt.Errorf("read physical memory: the platform reported none")
	}
	return int(vm.Total / (1024 * 1024)), nil
}
