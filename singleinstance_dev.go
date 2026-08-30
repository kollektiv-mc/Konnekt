//go:build dev

package main

import (
	"github.com/wailsapp/wails/v2/pkg/options"
)

// A `wails dev` build takes no lock.
//
// Wails compiles with `-tags dev` under `wails dev` and `-tags desktop` under
// `wails build` (pkg/commands/build/base.go adds options.OutputType as a tag,
// and cmd/wails/flags/dev.go sets that to "dev"), so this file and its !dev
// twin split exactly along the line that matters.
//
// Without the split, a packaged Konnekt left running would silently swallow
// every `wails dev` launch: the second instance exits and raises the first, so
// the dev loop looks broken with no error anywhere. That is the failure #215
// warns about, and it is worth more than a lock during development.
func singleInstanceLock(_ *App) *options.SingleInstanceLock {
	return nil
}
