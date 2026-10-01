//go:build windows

package main

import (
	"errors"
	"syscall"
)

// symlinkNeedsPrivilege reports whether err is Windows refusing os.Symlink
// because the process lacks SeCreateSymbolicLinkPrivilege: a plain developer
// shell without Developer Mode or elevation. The same check internal/testenv
// makes before the standard library's own symlink tests.
func symlinkNeedsPrivilege(err error) bool {
	return errors.Is(err, syscall.ERROR_PRIVILEGE_NOT_HELD)
}
