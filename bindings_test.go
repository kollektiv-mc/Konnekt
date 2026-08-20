package main

import (
	"reflect"
	"strings"
	"testing"
)

// Wails v2.12.0's binding generator walks a bound method's parameter and return
// types to decide which structs to emit into frontend/wailsjs/go/models.ts. It
// descends into pointers, slices, arrays and struct fields — but *not* into map
// values.
//
// So a method returning map[string]SomeStruct produces a
// `Record<string, models.SomeStruct>` in App.d.ts referencing a type models.ts
// never declares. Nothing catches that: tsconfig sets skipLibCheck, so the
// dangling reference is not an error, the return type silently degrades to any,
// and a JSON-tag rename on the Go side reaches the UI as undefined with a green
// pnpm typecheck and a green pnpm lint. ModCheckUpdates shipped exactly that
// bug (HEALTH_LOG.md, 2026-08-20).
//
// This is the guard. It lives here rather than as a script diffing the two
// generated files, or as a suite.json invariant, because the constraint is
// about Go's type graph and Go can read that directly. It also fails on a new
// method with the same shape, which a set-difference over today's generated
// output would only catch after someone regenerated.
//
// Maps of primitives are fine and stay allowed: GetScheduleNextRuns returns
// map[string]int64 and TypeScript's Record<string, number> needs no declaration.
func TestNoBoundMethodHidesAStructInsideAMapValue(t *testing.T) {
	appType := reflect.TypeOf(&App{})

	for i := range appType.NumMethod() {
		method := appType.Method(i)
		sig := method.Type

		// Skip the receiver at index 0.
		for p := 1; p < sig.NumIn(); p++ {
			if path := structInsideMapValue(sig.In(p), map[reflect.Type]bool{}); path != "" {
				t.Errorf("%s: parameter %d reaches a struct through a map value (%s).\n"+
					"Wails will not emit that struct into models.ts. Carry the key inside the "+
					"struct and pass a slice instead.", method.Name, p, path)
			}
		}
		for r := range sig.NumOut() {
			if path := structInsideMapValue(sig.Out(r), map[reflect.Type]bool{}); path != "" {
				t.Errorf("%s: return value %d reaches a struct through a map value (%s).\n"+
					"Wails will not emit that struct into models.ts. Carry the key inside the "+
					"struct and return a slice instead.", method.Name, r, path)
			}
		}
	}
}

// structInsideMapValue reports the first path from t to a named struct that is
// only reachable through a map value, or "" if there is none.
func structInsideMapValue(t reflect.Type, seen map[reflect.Type]bool) string {
	if t == nil || seen[t] {
		return ""
	}
	seen[t] = true

	switch t.Kind() {
	case reflect.Map:
		if named := namedStructIn(t.Elem(), map[reflect.Type]bool{}); named != "" {
			return t.String() + " → " + named
		}
		// A map of primitives is fine, but its value could itself be a map or a
		// slice that eventually hides one.
		return structInsideMapValue(t.Elem(), seen)
	case reflect.Ptr, reflect.Slice, reflect.Array:
		return structInsideMapValue(t.Elem(), seen)
	case reflect.Struct:
		for i := range t.NumField() {
			if path := structInsideMapValue(t.Field(i).Type, seen); path != "" {
				return t.Name() + "." + t.Field(i).Name + ": " + path
			}
		}
	}
	return ""
}

// namedStructIn reports the name of the first named struct reachable from t
// without passing through another map, or "" if there is none.
//
// time.Time is excluded: Wails serialises it as a string rather than emitting a
// class, so it is not a missing declaration.
func namedStructIn(t reflect.Type, seen map[reflect.Type]bool) string {
	if t == nil || seen[t] {
		return ""
	}
	seen[t] = true

	switch t.Kind() {
	case reflect.Ptr, reflect.Slice, reflect.Array:
		return namedStructIn(t.Elem(), seen)
	case reflect.Struct:
		if t.Name() == "" || strings.HasPrefix(t.PkgPath(), "time") {
			return ""
		}
		return t.String()
	}
	return ""
}

// The bound surface is large and this guard is only worth anything if it is
// actually walking it. A reflection test that silently found zero methods
// would pass forever.
func TestBoundMethodSurfaceIsNonTrivial(t *testing.T) {
	if n := reflect.TypeOf(&App{}).NumMethod(); n < 50 {
		t.Errorf("expected the bound App surface to be large; got %d methods. "+
			"If methods really were removed, lower this floor deliberately.", n)
	}
}
