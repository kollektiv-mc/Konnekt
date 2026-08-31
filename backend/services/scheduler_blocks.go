package services

import (
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"konnekt/backend/models"
)

// registerBuiltins registers all native block descriptors and executors.
func registerBuiltins(r *BlockRegistry) {
	// ── Triggers ──────────────────────────────────────────────────────────────

	must(r.RegisterBlock(models.BlockDef{
		ID: "trigger.player", Category: "trigger", Label: "Player",
		Description: "Fires when a player joins or leaves the server.",
		IsTrigger:   true, ControlOutputs: []string{"onComplete"},
		DataInputs: []models.DataPort{
			{ID: "cooldownSeconds", Label: "Cooldown", Type: "number"},
		},
		DataOutputs: []models.DataPort{
			{ID: "playerName", Label: "Player name", Type: "string"},
			{ID: "playerIP", Label: "Player IP", Type: "string"},
		},
		ConfigSchema: []models.ConfigField{
			{Key: "type", Label: "Type", Type: "select", Default: "Joined", Required: true,
				Options: []models.FieldOption{
					{Label: "Joined", Value: "Joined"},
					{Label: "Left", Value: "Left"},
				}},
			{Key: "cooldownSeconds", Label: "Cooldown (seconds)", Type: "number", Default: 300},
		},
		Source: "native",
	}, triggerNoOp))

	must(r.RegisterBlock(models.BlockDef{
		ID: "trigger.backup", Category: "trigger", Label: "Backup",
		Description: "Fires when a backup completes or fails.",
		IsTrigger:   true, ControlOutputs: []string{"onComplete", "onFailed"},
		DataInputs: []models.DataPort{
			{ID: "cooldownSeconds", Label: "Cooldown", Type: "number"},
		},
		DataOutputs: []models.DataPort{
			{ID: "filename", Label: "Backup filename", Type: "string"},
		},
		ConfigSchema: []models.ConfigField{
			{Key: "cooldownSeconds", Label: "Cooldown (seconds)", Type: "number", Default: 300},
		},
		Source: "native",
	}, triggerRouted))

	must(r.RegisterBlock(models.BlockDef{
		ID: "trigger.server", Category: "trigger", Label: "Server",
		Description: "Fires when the server starts, stops, or crashes.",
		IsTrigger:   true, ControlOutputs: []string{"onComplete"},
		DataInputs: []models.DataPort{
			{ID: "cooldownSeconds", Label: "Cooldown", Type: "number"},
		},
		ConfigSchema: []models.ConfigField{
			{Key: "type", Label: "Type", Type: "select", Default: "Stopped", Required: true,
				Options: []models.FieldOption{
					{Label: "Stopped", Value: "Stopped"},
					{Label: "Started", Value: "Started"},
					{Label: "Crashed", Value: "Crashed"},
				}},
			{Key: "cooldownSeconds", Label: "Cooldown (seconds)", Type: "number", Default: 300},
		},
		Source: "native",
	}, triggerNoOp))

	must(r.RegisterBlock(models.BlockDef{
		ID: "trigger.interval", Category: "trigger", Label: "Interval",
		Description: "Fires repeatedly on a fixed interval.",
		IsTrigger:   true, ControlOutputs: []string{"onComplete"},
		DataInputs: []models.DataPort{
			{ID: "intervalMinutes", Label: "Interval", Type: "number"},
		},
		ConfigSchema: []models.ConfigField{
			{Key: "intervalMinutes", Label: "Interval (minutes)", Type: "number", Default: 60, Required: true},
		},
		Source: "native",
	}, triggerNoOp))

	must(r.RegisterBlock(models.BlockDef{
		ID: "trigger.timeOfDay", Category: "trigger", Label: "Time of Day",
		Description: "Fires once per day at a specific time.",
		IsTrigger:   true, ControlOutputs: []string{"onComplete"},
		DataInputs: []models.DataPort{
			{ID: "time", Label: "Time", Type: "string"},
		},
		ConfigSchema: []models.ConfigField{
			{Key: "time", Label: "Time (HH:MM)", Type: "string", Default: "00:00", Required: true},
		},
		Source: "native",
	}, triggerNoOp))

	must(r.RegisterBlock(models.BlockDef{
		ID: "trigger.cron", Category: "trigger", Label: "Cron Schedule",
		Description: "Fires on a cron expression (m h dom mon dow).",
		IsTrigger:   true, ControlOutputs: []string{"onComplete"},
		DataInputs: []models.DataPort{
			{ID: "cron", Label: "Cron", Type: "string"},
		},
		ConfigSchema: []models.ConfigField{
			{Key: "cron", Label: "Cron expression", Type: "string", Default: "0 * * * *", Required: true},
		},
		Source: "native",
	}, triggerNoOp))

	must(r.RegisterBlock(models.BlockDef{
		ID: "trigger.tpsThreshold", Category: "trigger", Label: "TPS Below Threshold",
		Description: "Fires when TPS drops below a threshold.",
		IsTrigger:   true, ControlOutputs: []string{"onComplete"},
		DataInputs: []models.DataPort{
			{ID: "threshold", Label: "Threshold", Type: "number"},
			{ID: "cooldownSeconds", Label: "Cooldown", Type: "number"},
		},
		DataOutputs: []models.DataPort{{ID: "tps", Label: "Current TPS", Type: "number"}},
		ConfigSchema: []models.ConfigField{
			{Key: "threshold", Label: "TPS threshold", Type: "number", Default: 14, Required: true},
			{Key: "cooldownSeconds", Label: "Cooldown (seconds)", Type: "number", Default: 300},
		},
		Source: "native",
	}, triggerNoOp))

	// ── Actions ───────────────────────────────────────────────────────────────

	must(r.RegisterBlock(models.BlockDef{
		ID: "action.command", Category: "action", Label: "Command",
		Description:   "Sends a command to the server, or manages the server lifecycle via presets.",
		ControlInputs: []string{"trigger"}, ControlOutputs: []string{"onComplete", "onFailed"},
		DataInputs:  []models.DataPort{{ID: "command", Label: "Command", Type: "string"}},
		DataOutputs: []models.DataPort{{ID: "command", Label: "Command sent", Type: "string"}},
		ConfigSchema: []models.ConfigField{
			{Key: "preset", Label: "Preset", Type: "select", Default: "",
				Options: []models.FieldOption{
					{Label: "— none —", Value: ""},
					{Label: "Start Server", Value: "__start__"},
					{Label: "Stop Server", Value: "__stop__"},
					{Label: "Restart Server", Value: "__restart__"},
					{Label: "Save All", Value: "save-all"},
					{Label: "Freeze Time", Value: "time set 18000"},
					{Label: "Set Day", Value: "time set day"},
					{Label: "Set Night", Value: "time set night"},
				}},
			{Key: "command", Label: "Command", Type: "command"},
		},
		Source: "native",
	}, execCommand))

	must(r.RegisterBlock(models.BlockDef{
		ID: "action.rcon", Category: "action", Label: "RCON Command",
		Description:   "Sends a command via RCON and captures the response.",
		ControlInputs: []string{"trigger"}, ControlOutputs: []string{"onComplete", "onFailed"},
		DataInputs:  []models.DataPort{{ID: "command", Label: "Command", Type: "string"}},
		DataOutputs: []models.DataPort{{ID: "response", Label: "Response", Type: "string"}},
		ConfigSchema: []models.ConfigField{
			{Key: "preset", Label: "Preset", Type: "select", Default: "",
				Options: []models.FieldOption{
					{Label: "— none —", Value: ""},
					{Label: "Save All", Value: "save-all"},
					{Label: "Freeze Time", Value: "time set 18000"},
					{Label: "Set Day", Value: "time set day"},
					{Label: "Set Night", Value: "time set night"},
				}},
			{Key: "command", Label: "Command", Type: "command", Required: true},
		},
		Source: "native",
	}, execRcon))

	must(r.RegisterBlock(models.BlockDef{
		ID: "action.backup", Category: "action", Label: "Create Backup",
		Description:   "Creates a backup of the active server's world.",
		ControlInputs: []string{"trigger"}, ControlOutputs: []string{"onComplete", "onFailed"},
		DataOutputs: []models.DataPort{{ID: "filename", Label: "Backup filename", Type: "string"}},
		Source:      "native",
	}, execBackup))

	must(r.RegisterBlock(models.BlockDef{
		ID: "data.writeAttribute", Category: "data", Label: "Write Attribute",
		Description:   "Writes a server attribute (e.g. @server.motd) or defines a custom in-flow attribute (@myvalue). Value may be an expression like @{ @players.count * 2 }.",
		ControlInputs: []string{"trigger"}, ControlOutputs: []string{"onComplete", "onFailed"},
		DataInputs: []models.DataPort{{ID: "value", Label: "Value", Type: "string"}},
		ConfigSchema: []models.ConfigField{
			{Key: "attribute", Label: "Attribute", Type: "attribute", Default: "server.motd", Required: true,
				Options: []models.FieldOption{
					{Label: "@players.max", Value: "players.max"},
					{Label: "@server.motd", Value: "server.motd"},
					{Label: "@server.whitelist", Value: "server.whitelist"},
					{Label: "@server.port", Value: "server.port"},
					{Label: "@server.gamemode", Value: "server.gamemode"},
					{Label: "@server.world", Value: "server.world"},
				}},
			{Key: "value", Label: "Value", Type: "string", Required: true},
		},
		Source: "native",
	}, execWriteAttribute))

	must(r.RegisterBlock(models.BlockDef{
		ID: "action.httpRequest", Category: "action", Label: "HTTP Request",
		Description:   "Sends an HTTP request (webhooks, APIs, playit, etc.).",
		ControlInputs: []string{"trigger"}, ControlOutputs: []string{"onComplete", "onFailed"},
		DataInputs: []models.DataPort{
			{ID: "url", Label: "URL", Type: "string"},
			{ID: "body", Label: "Request body", Type: "string"},
			{ID: "contentType", Label: "Content-Type", Type: "string"},
		},
		DataOutputs: []models.DataPort{
			{ID: "status", Label: "HTTP status", Type: "number"},
			{ID: "body", Label: "Response body", Type: "string"},
		},
		ConfigSchema: []models.ConfigField{
			{Key: "method", Label: "Method", Type: "select", Default: "POST",
				Options: []models.FieldOption{
					{Label: "GET", Value: "GET"}, {Label: "POST", Value: "POST"},
					{Label: "PUT", Value: "PUT"}, {Label: "PATCH", Value: "PATCH"},
					{Label: "DELETE", Value: "DELETE"},
				}},
			{Key: "url", Label: "URL", Type: "string", Required: true},
			{Key: "body", Label: "Request body", Type: "string"},
			{Key: "contentType", Label: "Content-Type", Type: "string", Default: "application/json"},
		},
		Source: "native",
	}, execHTTP))

	must(r.RegisterBlock(models.BlockDef{
		ID: "action.delay", Category: "action", Label: "Delay",
		Description:   "Waits for the specified number of seconds.",
		ControlInputs: []string{"trigger"}, ControlOutputs: []string{"onComplete", "onFailed"},
		DataInputs: []models.DataPort{
			{ID: "seconds", Label: "Seconds", Type: "number"},
		},
		ConfigSchema: []models.ConfigField{
			{Key: "seconds", Label: "Seconds", Type: "number", Default: 5, Required: true},
		},
		Source: "native",
	}, execDelay))

	must(r.RegisterBlock(models.BlockDef{
		ID: "action.notify", Category: "notify", Label: "Notify",
		Description:   "Sends an in-app notification.",
		ControlInputs: []string{"trigger"}, ControlOutputs: []string{"onComplete"},
		DataInputs: []models.DataPort{{ID: "message", Label: "Message", Type: "string"}},
		ConfigSchema: []models.ConfigField{
			{Key: "kind", Label: "Kind", Type: "select", Default: "info",
				Options: []models.FieldOption{
					{Label: "Info", Value: "info"}, {Label: "Warning", Value: "warn"},
					{Label: "Error", Value: "error"},
				}},
			{Key: "message", Label: "Message", Type: "string", Required: true},
		},
		Source: "native",
	}, execNotify))

	// ── Control ───────────────────────────────────────────────────────────────

	must(r.RegisterBlock(models.BlockDef{
		ID: "control.condition", Category: "control", Label: "Condition",
		Description:   "Branches based on a comparison.",
		ControlInputs: []string{"trigger"}, ControlOutputs: []string{"onTrue", "onFalse"},
		DataInputs: []models.DataPort{
			{ID: "left", Label: "A", Type: "string"},
			{ID: "right", Label: "B", Type: "string"},
		},
		ConfigSchema: []models.ConfigField{
			{Key: "left", Label: "Left value", Type: "string", Required: true},
			{Key: "op", Label: "Operator", Type: "select", Default: "eq",
				Options: []models.FieldOption{
					{Label: "==", Value: "eq"}, {Label: "!=", Value: "ne"},
					{Label: ">", Value: "gt"}, {Label: "<", Value: "lt"},
					{Label: "contains", Value: "contains"},
				}},
			{Key: "right", Label: "Right value", Type: "string", Required: true},
		},
		Source: "native",
	}, execCondition))
}

