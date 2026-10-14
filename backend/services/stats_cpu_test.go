package services

import (
	"os"
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/shirou/gopsutil/v4/process"
)

func TestMachineCPUPercent(t *testing.T) {
	cases := []struct {
		name    string
		perCore float64
		cores   int
		want    float64
	}{
		{"idle", 0, 8, 0},
		{"one core of eight", 100, 8, 12.5},
		{"six cores of twelve", 600, 12, 50},
		{"every core busy", 800, 8, 100},
		{"sampling skew past the ceiling", 812, 8, 100},
		{"single core machine", 37, 1, 37},
		{"no core count", 50, 0, 50},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := machineCPUPercent(c.perCore, c.cores); got != c.want {
				t.Errorf("machineCPUPercent(%v, %d) = %v, want %v", c.perCore, c.cores, got, c.want)
			}
		})
	}
}

// TestCPUPercentStaysWithinTheMachine reproduces the report against a real
// process: this test binary keeps every core busy, which gopsutil reports as
// well over 100%, and CPUPercent must still read as a share of the machine.
func TestCPUPercentStaysWithinTheMachine(t *testing.T) {
	cores := runtime.NumCPU()
	if cores < 2 {
		t.Skip("needs more than one core to exceed 100% per core")
	}
	proc, err := process.NewProcess(int32(os.Getpid()))
	if err != nil {
		t.Fatalf("NewProcess: %v", err)
	}
	s := &serverInstance{cachedProc: proc}
	s.CPUPercent() // primes gopsutil's previous sample

	stop := make(chan struct{})
	var wg sync.WaitGroup
	for range cores {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop:
					return
				default:
				}
			}
		}()
	}
	time.Sleep(500 * time.Millisecond)
	got := s.CPUPercent()
	close(stop)
	wg.Wait()

	if got <= 0 || got > 100 {
		t.Fatalf("CPUPercent() = %v with every core busy, want a share of the machine in (0, 100]", got)
	}
}
