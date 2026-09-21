package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// Per-server scoping, held mechanically (#237).
//
// #232, #233, #234 and #236 made the dashboard answer for one server at a
// time: a bound method that names a server takes its id, an event about a
// server carries its id, and the frontend filters on it. Every one of those
// defects arrived through a change that looked locally reasonable, so the two
// tests here read the source the way bindings_test.go reads the type graph and
// fail on the next one.
//
// Both walk the AST rather than diffing generated output, for the same reason
// that test gives: a new emit or a new bound method with the wrong shape fails
// here on the commit that adds it, not after someone regenerates something.
// They are not .claude/suite.json invariants because the condition spans
// lines: "this Emit's second argument, wherever it was built, has a serverID
// key" is not a regex that must find nothing.
//
// The frontend half is frontend/src/lib/serverScoping.test.ts, which mirrors
// the event classification below and checks the listeners.

// globalEvents are the constants in backend/services/events.go whose payload
// carries no server id, each with the reason. Every other Event* constant is
// server-scoped and its payload must carry "serverID" (a map key or a
// ServerID struct field). A new constant that is neither here nor emitted with
// a serverID fails the test, which is the point: the author decides which it
// is, in writing.
var globalEvents = map[string]string{
	"EventInstallStarted":  "the installer creates a server that does not exist yet",
	"EventInstallLog":      "same installer; the loader update reuses it, and the frontend already routes the line by which job is running",
	"EventInstallFinished": "same installer",
	"EventInstallFailed":   "same installer",
	"EventUpdateProgress":  "Konnekt updating itself",
	"EventCommandsChanged": "the Kommands link belongs to the app, not to a server",
	"EventScheduleNotify":  "a block's message to the user, shown app-wide; the block already ran against its graph's own server (#236)",
	"EventScheduleNextRuns": "one map keyed by graph id across every server; graph ids are unique and a graph belongs to one server, " +
		"so the reader scopes by graph rather than by a second id",
}

// dynamicEmits are Emit calls whose event or payload is a variable this test
// cannot follow, keyed "file.go:FuncName", each with the reason it is fine.
var dynamicEmits = map[string]string{
	"scheduler_registry.go:Emit": "ExecContext.Emit is the block-level seam; its one caller today sends schedule:notify, a global event, " +
		"and a block that emits a server-scoped event through it would be a new Emit call caught here as soon as it names a constant",
}

// serverlessMethods are the bound methods on App that take no serverID and
// carry none in a request struct, each with the reason. Every other method
// must take a parameter named serverID, or a struct from backend/models with
// a ServerID field. A method added without either fails here until it is
// listed with a reason, and an entry stays only while its method still needs
// it.
var serverlessMethods = map[string]string{
	"BrowseJarFile":            "a native file dialog; no server involved",
	"BrowseDirectory":          "a native directory dialog; no server involved",
	"GetServerConfigs":         "lists every server",
	"SaveServerConfig":         "the config is the server; its ID field is the subject, not a scope",
	"DeleteServerConfig":       "the id is the subject, not a scope, and is named id for that reason",
	"GetActiveServerID":        "the selection itself",
	"SetActiveServerID":        "the selection itself",
	"GetAppSettings":           "app-level",
	"SaveAppSettings":          "app-level",
	"OpenDataDir":              "app-level",
	"GetDataDir":               "app-level",
	"GetLogPath":               "app-level; one log file for the app",
	"LogClientError":           "app-level",
	"GetAppVersion":            "app-level",
	"CheckForUpdates":          "Konnekt updating itself",
	"DownloadAndInstallUpdate": "Konnekt updating itself",
	"InspectServerFile":        "inspects a jar before any server exists",
	"InstallServer":            "creates the server; there is no id until it is saved",
	"AbortInstall":             "the installer runs one job at a time and has no server yet",
	"GetLastStop": "answers for the current server; unused by the frontend, and its own comment says it takes an id " +
		"the day a caller needs one, so the twin of server:stopped stays a getter until then",
	"GetLayoutPresets":     "the canvas layout is the app's, not a server's",
	"SaveLayoutPreset":     "the canvas layout is the app's, not a server's",
	"DeleteLayoutPreset":   "the canvas layout is the app's, not a server's",
	"GetActiveTiles":       "the canvas layout is the app's, not a server's",
	"SaveActiveTiles":      "the canvas layout is the app's, not a server's",
	"GetTileLayouts":       "the canvas layout is the app's, not a server's",
	"SaveTileLayouts":      "the canvas layout is the app's, not a server's",
	"GetActiveLayout":      "the canvas layout is the app's, not a server's",
	"SaveActiveLayout":     "the canvas layout is the app's, not a server's",
	"GetCustomCommands":    "one custom_commands.json for the app",
	"GetCommandButtons":    "the quick-commands grid is the app's",
	"SaveCommandButtons":   "the quick-commands grid is the app's",
	"RefreshKommands":      "the Kommands link belongs to the app",
	"GetKommandsCommands":  "the Kommands link belongs to the app",
	"GetScheduleBlockDefs": "static block definitions",
	"GetScheduleNextRuns":  "keyed by graph id across every server; see EventScheduleNextRuns above",
	"ModGetProject":        "a provider lookup, not a server operation",
	"ModGetAllVersions":    "a provider lookup, not a server operation",
}