// ── Executors ─────────────────────────────────────────────────────────────────

// triggerNoOp is used for triggers that are entry points only.
func triggerNoOp(e *ExecContext) ExecResult { return ExecResult{Port: "onComplete"} }

// triggerRouted reads _route from the seeded data to pick the fired port.
// Used by trigger.backup which can route to onComplete or onFailed.
func triggerRouted(e *ExecContext) ExecResult {
	port := e.GetString("_route")
	if port == "" {
		port = "onComplete"
	}
	return ExecResult{Port: port}
}

func execCommand(e *ExecContext) ExecResult {
	// Preset takes precedence, then wired/config command.
	cmd := e.GetString("preset")
	if cmd == "" {
		cmd = e.GetString("command")
	}
	if cmd == "" {
		return ExecResult{Port: "onFailed", Err: fmt.Errorf("command is empty")}
	}

	var err error
	switch cmd {
	case "__start__":
		cfg, cfgErr := e.Config_().GetServerConfig(e.ServerID)
		if cfgErr != nil {
			return ExecResult{Port: "onFailed", Err: cfgErr}
		}
		err = e.Server().Start(cfg.ID, cfg.JarPath, cfg.JvmArgs, cfg.WorkingDir)
	case "__stop__":
		err = e.Server().Stop(e.ServerID, e.Config_().StopGrace())
	case "__restart__":
		cfg, cfgErr := e.Config_().GetServerConfig(e.ServerID)
		if cfgErr != nil {
			return ExecResult{Port: "onFailed", Err: cfgErr}
		}
		err = e.Server().Restart(cfg.ID, cfg.JarPath, cfg.JvmArgs, cfg.WorkingDir, e.Config_().StopGrace())
	default:
		err = e.Server().SendCommand(e.ServerID, cmd)
	}

	if err != nil {
		return ExecResult{Port: "onFailed", Err: err}
	}
	e.SetOutput("command", cmd)
	return ExecResult{Port: "onComplete"}
}

