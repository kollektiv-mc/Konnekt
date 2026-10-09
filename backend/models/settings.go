package models

type AppSettings struct {
	Theme           string `json:"theme"`           // "light" | "dark" | "system"
	SkinId          string `json:"skinId"`          // built-in skin id, e.g. "default"
	AccentColor     string `json:"accentColor"`     // hex e.g. "#4ade80"
	SuccessColor    string `json:"successColor"`    // hex
	WarningColor    string `json:"warningColor"`    // hex
	DangerColor     string `json:"dangerColor"`     // hex
	BackgroundStyle string `json:"backgroundStyle"` // "solid" | "gradient"

	AutoStartActiveServer bool `json:"autoStartActiveServer"`
	ConfirmBeforeStop     bool `json:"confirmBeforeStop"`

	// StopGraceSeconds is how long a graceful stop may wait for the server to
	// shut down and save before the process tree is force killed (#110).
	StopGraceSeconds int `json:"stopGraceSeconds"`

	ConsoleBufferLines int  `json:"consoleBufferLines"`
	ConsoleTimestamps  bool `json:"consoleTimestamps"`

	NotifyOnCrash bool `json:"notifyOnCrash"`
	NotifyOnJoin  bool `json:"notifyOnJoin"`

	SchedulerPaletteCollapsed        bool            `json:"schedulerPaletteCollapsed"`
	SchedulerPaletteClosedCategories map[string]bool `json:"schedulerPaletteClosedCategories"`

	ConsoleQuickCommandsCollapsed bool `json:"consoleQuickCommandsCollapsed"`

	// ClassicTileFaces shows the compact tile faces from before the
	// figure-first ones: the Overview's stat rows, the players' avatar grid
	// and the centred counters. Off by default; the per-tile layouts in
	// tile_layouts.json do not apply while it is on.
	ClassicTileFaces bool `json:"classicTileFaces"`

	// NavClosedSections marks which navbar sections the user has collapsed,
	// keyed by section id ("servers", "widgets", "tiles", "layouts"). A key
	// that is not there is open, so the defaults in services.GetAppSettings
	// name only the two that start closed. A settings file written before this
	// field existed has no key at all and takes those defaults, which is the
	// same first-run shape rather than the everything-open one it last had.
	NavClosedSections map[string]bool `json:"navClosedSections"`

	CheckUpdatesOnStartup bool `json:"checkUpdatesOnStartup"`

	// UpdateChannel is "stable" or "snapshot". A build that is itself a
	// snapshot follows the snapshot channel regardless of what this says (see
	// services.EffectiveChannel), or it could never update itself.
	UpdateChannel string `json:"updateChannel"`

	// Display order of the tile crate's navbar list, by tile registry id.
	CrateOrder []string `json:"crateOrder"`

	// NavWidth is the left navbar's width in CSS pixels. The frontend clamps
	// it to a floor and to a fraction of the window width before use, so a
	// value written by a wider window cannot survive into a narrower one
	// (frontend/src/lib/navWidth.ts). Zero means "never set" and resolves to
	// the default the same way.
	NavWidth int `json:"navWidth"`

	// SmoothScrolling animates each mouse-wheel notch on the spring physics
	// Firefox's msdPhysics mode uses (frontend/src/lib/springPhysics.ts),
	// rather than the WebView's own per-notch ease. On by default; a settings
	// file written before the field existed unmarshals onto that default.
	SmoothScrolling bool `json:"smoothScrolling"`

	// Fonts is the family a person chose for each --font-* token, keyed by the
	// token's role: "sans", "title", "display" or "mono" (#444). A role with no
	// entry, or an empty one, keeps the token's own stack. It is a map rather
	// than four fields so a fifth token is a key and not a schema change, and
	// the family is a free-text name because the picker suggests the installed
	// faces without being limited to them. frontend/src/lib/fonts.ts writes the
	// name in front of the token's stack, so one that is not installed falls
	// through to the default.
	Fonts map[string]string `json:"fonts"`

	// WebviewGpu is the Linux webview's hardware acceleration policy:
	// "always", "ondemand" or "never" (#421). Empty means nobody chose, which
	// resolves to always; it stays empty rather than defaulting to "always" so
	// the startup log can tell a choice from the default. It is read once, in main,
	// before the window exists, because the policy is fixed when Wails creates
	// the webview; a change applies on the next launch. KONNEKT_WEBVIEW_GPU in
	// the environment wins over it (webviewgpu.go), and the other platforms
	// ignore it.
	WebviewGpu string `json:"webviewGpu"`
}