const serverIDKey = "serverID"

func TestServerScopedEventPayloadsCarryAServerID(t *testing.T) {
	fset := token.NewFileSet()
	services := parseGoDir(t, fset, filepath.Join("backend", "services"))
	root := parseGoFile(t, fset, "app.go")

	// Every constant events.go declares is classified, one way or the other.
	events := eventConstants(t, services["events.go"])
	for name := range globalEvents {
		if !events[name] {
			t.Errorf("globalEvents names %s, which backend/services/events.go no longer declares", name)
		}
	}
	scoped := map[string]bool{}
	for name := range events {
		if _, global := globalEvents[name]; !global {
			scoped[name] = true
		}
	}
	if len(scoped) < 20 {
		t.Fatalf("only %d server-scoped event constants found; the walk is not seeing events.go", len(scoped))
	}

	files := map[string]*ast.File{"app.go": root}
	for name, f := range services {
		files[name] = f
	}

	seenDynamic := map[string]bool{}
	checked := 0
	for fileName, f := range files {
		for _, decl := range f.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Body == nil {
				continue
			}
			literals := compositeLiteralsIn(fn)
			ast.Inspect(fn.Body, func(n ast.Node) bool {
				call, ok := n.(*ast.CallExpr)
				if !ok || len(call.Args) != 2 {
					return true
				}
				sel, ok := call.Fun.(*ast.SelectorExpr)
				if !ok || sel.Sel.Name != "Emit" {
					return true
				}
				pos := fset.Position(call.Pos())
				where := filepath.Base(pos.Filename) + ":" + strconv.Itoa(pos.Line)

				eventName, static := call.Args[0].(*ast.Ident)
				if static && strings.HasPrefix(eventName.Name, "Event") {
					if !events[eventName.Name] {
						t.Errorf("%s emits %s, which events.go does not declare", where, eventName.Name)
						return true
					}
					if !scoped[eventName.Name] {
						return true
					}
				} else {
					// The event is a variable. The payload still has to carry
					// the id, unless the call is listed as one this test cannot
					// follow.
					key := fileName + ":" + fn.Name.Name
					if _, ok := dynamicEmits[key]; ok {
						seenDynamic[key] = true
						return true
					}
				}

				checked++
				if why := payloadLacksServerID(call.Args[1], literals); why != "" {
					t.Errorf("%s: %s.\nA server-scoped event carries %q so the frontend can filter it (#233). "+
						"Add the key, or if this event is global, list it in globalEvents with the reason.",
						where, why, serverIDKey)
				}
				return true
			})
		}
	}

	for key := range dynamicEmits {
		if !seenDynamic[key] {
			t.Errorf("dynamicEmits lists %s, which no longer exists or now names its event; drop the entry", key)
		}
	}
	if checked < 30 {
		t.Errorf("only %d server-scoped emits checked; the walk is not seeing the services", checked)
	}
}

// payloadLacksServerID reports why the expression does not visibly carry a
// serverID, or "" if it does. A composite literal is read directly; an
// identifier is followed to the composite literal assigned to it in the same
// function.
func payloadLacksServerID(arg ast.Expr, literals map[string]*ast.CompositeLit) string {
	switch e := arg.(type) {
	case *ast.CompositeLit:
		if compositeCarriesServerID(e) {
			return ""
		}
		return "payload literal has no " + serverIDKey + " key or ServerID field"
	case *ast.Ident:
		lit, ok := literals[e.Name]
		if !ok {
			return "payload " + e.Name + " is not a composite literal built in this function, so its keys cannot be read here"
		}
		if compositeCarriesServerID(lit) {
			return ""
		}
		return "payload " + e.Name + " is built without a " + serverIDKey + " key or ServerID field"
	default:
		return "payload is not a literal this test can read"
	}
}

func compositeCarriesServerID(lit *ast.CompositeLit) bool {
	for _, elt := range lit.Elts {
		kv, ok := elt.(*ast.KeyValueExpr)
		if !ok {
			continue
		}
		switch k := kv.Key.(type) {
		case *ast.BasicLit:
			if k.Value == `"`+serverIDKey+`"` {
				return true
			}
		case *ast.Ident:
			if k.Name == "ServerID" {
				return true
			}
		}
	}
	return false
}

