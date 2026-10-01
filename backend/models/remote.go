package models

// RemoteDevice is a browser the desktop has approved for Remote Access (#45).
// Name is what the desktop called it at approval, and is the only thing about
// a remote caller that konnekt.log names.
type RemoteDevice struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	ApprovedAt int64  `json:"approvedAt"` // Unix ms
	LastSeen   int64  `json:"lastSeen"`   // Unix ms of its last sign-in
	Sessions   int    `json:"sessions"`   // live sessions right now
}

// RemotePendingDevice is a browser that gave the right password and is waiting
// for the desktop to approve it. Code is shown on both screens, so the person
// approving can tell their own phone from somebody else's request. UserAgent is
// what the browser said about itself: a hint for the prompt, clamped and
// stripped of control characters, and never a fact.
type RemotePendingDevice struct {
	ID          string `json:"id"`
	Code        string `json:"code"`
	UserAgent   string `json:"userAgent"`
	RequestedAt int64  `json:"requestedAt"` // Unix ms
}
