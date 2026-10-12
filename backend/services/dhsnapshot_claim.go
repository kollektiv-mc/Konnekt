package services

import "sync"

// One Distant Horizons operation per server at a time. A snapshot stages parts
// that a publish reads and a publish uploads parts a snapshot would prune, so
// the two never overlap: both blocks claim the server's id first, and a claim
// that is already held fails the second block with a plain message instead of
// queueing it. The claim is process-wide because graphs run on separate
// goroutines, and per server because two servers share nothing.
var dhClaims = struct {
	sync.Mutex
	held map[string]struct{}
}{held: map[string]struct{}{}}

// dhClaim takes serverID's claim. It reports false, taking nothing, when
// another snapshot or publish already holds it. Release with dhRelease, in a
// defer, so every exit path gives it back.
func dhClaim(serverID string) bool {
	dhClaims.Lock()
	defer dhClaims.Unlock()
	if _, busy := dhClaims.held[serverID]; busy {
		return false
	}
	dhClaims.held[serverID] = struct{}{}
	return true
}

// dhRelease gives serverID's claim back. Releasing one that is not held is a
// no-op.
func dhRelease(serverID string) {
	dhClaims.Lock()
	defer dhClaims.Unlock()
	delete(dhClaims.held, serverID)
}

// dhBusyMessage is the refusal for a claim that is held.
const dhBusyMessage = "another Distant Horizons snapshot or publish is already running for this server: wait for it to finish, then run this one again"