func execRcon(e *ExecContext) ExecResult {
	addr, pw, ok := e.Server().RconConfig(e.ServerID)
	if !ok {
		return ExecResult{Port: "onFailed", Err: fmt.Errorf("RCON not enabled or not running")}
	}
	cmd := e.GetString("preset")
	if cmd == "" {
		cmd = e.GetString("command")
	}
	if cmd == "" {
		return ExecResult{Port: "onFailed", Err: fmt.Errorf("command is empty")}
	}
	resp, err := e.Rcon().Execute(addr, pw, cmd)
	if err != nil {
		return ExecResult{Port: "onFailed", Err: err}
	}
	e.SetOutput("response", resp)
	return ExecResult{Port: "onComplete"}
}

func execBackup(e *ExecContext) ExecResult {
	b, err := e.Backup().CreateBackup(e.ServerID)
	if err != nil {
		return ExecResult{Port: "onFailed", Err: err}
	}
	e.SetOutput("filename", b.Filename)
	return ExecResult{Port: "onComplete"}
}

func execWriteAttribute(e *ExecContext) ExecResult {
	attr := strings.TrimPrefix(e.GetString("attribute"), "@")
	value := e.GetString("value")

	meta, known := builtinAttrs[attr]
	if known && !meta.Writable {
		return ExecResult{Port: "onFailed", Err: fmt.Errorf("attribute @%s is read-only", attr)}
	}
	if !known {
		// Custom in-flow attribute: store the raw value expression so it stays
		// lazy (re-evaluated on each reference), rather than its resolved value.
		if e.Attrs == nil {
			return ExecResult{Port: "onFailed", Err: fmt.Errorf("no attribute scope available")}
		}
		raw := e.RawString("value")
		if raw == "" {
			raw = value // wired or literal value with no raw expression
		}
		e.Attrs.Define(attr, raw)
		return ExecResult{Port: "onComplete"}
	}

	cfg, err := e.Config_().GetServerConfig(e.ServerID)
	if err != nil {
		return ExecResult{Port: "onFailed", Err: err}
	}
	propsPath := filepath.Join(cfg.WorkingDir, "server.properties")

	switch attr {
	case "players.max":
		if writeErr := writeProperty(propsPath, "max-players", value); writeErr != nil {
			return ExecResult{Port: "onFailed", Err: writeErr}
		}
	case "server.motd":
		if writeErr := writeProperty(propsPath, "motd", value); writeErr != nil {
			return ExecResult{Port: "onFailed", Err: writeErr}
		}
	case "server.whitelist":
		if writeErr := writeProperty(propsPath, "white-list", value); writeErr != nil {
			return ExecResult{Port: "onFailed", Err: writeErr}
		}
		// Also apply at runtime via console command if server is running.
		cmd := "whitelist off"
		if value == "true" || value == "1" {
			cmd = "whitelist on"
		}
		_ = e.Server().SendCommand(e.ServerID, cmd) //nolint:errcheck // UX nicety only; writeProperty above already persisted the source of truth
	case "server.port":
		if writeErr := writeProperty(propsPath, "server-port", value); writeErr != nil {
			return ExecResult{Port: "onFailed", Err: writeErr}
		}
	case "server.gamemode":
		if writeErr := writeProperty(propsPath, "gamemode", value); writeErr != nil {
			return ExecResult{Port: "onFailed", Err: writeErr}
		}
		_ = e.Server().SendCommand(e.ServerID, "defaultgamemode "+value) //nolint:errcheck // UX nicety only; writeProperty above already persisted the source of truth
	case "server.world":
		if writeErr := writeProperty(propsPath, "level-name", value); writeErr != nil {
			return ExecResult{Port: "onFailed", Err: writeErr}
		}
	default:
		return ExecResult{Port: "onFailed", Err: fmt.Errorf("unknown attribute %q", attr)}
	}
	return ExecResult{Port: "onComplete"}
}

