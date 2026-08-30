//go:build !dev

package main

import (
	"log/slog"

	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// singleInstanceLock stops a second Konnekt launching against the same data
// directory and the same server process (#215).
//
// Everything under services.WriteDataFile assumes it is the only writer: the
// server list, the active server, app settings, the tile layout and its
// presets, the command buttons and the scheduler's graphs and history are flat
// files with no locking, so two instances mean last-write-wins across all of
// them, silently. The server process is worse, since two apps would each
// believe they own one child.
//
// The dev build gets no lock at all — see singleinstance_dev.go.
func singleInstanceLock(app *App) *options.SingleInstanceLock {
	return &options.SingleInstanceLock{
		UniqueId:               singleInstanceID,
		OnSecondInstanceLaunch: app.onSecondInstanceLaunch,
	}
}

// singleInstanceID names the lock the running instance holds (#215).
//
// Deliberately chosen rather than generated, because it is a public name on
// every platform: on Linux Wails exports a D-Bus name built from it
// (org.wails_app_com_kollektiv_konnekt.SingleInstance, per
// v2/internal/frontend/desktop/linux/single_instance.go), on Windows a named
// mutex, on macOS a distributed-notification name. Note that Wails collapses
// both '.' and '-' to '_' when building the bus name, so a variant differing
// only in punctuation is the *same* lock.
//
// Changing this string strands an already-running older build, which would no
// longer recognise the new one as a second instance. It is stable, not
// cosmetic.
const singleInstanceID = "com.kollektiv.konnekt"

// onSecondInstanceLaunch runs in the *first* instance when a second launch is
// refused. The expected behaviour, and the whole of it for now: raise and focus
// the window that is already open.
//
// Takes the whole SecondInstanceData rather than closing over the window in
// main.go so that #213 Phase 2's konnekt:// handling is one added call here
// rather than a lifecycle change. Args is where that payload will arrive: the
// OS launches a second Konnekt with the URL in argv and the lock forwards it.
// Logged and dropped until then, so the path is visible before it exists.
//
// Deliberately no always-on-top toggle to force focus. It fights the window
// manager on Linux and is what makes "focus the window" implementations
// flicker.
func (a *App) onSecondInstanceLaunch(data options.SecondInstanceData) {
	if a.ctx == nil {
		// The lock is held from wails.Run, before startup finishes. A launch in
		// that window has no window to raise yet.
		slog.Warn("second instance before startup", "args", len(data.Args))
		return
	}
	slog.Info("second instance", "args", data.Args, "cwd", data.WorkingDirectory)
	runtime.WindowUnminimise(a.ctx)
	runtime.Show(a.ctx)
}