// compositeLiteralsIn maps every identifier a function assigns a composite
// literal to, so `payload := map[string]string{...}; bus.Emit(ev, payload)`
// reads through.
func compositeLiteralsIn(fn *ast.FuncDecl) map[string]*ast.CompositeLit {
	out := map[string]*ast.CompositeLit{}
	ast.Inspect(fn.Body, func(n ast.Node) bool {
		switch s := n.(type) {
		case *ast.AssignStmt:
			for i, lhs := range s.Lhs {
				id, ok := lhs.(*ast.Ident)
				if !ok || i >= len(s.Rhs) {
					continue
				}
				if lit, ok := s.Rhs[i].(*ast.CompositeLit); ok {
					out[id.Name] = lit
				}
			}
		case *ast.ValueSpec:
			for i, name := range s.Names {
				if i < len(s.Values) {
					if lit, ok := s.Values[i].(*ast.CompositeLit); ok {
						out[name.Name] = lit
					}
				}
			}
		}
		return true
	})
	return out
}

func TestBoundMethodsThatActOnAServerTakeItsID(t *testing.T) {
	fset := token.NewFileSet()
	root := parseGoFile(t, fset, "app.go")
	models := parseGoDir(t, fset, filepath.Join("backend", "models"))
	structsWithServerID := structsWithField(models, "ServerID")

	seen := map[string]bool{}
	total := 0
	for _, decl := range root.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Recv == nil || !fn.Name.IsExported() || !isAppReceiver(fn) {
			continue
		}
		total++
		name := fn.Name.Name
		scopedByParam := false
		for _, field := range fn.Type.Params.List {
			for _, pname := range field.Names {
				if pname.Name == serverIDKey {
					scopedByParam = true
				}
			}
			if typeName := modelsTypeName(field.Type); typeName != "" && structsWithServerID[typeName] {
				scopedByParam = true
			}
		}
		reason, listed := serverlessMethods[name]
		switch {
		case scopedByParam && listed:
			t.Errorf("%s takes a server id now; drop it from serverlessMethods (it was listed as: %s)", name, reason)
		case !scopedByParam && !listed:
			t.Errorf("%s is bound without a serverID parameter or a request struct carrying ServerID.\n"+
				"A bound method that acts on a server takes its id and honours it (#237). "+
				"If it genuinely has no server, list it in serverlessMethods with the reason.", name)
		}
		seen[name] = true
	}
	for name := range serverlessMethods {
		if !seen[name] {
			t.Errorf("serverlessMethods lists %s, which app.go no longer binds; drop the entry", name)
		}
	}
	if total < 50 {
		t.Errorf("only %d bound methods found on App; the walk is not seeing app.go", total)
	}
}

func isAppReceiver(fn *ast.FuncDecl) bool {
	if len(fn.Recv.List) != 1 {
		return false
	}
	star, ok := fn.Recv.List[0].Type.(*ast.StarExpr)
	if !ok {
		return false
	}
	id, ok := star.X.(*ast.Ident)
	return ok && id.Name == "App"
}

// modelsTypeName returns X for a parameter typed models.X, or "".
func modelsTypeName(expr ast.Expr) string {
	sel, ok := expr.(*ast.SelectorExpr)
	if !ok {
		return ""
	}
	pkg, ok := sel.X.(*ast.Ident)
	if !ok || pkg.Name != "models" {
		return ""
	}
	return sel.Sel.Name
}

func structsWithField(files map[string]*ast.File, field string) map[string]bool {
	out := map[string]bool{}
	for _, f := range files {
		ast.Inspect(f, func(n ast.Node) bool {
			ts, ok := n.(*ast.TypeSpec)
			if !ok {
				return true
			}
			st, ok := ts.Type.(*ast.StructType)
			if !ok {
				return true
			}
			for _, fld := range st.Fields.List {
				for _, name := range fld.Names {
					if name.Name == field {
						out[ts.Name.Name] = true
					}
				}
			}
			return true
		})
	}
	return out
}

// eventConstants returns every Event* constant events.go declares.
func eventConstants(t *testing.T, f *ast.File) map[string]bool {
	t.Helper()
	out := map[string]bool{}
	for _, decl := range f.Decls {
		gd, ok := decl.(*ast.GenDecl)
		if !ok || gd.Tok != token.CONST {
			continue
		}
		for _, spec := range gd.Specs {
			vs, ok := spec.(*ast.ValueSpec)
			if !ok {
				continue
			}
			for _, name := range vs.Names {
				if strings.HasPrefix(name.Name, "Event") {
					out[name.Name] = true
				}
			}
		}
	}
	if len(out) == 0 {
		t.Fatal("no Event* constants found in backend/services/events.go")
	}
	return out
}

func parseGoDir(t *testing.T, fset *token.FileSet, dir string) map[string]*ast.File {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read %s: %v", dir, err)
	}
	out := map[string]*ast.File{}
	names := []string{}
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		out[name] = parseGoFile(t, fset, filepath.Join(dir, name))
	}
	return out
}

func parseGoFile(t *testing.T, fset *token.FileSet, path string) *ast.File {
	t.Helper()
	f, err := parser.ParseFile(fset, path, nil, 0)
	if err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	return f
}