func execHTTP(e *ExecContext) ExecResult {
	method := strings.ToUpper(e.GetString("method"))
	if method == "" {
		method = "POST"
	}
	url := e.GetString("url")
	if url == "" {
		return ExecResult{Port: "onFailed", Err: fmt.Errorf("url is empty")}
	}
	body := e.GetString("body")
	contentType := e.GetString("contentType")
	if contentType == "" {
		contentType = "application/json"
	}

	var reqBody io.Reader
	if body != "" {
		reqBody = strings.NewReader(body)
	}

	req, err := http.NewRequestWithContext(e.Ctx, method, url, reqBody)
	if err != nil {
		return ExecResult{Port: "onFailed", Err: err}
	}
	if body != "" {
		req.Header.Set("Content-Type", contentType)
	}

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return ExecResult{Port: "onFailed", Err: err}
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	e.SetOutput("status", float64(resp.StatusCode))
	e.SetOutput("body", string(respBody))

	if resp.StatusCode >= 400 {
		return ExecResult{Port: "onFailed", Err: fmt.Errorf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))}
	}
	return ExecResult{Port: "onComplete"}
}

func execDelay(e *ExecContext) ExecResult {
	secs := e.GetFloat("seconds", 5)
	if secs < 0 {
		secs = 0
	}
	select {
	case <-time.After(time.Duration(secs * float64(time.Second))):
		return ExecResult{Port: "onComplete"}
	case <-e.Ctx.Done():
		return ExecResult{Port: "onFailed", Err: fmt.Errorf("delay cancelled: %w", e.Ctx.Err())}
	}
}

