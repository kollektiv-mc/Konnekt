package main

import (
	"go/ast"
	"go/token"
	"sort"
	"testing"

	"konnekt/backend/services"
)

// The remote allowlist, held mechanically (agent_docs/SECURITY_CHECKLIST.md
// § S8.1). Same shape as scoping_test.go: read app.go, and fail on the commit
// that binds a method nobody has classified for remote use, rather than on
// the day a phone finds it.

// hostExecutionFloor is § S8.2's minimum: bound methods that amount to running
// code on the host, none of which may be remote-callable without desktop
// approval. Admin is the tier that waits for approval; never is stricter.
var hostExecutionFloor = []string{
	"SaveServerConfig", "InstallServer", "UpdateLoader", "WriteConfigFile", "SaveAppSettings",
	"DownloadAndInstallUpdate", "ImportScheduleGraphJSON", "SaveScheduleGraph",
	"BrowseJarFile", "BrowseDirectory", "OpenDataDir", "OpenBackupDir", "OpenWorldFolder",
}

func boundMethodNames(t *testing.T) []string {
	t.Helper()
	fset := token.NewFileSet()
	root := parseGoFile(t, fset, "app.go")
	var names []string
	for _, decl := range root.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Recv == nil || !fn.Name.IsExported() || !isAppReceiver(fn) {
			continue
		}
		names = append(names, fn.Name.Name)
	}
	sort.Strings(names)
	return names
}

// remoteClassificationProblems reports every way allow and never disagree
// with the bound methods: a method in neither, a method in both, or an entry
// app.go no longer binds.
func remoteClassificationProblems(bound []string, allow map[string]services.RemoteMethod, never map[string]string) []string {
	var problems []string
	seen := map[string]bool{}
	for _, name := range bound {
		seen[name] = true
		_, allowed := allow[name]
		_, refused := never[name]
		switch {
		case allowed && refused:
			problems = append(problems, name+": listed in both remoteMethods and neverRemote")
		case !allowed && !refused:
			problems = append(problems, name+": bound but not classified for remote access")
		}
	}
	for name := range allow {
		if !seen[name] {
			problems = append(problems, name+": in remoteMethods but app.go no longer binds it")
		}
	}
	for name := range never {
		if !seen[name] {
			problems = append(problems, name+": in neverRemote but app.go no longer binds it")
		}
	}
	sort.Strings(problems)
	return problems
}

func TestEveryBoundMethodIsClassifiedForRemoteAccess(t *testing.T) {
	bound := boundMethodNames(t)
	if len(bound) < 50 {
		t.Fatalf("only %d bound methods found on App; the walk is not seeing app.go", len(bound))
	}
	for _, p := range remoteClassificationProblems(bound, remoteMethods, neverRemote) {
		t.Errorf("%s.\nEvery bound method is in remoteMethods with a tier and a reason, or in neverRemote "+
			"with the reason (§ S8.1). Decide which, in remote_methods.go.", p)
	}
	for name, entry := range remoteMethods {
		if entry.Reason == "" {
			t.Errorf("%s: remoteMethods entry has no reason", name)
		}
	}
}

// The test above has to fail on an unclassified method, or it holds nothing.
func TestRemoteClassificationNoticesAnUnclassifiedMethod(t *testing.T) {
	bound := boundMethodNames(t)
	allow := map[string]services.RemoteMethod{}
	for k, v := range remoteMethods {
		allow[k] = v
	}
	delete(allow, "GetServerStatus")
	problems := remoteClassificationProblems(bound, allow, neverRemote)
	if len(problems) != 1 || problems[0] != "GetServerStatus: bound but not classified for remote access" {
		t.Fatalf("dropping GetServerStatus from the allowlist reported %v, want exactly one problem naming it", problems)
	}

	allow["GetServerStatus"] = remoteMethods["GetServerStatus"]
	allow["NoSuchMethod"] = services.RemoteMethod{Tier: services.RemoteTierRead, Reason: "typo"}
	problems = remoteClassificationProblems(bound, allow, neverRemote)
	if len(problems) != 1 || problems[0] != "NoSuchMethod: in remoteMethods but app.go no longer binds it" {
		t.Fatalf("a stale allowlist entry reported %v, want exactly one problem naming it", problems)
	}
}

func TestHostExecutionIsNeverRemoteCallableWithoutApproval(t *testing.T) {
	for _, name := range hostExecutionFloor {
		if _, never := neverRemote[name]; never {
			continue
		}
		entry, ok := remoteMethods[name]
		if !ok {
			t.Errorf("%s: § S8.2 names it and it is classified nowhere", name)
			continue
		}
		if entry.Tier != services.RemoteTierAdmin {
			t.Errorf("%s is tier %q; § S8.2 says it runs code on the host, so it is admin or never", name, entry.Tier)
		}
	}
	// § S8.11: a phone must not be able to change what the desktop shows.
	if _, ok := remoteMethods["SetActiveServerID"]; ok {
		t.Error("SetActiveServerID is remote-callable; § S8.11 says the remote mirrors the selection and never sets it")
	}
	// The native-host methods open dialogs and folders on the desktop, which
	// no tier can make sense of remotely.
	for _, name := range []string{"BrowseJarFile", "BrowseDirectory", "OpenDataDir", "OpenBackupDir", "OpenWorldFolder", "ModInstallLocal"} {
		if _, ok := remoteMethods[name]; ok {
			t.Errorf("%s opens a native dialog or folder on the desktop and cannot be remote-callable", name)
		}
	}
}

// The list is resolved against the real App, so a name that is bound but
// misspelt here, or a method whose shape the bridge cannot carry, fails at
// construction and therefore here, not on a phone.
func TestRemoteAllowlistResolvesAgainstApp(t *testing.T) {
	app := NewApp()
	if app.remoteService == nil {
		t.Fatal("NewApp built no RemoteService")
	}
	dispatcher, err := services.NewRemoteDispatcher(app, remoteMethods)
	if err != nil {
		t.Fatalf("allowlist does not resolve against App: %v", err)
	}
	for name, entry := range remoteMethods {
		tier, ok := dispatcher.Tier(name)
		if !ok || tier != entry.Tier {
			t.Errorf("%s: dispatcher has tier %q (present %v), allowlist says %q", name, tier, ok, entry.Tier)
		}
	}
	for name := range neverRemote {
		if _, ok := dispatcher.Tier(name); ok {
			t.Errorf("%s: in neverRemote yet the dispatcher can reach it", name)
		}
	}
}
