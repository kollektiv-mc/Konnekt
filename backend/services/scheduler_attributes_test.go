package services

import (
	"path/filepath"
	"strings"
	"testing"
)

// propsDeps builds the deps readBuiltinAttribute needs for the server.*
// attributes: a config service that knows testServerID, and a working
// directory holding the given server.properties text ("" writes no file).
func propsDeps(t *testing.T, props string) serviceDeps {
	t.Helper()
	svc, workDir := newBackupFixture(t)
	if props != "" {
		writeFile(t, filepath.Join(workDir, "server.properties"), props)
	}
	return serviceDeps{server: svc.server, config: svc.config}
}

// Every server.* attribute is read as the type builtinAttrs declares for it.
func TestReadBuiltinAttributeServerTypes(t *testing.T) {
	cases := []struct {
		name    string
		attr    string
		props   string
		want    interface{}
		wantErr string
	}{
		{name: "port is a number", attr: "server.port", props: "server-port=25565", want: float64(25565)},
		{name: "port tolerates padding", attr: "server.port", props: "server-port= 25570 ", want: float64(25570)},
		{name: "absent port is the game default", attr: "server.port", props: "motd=hi", want: float64(25565)},
		{name: "no file gives the default port", attr: "server.port", props: "", want: float64(25565)},
		{name: "unparsable port fails", attr: "server.port", props: "server-port=abc", wantErr: "server-port"},
		{name: "whitelist true is true", attr: "server.whitelist", props: "white-list=true", want: true},
		{name: "whitelist false is false", attr: "server.whitelist", props: "white-list=false", want: false},
		{name: "whitelist ignores case", attr: "server.whitelist", props: "white-list=TRUE", want: true},
		{name: "absent whitelist is the game default", attr: "server.whitelist", props: "motd=hi", want: false},
		{name: "unparsable whitelist fails", attr: "server.whitelist", props: "white-list=maybe", wantErr: "white-list"},
		{name: "gamemode stays text", attr: "server.gamemode", props: "gamemode=survival", want: "survival"},
		{name: "motd stays text", attr: "server.motd", props: "motd=Hello there", want: "Hello there"},
		{name: "world stays text", attr: "server.world", props: "level-name=world2", want: "world2"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := readBuiltinAttribute(propsDeps(t, c.props), testServerID, c.attr)
			if c.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), c.wantErr) {
					t.Fatalf("err = %v, want it to contain %q", err, c.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != c.want {
				t.Errorf("got %#v, want %#v", got, c.want)
			}
		})
	}
}

// Read Attribute with an explicit Data type used to produce nothing for the
// server.* attributes, because the value came back as text and failed the
// declared type. Each declared type must now yield an output.
func TestExecServerAttributeHonoursDeclaredType(t *testing.T) {
	props := "server-port=25565\nwhite-list=true\ngamemode=creative\nmotd=Hi\nlevel-name=world\n"
	for attr, meta := range builtinAttrs {
		if !strings.HasPrefix(attr, "server.") || attr == "server.status" {
			continue
		}
		t.Run(attr, func(t *testing.T) {
			ec := &ExecContext{
				ServerID: testServerID,
				Config:   map[string]interface{}{"attribute": attr, "type": meta.Type},
				Attrs:    newAttrScope(propsDeps(t, props), testServerID, nil),
				dataOut:  map[string]interface{}{},
			}
			res := execServerAttribute(ec)
			if res.Port != "onComplete" {
				t.Fatalf("port = %q (err %v), want onComplete", res.Port, res.Err)
			}
			if _, set := ec.dataOut["value"]; !set {
				t.Errorf("no value output for %s declared %s", attr, meta.Type)
			}
		})
	}
}

// The issue's case: Number on server.port outputs the port as a number.
func TestExecServerAttributePortOutputsNumber(t *testing.T) {
	ec := &ExecContext{
		ServerID: testServerID,
		Config:   map[string]interface{}{"attribute": "server.port", "type": "number"},
		Attrs:    newAttrScope(propsDeps(t, "server-port=25565"), testServerID, nil),
		dataOut:  map[string]interface{}{},
	}
	if res := execServerAttribute(ec); res.Port != "onComplete" {
		t.Fatalf("port = %q (err %v), want onComplete", res.Port, res.Err)
	}
	if got := ec.dataOut["value"]; got != float64(25565) {
		t.Errorf("value = %#v, want 25565", got)
	}
}

func TestServerGamemodeIsDeclaredString(t *testing.T) {
	if got := builtinAttrs["server.gamemode"].Type; got != "string" {
		t.Errorf("server.gamemode declared %q, want string", got)
	}
}

// A command that interpolates @server.whitelist reads true or false, as it did
// when the attribute came back as the property's text.
func TestServerWhitelistInterpolatesAsTrueOrFalse(t *testing.T) {
	got, err := readBuiltinAttribute(propsDeps(t, "white-list=true"), testServerID, "server.whitelist")
	if err != nil {
		t.Fatal(err)
	}
	if s := toStr(got); s != "true" {
		t.Errorf("toStr(server.whitelist) = %q, want true", s)
	}
}
