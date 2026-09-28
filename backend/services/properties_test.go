package services

import (
	"errors"
	"os"
	"path/filepath"
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
