package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wailsapp/wails/v2/pkg/options/linux"
)

// A fake /sys/class/drm: one directory per card, with the PCI vendor id and
// the driver the card is bound to, plus the connector entries a real tree
// carries beside the cards so the anchored name match is exercised.
func fakeDRM(t *testing.T, cards ...struct{ vendor, driver string }) string {
	t.Helper()
	dir := t.TempDir()
	for i, card := range cards {
		device := filepath.Join(dir, "card"+string(rune('0'+i)), "device")
		if err := os.MkdirAll(device, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(device, "vendor"), []byte(card.vendor+"\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		drivers := filepath.Join(dir, "drivers", card.driver)
		if err := os.MkdirAll(drivers, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(drivers, filepath.Join(device, "driver")); err != nil {
			t.Fatal(err)
		}
		// Not a card, however NVIDIA-looking its contents are.
		connector := filepath.Join(dir, "card"+string(rune('0'+i))+"-HDMI-A-1", "device")
		if err := os.MkdirAll(connector, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(connector, "vendor"), []byte(nvidiaVendorID), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

type fakeEnv map[string]string

func (e fakeEnv) get(k string) string { return e[k] }
func (e fakeEnv) set(k, v string) error {
	e[k] = v
	return nil
}

func TestResolveWebviewGpu(t *testing.T) {
	nvidia := struct{ vendor, driver string }{nvidiaVendorID, "nvidia"}
	nouveau := struct{ vendor, driver string }{nvidiaVendorID, "nouveau"}
	intel := struct{ vendor, driver string }{"0x8086", "i915"}

	tests := []struct {
		name        string
		env         fakeEnv
		cards       []struct{ vendor, driver string }
		wantPolicy  linux.WebviewGpuPolicy
		wantDMABuf  string // the variable's value afterwards, "" for unset
		wantApplied bool   // whether the resolver itself set it
	}{
		{"no cards at all", fakeEnv{}, nil, linux.WebviewGpuPolicyAlways, "", false},
		{"intel only", fakeEnv{}, []struct{ vendor, driver string }{intel}, linux.WebviewGpuPolicyAlways, "", false},
		{"nvidia on nouveau is fine", fakeEnv{}, []struct{ vendor, driver string }{nouveau}, linux.WebviewGpuPolicyAlways, "", false},
		{"nvidia proprietary gets the quirk", fakeEnv{}, []struct{ vendor, driver string }{nvidia}, linux.WebviewGpuPolicyAlways, "1", true},
		{"hybrid with nvidia second still gets it", fakeEnv{}, []struct{ vendor, driver string }{intel, nvidia}, linux.WebviewGpuPolicyAlways, "1", true},
		{"an explicit 0 in the environment is kept", fakeEnv{disableDMABufEnv: "0"}, []struct{ vendor, driver string }{nvidia}, linux.WebviewGpuPolicyAlways, "0", false},
		{"override never", fakeEnv{webviewGpuEnv: "never"}, []struct{ vendor, driver string }{nvidia}, linux.WebviewGpuPolicyNever, "", false},
		{"override ondemand, quirk still applies", fakeEnv{webviewGpuEnv: " OnDemand "}, []struct{ vendor, driver string }{nvidia}, linux.WebviewGpuPolicyOnDemand, "1", true},
		{"override always", fakeEnv{webviewGpuEnv: "always"}, nil, linux.WebviewGpuPolicyAlways, "", false},
		{"garbage override falls back to the default", fakeEnv{webviewGpuEnv: "off"}, nil, linux.WebviewGpuPolicyAlways, "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := fakeDRM(t, tt.cards...)
			got := resolveWebviewGpu(tt.env.get, tt.env.set, dir)
			if got.Policy != tt.wantPolicy {
				t.Errorf("policy = %v, want %v (reason: %s)", got.Policy, tt.wantPolicy, got.Reason)
			}
			if v := tt.env[disableDMABufEnv]; v != tt.wantDMABuf {
				t.Errorf("%s = %q, want %q (reason: %s)", disableDMABufEnv, v, tt.wantDMABuf, got.Reason)
			}
			if got.DisabledDMABuf != tt.wantApplied {
				t.Errorf("DisabledDMABuf = %v, want %v (reason: %s)", got.DisabledDMABuf, tt.wantApplied, got.Reason)
			}
			if got.Reason == "" {
				t.Error("reason is empty; the log line would say nothing")
			}
		})
	}
}

func TestResolveWebviewGpuReportsASetenvFailure(t *testing.T) {
	dir := fakeDRM(t, struct{ vendor, driver string }{nvidiaVendorID, "nvidia"})
	failing := func(string, string) error { return errors.New("read-only environment") }
	got := resolveWebviewGpu(fakeEnv{}.get, failing, dir)
	if got.Policy != linux.WebviewGpuPolicyAlways || got.DisabledDMABuf {
		t.Errorf("got %+v, want Always with the quirk reported as not applied", got)
	}
	if want := "could not be set: read-only environment"; !strings.Contains(got.Reason, want) {
		t.Errorf("reason %q does not carry %q", got.Reason, want)
	}
}

func TestNvidiaProprietaryDriverLoadedTolerantOfAMissingTree(t *testing.T) {
	if nvidiaProprietaryDriverLoaded(filepath.Join(t.TempDir(), "absent")) {
		t.Error("a missing sysfs tree read as an NVIDIA machine")
	}
}
