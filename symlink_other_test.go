//go:build !windows

package main

// symlinkNeedsPrivilege is the Windows-only privilege check; every other
// platform lets any user create a symlink, so a failure there is a real one.
func symlinkNeedsPrivilege(error) bool { return false }
