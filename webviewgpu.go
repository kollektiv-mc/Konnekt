package main

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/options/linux"
)

// The Linux webview's hardware acceleration policy, and the one environment
// quirk that makes "on" safe to ship.
//
// Wails defaults WebviewGpuPolicy to Never as its workaround for
// wailsapp/wails#2977, and Konnekt restated that for a while. Never means no
// accelerated compositing at all: no compositor thread, no asynchronous
// scrolling, every scrolled frame a CPU repaint of the dirty region. That is
// the difference a Linux user feels between the app and any browser on the
// same machine, and it is not what WebKitGTK itself ships: its own default
// for hardware-acceleration-policy is ALWAYS (WebKitSettings.cpp), which is
// what Epiphany and every Tauri app run with, and current WebKitGTK already
// drops to software on its own when GTK cannot create a GL context
// (AcceleratedBackingStore.cpp, gtkCanUseHardwareAcceleration).
//
// What #2977 and its relatives actually are is the DMA-BUF renderer WebKitGTK
// 2.42 introduced meeting the proprietary NVIDIA driver: GBM buffer
// allocation fails and the window stays blank. The fix the whole ecosystem
// settled on, Tauri's docs included, is WEBKIT_DISABLE_DMABUF_RENDERER=1,
// which WebKit still honours and which only gives up the DMA-BUF transport,
// not acceleration: the web process keeps compositing on the GPU and hands
// frames over through shared memory. So the default here is Always, with
// that variable set for the NVIDIA driver before GTK initialises, the way
// the webkit2gtk-nvidia-quirk crate does it for Rust apps.
//
// KONNEKT_WEBVIEW_GPU=never|ondemand|always overrides the policy for a
// machine this still gets wrong, and an explicit WEBKIT_DISABLE_DMABUF_RENDERER
// in the environment, set to anything including 0, is never overwritten.

// The override's name and values. Lower-cased and trimmed before matching.
const webviewGpuEnv = "KONNEKT_WEBVIEW_GPU"

// The WebKitGTK switch the NVIDIA quirk sets.
const disableDMABufEnv = "WEBKIT_DISABLE_DMABUF_RENDERER"

// Where the kernel lists GPUs. A DRM card is a `cardN` directory whose
// `device/vendor` is the PCI vendor id and whose `device/driver` links to the
// driver bound to it. The connector entries beside it (`card0-HDMI-A-1`) are
// not cards, hence the anchored pattern.
const sysClassDRM = "/sys/class/drm"

var drmCardName = regexp.MustCompile(`^card[0-9]+$`)

// PCI vendor id of NVIDIA, as sysfs prints it.
const nvidiaVendorID = "0x10de"

// webviewGpuDecision is what resolveWebviewGpu chose and why, for the log.
type webviewGpuDecision struct {
	Policy linux.WebviewGpuPolicy
	// Reason is one line for konnekt.log, so a blank window on some machine
	// can be read back to the choice that produced it.
	Reason string
	// DisabledDMABuf is true when this call set WEBKIT_DISABLE_DMABUF_RENDERER.
	DisabledDMABuf bool
}

// resolveWebviewGpu decides the Linux policy from the override, the GPUs in
// `drmDir` and the current environment, applying the NVIDIA quirk through
// `setenv`. Both lookups are parameters so the decision is testable against
// a fake sysfs tree and a fake environment; main passes the real ones.
func resolveWebviewGpu(getenv func(string) string, setenv func(string, string) error, drmDir string) webviewGpuDecision {
	policy := linux.WebviewGpuPolicyAlways
	reason := "default"
	switch override := strings.ToLower(strings.TrimSpace(getenv(webviewGpuEnv))); override {
	case "":
	case "never":
		return webviewGpuDecision{Policy: linux.WebviewGpuPolicyNever, Reason: webviewGpuEnv + "=never"}
	case "ondemand":
		policy, reason = linux.WebviewGpuPolicyOnDemand, webviewGpuEnv+"=ondemand"
	case "always":
		reason = webviewGpuEnv + "=always"
	default:
		reason = "default (" + webviewGpuEnv + "=" + override + " is not never, ondemand or always)"
	}

	decision := webviewGpuDecision{Policy: policy, Reason: reason}
	if getenv(disableDMABufEnv) != "" {
		decision.Reason += "; " + disableDMABufEnv + " already set"
		return decision
	}
	if !nvidiaProprietaryDriverLoaded(drmDir) {
		return decision
	}
	if err := setenv(disableDMABufEnv, "1"); err != nil {
		decision.Reason += "; NVIDIA driver found but " + disableDMABufEnv + " could not be set: " + err.Error()
		return decision
	}
	decision.DisabledDMABuf = true
	decision.Reason += "; NVIDIA proprietary driver, " + disableDMABufEnv + "=1"
	return decision
}

// nvidiaProprietaryDriverLoaded reports whether any DRM card under `drmDir`
// is an NVIDIA device bound to the proprietary `nvidia` driver. Nouveau is
// the open driver and does not have the DMA-BUF problem, so an NVIDIA card
// on it is deliberately not a match. Any NVIDIA card counts, not only the
// primary one: on a hybrid laptop that costs the DMA-BUF fast path when the
// integrated GPU would have been fine, which is cheaper than a blank window
// when it would not.
func nvidiaProprietaryDriverLoaded(drmDir string) bool {
	entries, err := os.ReadDir(drmDir)
	if err != nil {
		return false
	}
	for _, entry := range entries {
		if !drmCardName.MatchString(entry.Name()) {
			continue
		}
		device := filepath.Join(drmDir, entry.Name(), "device")
		vendor, err := os.ReadFile(filepath.Join(device, "vendor"))
		if err != nil || strings.TrimSpace(string(vendor)) != nvidiaVendorID {
			continue
		}
		// Unbound (no link) or unreadable: not the proprietary driver, either way.
		driver, err := os.Readlink(filepath.Join(device, "driver"))
		if err != nil {
			continue
		}
		if filepath.Base(driver) == "nvidia" {
			return true
		}
	}
	return false
}