func execNotify(e *ExecContext) ExecResult {
	kind := e.GetString("kind")
	if kind == "" {
		kind = "info"
	}
	msg := e.GetString("message")
	e.Emit(EventScheduleNotify, map[string]interface{}{"kind": kind, "message": msg})
	return ExecResult{Port: "onComplete"}
}

func execCondition(e *ExecContext) ExecResult {
	left := fmt.Sprintf("%v", e.GetString("left"))
	right := fmt.Sprintf("%v", e.GetString("right"))
	op := e.GetString("op")

	var result bool
	switch op {
	case "eq":
		result = left == right
	case "ne":
		result = left != right
	case "gt":
		result = left > right
	case "lt":
		result = left < right
	case "contains":
		result = strings.Contains(left, right)
	default:
		result = left == right
	}

	if result {
		return ExecResult{Port: "onTrue"}
	}
	return ExecResult{Port: "onFalse"}
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}

// ── Data / attribute blocks ────────────────────────────────────────────────────

func registerDataBuiltins(r *BlockRegistry) {
	must(r.RegisterBlock(models.BlockDef{
		ID: "data.serverAttribute", Category: "data", Label: "Read Attribute",
		Description: "Reads a live server attribute or a custom in-flow attribute defined upstream.",
		DataOutputs: []models.DataPort{{ID: "value", Label: "Value", Type: "auto"}},
		ConfigSchema: []models.ConfigField{
			{Key: "attribute", Label: "Attribute", Type: "attribute", Default: "tps", Required: true,
				Options: []models.FieldOption{
					// Read-only
					{Label: "@tps", Value: "tps"},
					{Label: "@players.count", Value: "players.count"},
					{Label: "@ram.used (MB)", Value: "ram.used"},
					{Label: "@ram.left (MB)", Value: "ram.left"},
					{Label: "@server.status", Value: "server.status"},
					// Read & Write
					{Label: "@players.max", Value: "players.max"},
					{Label: "@ram.total (MB)", Value: "ram.total"},
					{Label: "@server.whitelist", Value: "server.whitelist"},
					{Label: "@server.port", Value: "server.port"},
					{Label: "@server.gamemode", Value: "server.gamemode"},
					{Label: "@server.motd", Value: "server.motd"},
					{Label: "@server.world", Value: "server.world"},
				}},
			{Key: "type", Label: "Data type", Type: "select", Default: "auto",
				Options: []models.FieldOption{
					{Label: "Auto", Value: "auto"},
					{Label: "String", Value: "string"},
					{Label: "Number", Value: "number"},
					{Label: "Boolean", Value: "bool"},
				}},
		},
		Source: "native",
	}, execServerAttribute))

	must(r.RegisterBlock(models.BlockDef{
		ID: "data.constant", Category: "data", Label: "Constant",
		Description: "Outputs a fixed typed value.",
		DataOutputs: []models.DataPort{{ID: "value", Label: "Value", Type: "auto"}},
		ConfigSchema: []models.ConfigField{
			{Key: "type", Label: "Type", Type: "select", Default: "String",
				Options: []models.FieldOption{
					{Label: "String", Value: "String"},
					{Label: "Float", Value: "Float"},
					{Label: "Integer", Value: "Integer"},
					{Label: "Boolean", Value: "Boolean"},
				}},
			{Key: "value", Label: "Value", Type: "string", Required: true},
		},
		Source: "native",
	}, execConstant))

	must(r.RegisterBlock(models.BlockDef{
		ID: "data.randomNumber", Category: "data", Label: "Random Number",
		Description: "Outputs a random number between min and max.",
		DataInputs: []models.DataPort{
			{ID: "min", Label: "Min", Type: "number"},
			{ID: "max", Label: "Max", Type: "number"},
		},
		DataOutputs: []models.DataPort{{ID: "value", Label: "Value", Type: "number"}},
		ConfigSchema: []models.ConfigField{
			{Key: "min", Label: "Min", Type: "number", Default: 1},
			{Key: "max", Label: "Max", Type: "number", Default: 100},
		},
		Source: "native",
	}, execRandomNumber))

	must(r.RegisterBlock(models.BlockDef{
		ID: "data.mathOp", Category: "data", Label: "Math",
		Description: "Performs arithmetic on two values.",
		DataInputs: []models.DataPort{
			{ID: "a", Label: "A", Type: "number"},
			{ID: "b", Label: "B", Type: "number"},
		},
		DataOutputs: []models.DataPort{{ID: "result", Label: "Result", Type: "number"}},
		ConfigSchema: []models.ConfigField{
			{Key: "a", Label: "A", Type: "number", Default: 0},
			{Key: "op", Label: "Operator", Type: "select", Default: "add",
				Options: []models.FieldOption{
					{Label: "+ add", Value: "add"}, {Label: "- subtract", Value: "sub"},
					{Label: "× multiply", Value: "mul"}, {Label: "÷ divide", Value: "div"},
					{Label: "% mod", Value: "mod"}, {Label: "Δ difference", Value: "diff"},
				}},
			{Key: "b", Label: "B", Type: "number", Default: 0},
		},
		Source: "native",
	}, execMathOp))
}

