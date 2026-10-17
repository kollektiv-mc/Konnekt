package services

import (
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"
)

// A moderation target is a player name, never a selector (#510,
// agent_docs/SECURITY_CHECKLIST.md § S9.3). Vanilla
// `kick`, `ban` and `pardon` accept target selectors, so a `name` of `@a`
// handed to KickPlayer disconnects everyone online. The desktop's own tiles
// pass what the roster shows, but the same bound methods are reachable from a
// phone and from an MCP tool that reads player-written chat, so the check
// sits in front of all of them.
//
// A Java name is 1 to 16 of [A-Za-z0-9_]. A Bedrock player joining through
// Geyser and Floodgate carries a one-character prefix before a name of the
// same shape (Floodgate's `username-prefix`, "." by default and set per
// server; its `replace-spaces` default turns a gamertag's spaces into
// underscores), so one leading prefix character from playerNamePrefixes is
// allowed too. Neither shape has room for `@`, a space, a bracket or a line
// break, which is the point.

// ErrPlayerName is what the moderation methods return for a target that is
// not a player name.
var ErrPlayerName = errors.New("not a player name")

const (
	playerNameMax = 16
	// playerNamePrefixes are the Floodgate prefixes seen in the wild. `@` is
	// not one and never will be.
	playerNamePrefixes = ".*+-~"
)

// ValidPlayerName reports whether name is one player's name: an optional
// Floodgate prefix, then 1 to 16 letters, digits or underscores.
func ValidPlayerName(name string) error {
	if name == "" {
		return fmt.Errorf("%w: it is empty", ErrPlayerName)
	}
	body := name
	if strings.ContainsRune(playerNamePrefixes, rune(name[0])) {
		body = name[1:]
	}
	if body == "" || utf8.RuneCountInString(body) > playerNameMax {
		return fmt.Errorf("%w: %q is not 1 to %d characters", ErrPlayerName, name, playerNameMax)
	}
	for _, r := range body {
		if !(r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '_') {
			return fmt.Errorf("%w: %q carries %q", ErrPlayerName, name, r)
		}
	}
	return nil
}
