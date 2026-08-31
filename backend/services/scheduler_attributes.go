package services

import (
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
)

// attrMeta describes a built-in server attribute's type and whether the
// Write Attribute node can write it.
type attrMeta struct {
	Type     string // "number" | "string" | "bool"
	Writable bool
}

// builtinAttrs is the central schema of server attributes referenceable via @name.
// Writable entries must have a corresponding case in execWriteAttribute.
var builtinAttrs = map[string]attrMeta{
	// Read-only
	"tps":           {Type: "number", Writable: false},
	"players.count": {Type: "number", Writable: false},
	"ram.used":      {Type: "number", Writable: false},
	"ram.left":      {Type: "number", Writable: false},
	"ram.total":     {Type: "number", Writable: false},
	"server.status": {Type: "bool", Writable: false},
	// Read & write
	"players.max":      {Type: "number", Writable: true},
	"server.whitelist": {Type: "bool", Writable: true},
	"server.port":      {Type: "number", Writable: true},
	"server.gamemode":  {Type: "number", Writable: true},
	"server.motd":      {Type: "string", Writable: true},
	"server.world":     {Type: "string", Writable: true},
}

// readBuiltinAttribute resolves a built-in server attribute to its live value.
// Used by the Read Attribute node, the expression evaluator, and the preview.
func readBuiltinAttribute(deps serviceDeps, serverID, name string) (interface{}, error) {
	srv := deps.server
	switch name {
	case "tps":
		return srv.CurrentTPS(), nil
	case "players.count":
		return float64(srv.PlayerCount()), nil
	case "ram.used":
		return srv.RAMUsedMB(), nil
	case "ram.left":
		return srv.RAMTotalMB() - srv.RAMUsedMB(), nil
	case "ram.total":
		return srv.RAMTotalMB(), nil
	case "server.status":
		if srv.IsRunning(serverID) {
			return float64(1), nil
		}
		return float64(0), nil
	case "players.max":
		return float64(srv.MaxPlayers()), nil
	case "server.whitelist", "server.port", "server.gamemode", "server.motd", "server.world":
		cfg, err := deps.config.GetServerConfig(serverID)
		if err != nil {
			return nil, fmt.Errorf("cannot read server.properties: %w", err)
		}
		props, err := readProperties(filepath.Join(cfg.WorkingDir, "server.properties"))
		if err != nil {
			return nil, err
		}
		return props[attrToPropertyKey(name)], nil
	default:
		return nil, fmt.Errorf("unknown attribute %q", name)
	}
}

// AttrScope resolves @attribute references during a run (or a dry-run preview).
// It blends live built-in attributes with run-scoped custom attributes, which
// are stored as raw expressions and evaluated lazily ("pulled when needed").
type AttrScope struct {
	serverID string
	deps     serviceDeps
	custom   map[string]string // name -> raw value expression
	visiting map[string]bool   // cycle guard for custom evaluation
}

func newAttrScope(deps serviceDeps, serverID string, custom map[string]string) *AttrScope {
	if custom == nil {
		custom = map[string]string{}
	}
	return &AttrScope{serverID: serverID, deps: deps, custom: custom, visiting: map[string]bool{}}
}

// Define registers (or overwrites) a custom attribute's raw value expression.
func (a *AttrScope) Define(name, expr string) {
	a.custom[name] = expr
}

// IsCustom reports whether name is a run-scoped custom attribute.
func (a *AttrScope) IsCustom(name string) bool {
	_, ok := a.custom[name]
	return ok
}

// Resolve returns the live value of an attribute, evaluating custom-attribute
// expressions lazily. Cycles among custom attributes return an error.
func (a *AttrScope) Resolve(name string) (interface{}, error) {
	if expr, ok := a.custom[name]; ok {
		if a.visiting[name] {
			return nil, fmt.Errorf("attribute cycle at @%s", name)
		}
		a.visiting[name] = true
		defer delete(a.visiting, name)
		return resolveCustomValue(expr, a)
	}
	return readBuiltinAttribute(a.deps, a.serverID, name)
}

// checkAttrType returns an error if val does not match the declared type.
// declaredType is one of "string", "number", "bool", or "" / "auto" (no check).
func checkAttrType(val interface{}, declaredType string) error {
	if declaredType == "" || declaredType == "auto" {
		return nil
	}
	switch declaredType {
	case "number":
		switch val.(type) {
		case float64, int, int64:
			return nil
		}
	case "string":
		if _, ok := val.(string); ok {
			return nil
		}
	case "bool":
		switch v := val.(type) {
		case bool:
			return nil
		case float64:
			if v == 0 || v == 1 {
				return nil
			}
		}
	}
	return fmt.Errorf("expected %s, got %s", declaredType, goTypeLabel(val))
}

func goTypeLabel(v interface{}) string {
	switch v.(type) {
	case float64, int, int64:
		return "number"
	case string:
		return "string"
	case bool:
		return "bool"
	case nil:
		return "null"
	}
	return "unknown"
}

// resolveCustomValue evaluates a custom attribute's raw value: an @{…} or @-ref
// expression is evaluated; a plain number becomes a float; anything else is a
// literal string.
func resolveCustomValue(raw string, scope *AttrScope) (interface{}, error) {
	t := strings.TrimSpace(raw)
	if strings.HasPrefix(t, "@{") && strings.HasSuffix(t, "}") {
		return evalExpr(t[2:len(t)-1], scope)
	}
	if strings.Contains(t, "@") {
		return evalExpr(t, scope)
	}
	if f, err := strconv.ParseFloat(t, 64); err == nil {
		return f, nil
	}
	return raw, nil
}