// ── Data executors ────────────────────────────────────────────────────────────

func execServerAttribute(e *ExecContext) ExecResult {
	attr := strings.TrimPrefix(e.GetString("attribute"), "@")
	if e.Attrs == nil {
		return ExecResult{Port: "onFailed", Err: fmt.Errorf("no attribute scope")}
	}
	val, err := e.Attrs.Resolve(attr)
	if err != nil {
		return ExecResult{Port: "onFailed", Err: err}
	}
	if typeErr := checkAttrType(val, e.GetString("type")); typeErr != nil {
		return ExecResult{Port: "onFailed", Err: fmt.Errorf("@%s: %w", attr, typeErr)}
	}
	e.SetOutput("value", val)
	return ExecResult{Port: "onComplete"}
}

func attrToPropertyKey(attr string) string {
	switch attr {
	case "server.whitelist":
		return "white-list"
	case "server.port":
		return "server-port"
	case "server.gamemode":
		return "gamemode"
	case "server.motd":
		return "motd"
	case "server.world":
		return "level-name"
	}
	return attr
}

func execConstant(e *ExecContext) ExecResult {
	// Wired input overrides config value.
	raw := e.GetString("value")
	typ := e.GetString("type")

	switch typ {
	case "Float":
		f, err := strconv.ParseFloat(raw, 64)
		if err != nil {
			return ExecResult{Port: "onFailed", Err: fmt.Errorf("cannot parse %q as float: %w", raw, err)}
		}
		e.SetOutput("value", f)
	case "Integer":
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			return ExecResult{Port: "onFailed", Err: fmt.Errorf("cannot parse %q as integer: %w", raw, err)}
		}
		e.SetOutput("value", float64(n))
	case "Boolean":
		v := raw == "true" || raw == "1"
		boolVal := float64(0)
		if v {
			boolVal = 1
		}
		e.SetOutput("value", boolVal)
	default: // String
		e.SetOutput("value", raw)
	}
	return ExecResult{Port: "onComplete"}
}

func execRandomNumber(e *ExecContext) ExecResult {
	min := e.GetFloat("min", 1)
	max := e.GetFloat("max", 100)
	if max < min {
		max = min
	}
	e.SetOutput("value", min+rand.Float64()*(max-min))
	return ExecResult{Port: "onComplete"}
}

func execMathOp(e *ExecContext) ExecResult {
	a := e.GetFloat("a", 0)
	b := e.GetFloat("b", 0)
	var result float64
	switch e.GetString("op") {
	case "add":
		result = a + b
	case "sub":
		result = a - b
	case "mul":
		result = a * b
	case "div":
		if b == 0 {
			return ExecResult{Port: "onFailed", Err: fmt.Errorf("division by zero")}
		}
		result = a / b
	case "mod":
		if b == 0 {
			return ExecResult{Port: "onFailed", Err: fmt.Errorf("modulo by zero")}
		}
		result = float64(int(a) % int(b))
	case "diff":
		result = a - b
		if result < 0 {
			result = -result
		}
	default:
		result = a + b
	}
	e.SetOutput("result", result)
	return ExecResult{Port: "onComplete"}
}
