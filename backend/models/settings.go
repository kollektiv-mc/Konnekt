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

	CheckUpdatesOnStartup bool `json:"checkUpdatesOnStartup"`

	// Display order of the tile crate's navbar list, by tile registry id.
	CrateOrder []string `json:"crateOrder"`
}
