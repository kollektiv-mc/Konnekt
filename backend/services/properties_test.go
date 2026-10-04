package services

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestWritePropertyRefusesALineBreak(t *testing.T) {
	const original = "gamemode=survival\nmotd=hello\n"
	cases := map[string]struct{ key, value string }{
		"newline in value":         {"motd", "a\nb=c"},
		"carriage return in value": {"motd", "a\rb=c"},
		"crlf in value":            {"motd", "a\r\nb=c"},
		"newline in key":           {"motd\nb", "c"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "server.properties")
			if err := os.WriteFile(path, []byte(original), 0644); err != nil {
				t.Fatal(err)
			}
			if err := writeProperty(path, tc.key, tc.value); !errors.Is(err, errMultilineProperty) {
				t.Fatalf("err = %v, want errMultilineProperty", err)
			}
			got, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if string(got) != original {
				t.Errorf("file changed on a refused write:\n%s", got)
			}
		})
	}
}

func TestWritePropertyReplacesASingleLineValue(t *testing.T) {
	path := filepath.Join(t.TempDir(), "server.properties")
	if err := os.WriteFile(path, []byte("# comment\nmotd=old\nmax-players=20\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := writeProperty(path, "motd", "new value"); err != nil {
		t.Fatal(err)
	}
	props, err := readProperties(path)
	if err != nil {
		t.Fatal(err)
	}
	if props["motd"] != "new value" || props["max-players"] != "20" || len(props) != 2 {
		t.Errorf("props = %v", props)
	}
}

// A user's 0600 server.properties holds the RCON password; setting one key
// must not hand it to every local user (#430).
func TestWritePropertyPreservesAnOwnerOnlyMode(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX mode bits are not meaningful on Windows")
	}
	path := filepath.Join(t.TempDir(), "server.properties")
	if err := os.WriteFile(path, []byte("rcon.password=hunter2\nmotd=hello\n"), 0600); err != nil {
		t.Fatal(err)
	}

	if err := writeProperty(path, "motd", "changed"); err != nil {
		t.Fatalf("writeProperty: %v", err)
	}
	if got := modeOf(t, path); got != 0600 {
		t.Errorf("mode = %o, want 0600 preserved", got)
	}
}
