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
}
