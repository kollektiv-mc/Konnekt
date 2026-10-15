package services

import (
	"context"
	"errors"
	"testing"

	"github.com/shirou/gopsutil/v4/mem"
)

func TestPhysicalMemoryMB(t *testing.T) {
	tests := []struct {
		name    string
		read    memoryReader
		want    int
		wantErr bool
	}{
		{"whole gigabytes", func(context.Context) (*mem.VirtualMemoryStat, error) {
			return &mem.VirtualMemoryStat{Total: 16 << 30}, nil
		}, 16384, false},
		{"rounds down", func(context.Context) (*mem.VirtualMemoryStat, error) {
			return &mem.VirtualMemoryStat{Total: 8<<30 + 1<<19}, nil
		}, 8192, false},
		{"read fails", func(context.Context) (*mem.VirtualMemoryStat, error) {
			return nil, errors.New("no /proc")
		}, 0, true},
		{"platform reports zero", func(context.Context) (*mem.VirtualMemoryStat, error) {
			return &mem.VirtualMemoryStat{}, nil
		}, 0, true},
		{"platform reports nothing", func(context.Context) (*mem.VirtualMemoryStat, error) {
			return nil, nil
		}, 0, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := physicalMemoryMB(context.Background(), tt.read)
			if (err != nil) != tt.wantErr || got != tt.want {
				t.Errorf("physicalMemoryMB = (%d, %v), want (%d, err=%v)", got, err, tt.want, tt.wantErr)
			}
		})
	}
}

func TestTotalPhysicalMemoryMBReadsThisHost(t *testing.T) {
	got, err := TotalPhysicalMemoryMB(context.Background())
	if err != nil || got <= 0 {
		t.Errorf("TotalPhysicalMemoryMB = (%d, %v), want a positive size", got, err)
	}
}
