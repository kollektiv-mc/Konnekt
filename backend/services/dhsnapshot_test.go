package services

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// dhWrite creates a file, and its folders, under root.
func dhWrite(t *testing.T, root, rel string, data []byte) string {
	t.Helper()
	p := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, data, 0644); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestDhTomlAssignment(t *testing.T) {
	tests := []struct {
		line, key, value string
		ok               bool
	}{
		{`serverKey = "frang"`, "serverKey", "frang", true},
		{`serverKey="frang"`, "serverKey", "frang", true},
		{"\t serverKey = \"frang\"  # the folder", "serverKey", "frang", true},
		{`serverKey = 'frang'`, "serverKey", "frang", true},
		{`serverKey = ""`, "serverKey", "", true},
		{`serverKey = "a#b"`, "serverKey", "a#b", true},
		{`serverKey = "a\"b"`, "serverKey", `a"b`, true},
		{`serverKey = "unterminated`, "serverKey", "unterminated", true},
		{`serverKey = bare # note`, "serverKey", "bare", true},
		{`# serverKey = "commented"`, "", "", false},
		{`[server.levelKeys]`, "", "", false},
		{``, "", "", false},
		{`no assignment here`, "", "", false},
		{`= "no key"`, "", "", false},
	}
	for _, tc := range tests {
		key, value, ok := dhTomlAssignment(tc.line)
		if key != tc.key || value != tc.value || ok != tc.ok {
			t.Errorf("%q: got (%q, %q, %v), want (%q, %q, %v)", tc.line, key, value, ok, tc.key, tc.value, tc.ok)
		}
	}
}

func TestReadDHConfig(t *testing.T) {
	root := t.TempDir()

	t.Run("missing file reads as unset", func(t *testing.T) {
		cfg, err := readDHConfig(filepath.Join(root, "absent.toml"))
		if err != nil {
			t.Fatal(err)
		}
		if cfg != (DHConfig{}) {
			t.Errorf("got %+v, want zero", cfg)
		}
	})

	t.Run("nested tables, quotes and comments", func(t *testing.T) {
		p := dhWrite(t, root, "full.toml", []byte(`# Distant Horizons
[server]
	generationRequestRateLimit = 20

	[server.levelKeys]
		# Makes the server send level keys
		sendLevelKeys = true
		serverId = -1234567
		serverKey = "frangfurd" # reused by every client
		levelKeyPrefix = '17625k4jm41ka'
`))
		cfg, err := readDHConfig(p)
		if err != nil {
			t.Fatal(err)
		}
		want := DHConfig{Found: true, ServerKey: "frangfurd", LevelKeyPrefix: "17625k4jm41ka"}
		if cfg != want {
			t.Errorf("got %+v, want %+v", cfg, want)
		}
	})

	t.Run("a commented key and an empty one", func(t *testing.T) {
		p := dhWrite(t, root, "empty.toml", []byte("# serverKey = \"nope\"\nserverKey = \"\"\nlevelKeyPrefix = \"\"\n"))
		cfg, err := readDHConfig(p)
		if err != nil {
			t.Fatal(err)
		}
		if want := (DHConfig{Found: true}); cfg != want {
			t.Errorf("got %+v, want %+v", cfg, want)
		}
	})

	t.Run("the first assignment wins", func(t *testing.T) {
		p := dhWrite(t, root, "dup.toml", []byte("serverKey = \"one\"\nserverKey = \"two\"\n"))
		cfg, err := readDHConfig(p)
		if err != nil {
			t.Fatal(err)
		}
		if cfg.ServerKey != "one" {
			t.Errorf("ServerKey = %q, want one", cfg.ServerKey)
		}
	})

	t.Run("a directory is an error, not a missing file", func(t *testing.T) {
		if _, err := readDHConfig(root); err == nil {
			t.Error("reading a directory succeeded")
		}
	})
}

func TestCheckDHConfig(t *testing.T) {
	ok := DHConfig{Found: true, ServerKey: "frang", LevelKeyPrefix: "abc123"}
	tests := []struct {
		name string
		cfg  DHConfig
		want string // substring of the refusal; empty means accepted
	}{
		{"complete", ok, ""},
		{"no file", DHConfig{}, "was not found"},
		{"empty serverKey", DHConfig{Found: true, LevelKeyPrefix: "abc123"}, "serverKey is empty"},
		{"empty levelKeyPrefix", DHConfig{Found: true, ServerKey: "frang"}, "levelKeyPrefix is empty"},
		{"serverKey with a space", DHConfig{Found: true, ServerKey: "my server", LevelKeyPrefix: "abc"}, "serverKey in"},
		{"serverKey too long", DHConfig{Found: true, ServerKey: strings.Repeat("a", 151), LevelKeyPrefix: "abc"}, "serverKey in"},
		{"levelKeyPrefix with a dot", DHConfig{Found: true, ServerKey: "frang", LevelKeyPrefix: "a.b"}, "levelKeyPrefix in"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := checkDHConfig(tc.cfg)
			switch {
			case tc.want == "" && err != nil:
				t.Errorf("unexpected refusal: %v", err)
			case tc.want != "" && (err == nil || !strings.Contains(err.Error(), tc.want)):
				t.Errorf("err = %v, want it to contain %q", err, tc.want)
			}
		})
	}
}

func TestDHServerFolder(t *testing.T) {
	tests := []struct {
		id, key, want string
		wantErr       bool
	}{
		{"123456", "frang", "123456_frang", false},
		{"-987", "frang-1_x", "-987_frang-1_x", false},
		{"abc", "frang", "", true},
		{"", "frang", "", true},
		{"12", "bad key", "", true},
		{"12", strings.Repeat("k", 150), "", true}, // "12_" pushes it past 150
	}
	for _, tc := range tests {
		got, err := dhServerFolder(tc.id, tc.key)
		if (err != nil) != tc.wantErr || got != tc.want {
			t.Errorf("dhServerFolder(%q, %q) = (%q, %v), want (%q, err=%v)", tc.id, tc.key, got, err, tc.want, tc.wantErr)
		}
	}
}

func TestDiscoverDHLevelsFourShapes(t *testing.T) {
	world := t.TempDir()
	dhWrite(t, world, "data/DistantHorizons.sqlite", []byte("overworld"))
	dhWrite(t, world, "DIM-1/data/DistantHorizons.sqlite", []byte("nether"))
	dhWrite(t, world, "DIM1/data/DistantHorizons.sqlite", []byte("end"))
	dhWrite(t, world, "dimensions/northstar/earth_orbit/data/DistantHorizons.sqlite", []byte("orbit"))
	dhWrite(t, world, "dimensions/northstar/moon/data/DistantHorizons.sqlite", []byte("moon"))
	// Not databases: a dimension with other data only, a stray file, and the
	// -wal that sits beside a live one.
	dhWrite(t, world, "dimensions/northstar/mars/data/idcounts.dat", []byte("x"))
	dhWrite(t, world, "dimensions/readme.txt", []byte("x"))
	dhWrite(t, world, "data/DistantHorizons.sqlite-wal", []byte("x"))

	levels, err := discoverDHLevels(world, "pfx")
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, l := range levels {
		got[l.Dimension] = l.Folder
		if !strings.HasSuffix(l.Path, "DistantHorizons.sqlite") {
			t.Errorf("%s: path %s", l.Dimension, l.Path)
		}
	}
	want := map[string]string{
		"minecraft:overworld":   "pfx@minecraft@@overworld",
		"minecraft:the_nether":  "pfx@minecraft@@the_nether",
		"minecraft:the_end":     "pfx@minecraft@@the_end",
		"northstar:earth_orbit": "pfx@northstar@@earth_orbit",
		"northstar:moon":        "pfx@northstar@@moon",
	}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for dim, folder := range want {
		if got[dim] != folder {
			t.Errorf("%s: folder %q, want %q", dim, got[dim], folder)
		}
	}
	for i := 1; i < len(levels); i++ {
		if levels[i-1].Dimension > levels[i].Dimension {
			t.Errorf("not sorted: %s before %s", levels[i-1].Dimension, levels[i].Dimension)
		}
	}
}

func TestDiscoverDHLevelsEdges(t *testing.T) {
	t.Run("a world with no databases", func(t *testing.T) {
		levels, err := discoverDHLevels(t.TempDir(), "pfx")
		if err != nil || len(levels) != 0 {
			t.Errorf("got (%v, %v), want none", levels, err)
		}
	})
	t.Run("a directory named like the database is skipped", func(t *testing.T) {
		world := t.TempDir()
		if err := os.MkdirAll(filepath.Join(world, "data", "DistantHorizons.sqlite"), 0755); err != nil {
			t.Fatal(err)
		}
		levels, err := discoverDHLevels(world, "pfx")
		if err != nil || len(levels) != 0 {
			t.Errorf("got (%v, %v), want none", levels, err)
		}
	})
	t.Run("a dimension DH cannot key is named", func(t *testing.T) {
		world := t.TempDir()
		dhWrite(t, world, "dimensions/my.pack/deep/data/DistantHorizons.sqlite", []byte("x"))
		_, err := discoverDHLevels(world, "pfx")
		if err == nil || !strings.Contains(err.Error(), "my.pack:deep") {
			t.Errorf("err = %v, want it to name my.pack:deep", err)
		}
	})
}

// dhServer lays out a server folder with a DH config, a DH jar and a world.
func dhServer(t *testing.T, config string, jar map[string]string, jarName string) (workingDir, worldDir string) {
	t.Helper()
	workingDir = t.TempDir()
	worldDir = filepath.Join(workingDir, "world")
	dhWrite(t, worldDir, "data/DistantHorizons.sqlite", []byte("overworld"))
	if config != "" {
		dhWrite(t, workingDir, "config/DistantHorizons.toml", []byte(config))
	}
	if jar != nil {
		if err := os.MkdirAll(filepath.Join(workingDir, "mods"), 0755); err != nil {
			t.Fatal(err)
		}
		writeJar(t, filepath.Join(workingDir, "mods", jarName), jar)
	}
	return workingDir, worldDir
}

const dhTestConfig = "serverKey = \"frang\"\nlevelKeyPrefix = \"pfx\"\n"

var dhFabricJar = map[string]string{
	"fabric.mod.json": `{"id":"distanthorizons","name":"Distant Horizons","version":"3.3.3-b"}`,
}

func TestResolveDHSnapshotSource(t *testing.T) {
	t.Run("a complete server", func(t *testing.T) {
		wd, world := dhServer(t, dhTestConfig, dhFabricJar, "DistantHorizons-3.3.3-b-1.21.1-fabric.jar")
		src, err := resolveDHSnapshotSource(wd, world, "-42")
		if err != nil {
			t.Fatal(err)
		}
		if src.DHVersion != "3.3.3-b" || src.ServerFolder != "-42_frang" {
			t.Errorf("got %+v", src)
		}
		if len(src.Levels) != 1 || src.Levels[0].Folder != "pfx@minecraft@@overworld" {
			t.Errorf("levels = %+v", src.Levels)
		}
	})

	t.Run("refusals name the setting and come before anything else", func(t *testing.T) {
		tests := []struct{ name, config, want string }{
			{"no config file", "", "was not found"},
			{"empty serverKey", "serverKey = \"\"\nlevelKeyPrefix = \"pfx\"\n", "serverKey is empty"},
			{"empty levelKeyPrefix", "serverKey = \"frang\"\nlevelKeyPrefix = \"\"\n", "levelKeyPrefix is empty"},
		}
		for _, tc := range tests {
			t.Run(tc.name, func(t *testing.T) {
				// No jar either: the config refusal has to win.
				wd, world := dhServer(t, tc.config, nil, "")
				_, err := resolveDHSnapshotSource(wd, world, "1")
				if err == nil || !strings.Contains(err.Error(), tc.want) {
					t.Errorf("err = %v, want it to contain %q", err, tc.want)
				}
			})
		}
	})

	t.Run("a bad serverId", func(t *testing.T) {
		wd, world := dhServer(t, dhTestConfig, dhFabricJar, "DistantHorizons-3.3.3-b.jar")
		if _, err := resolveDHSnapshotSource(wd, world, "x"); err == nil {
			t.Error("accepted a serverId that is not an integer")
		}
	})

	t.Run("no DH jar", func(t *testing.T) {
		wd, world := dhServer(t, dhTestConfig, map[string]string{"fabric.mod.json": `{"id":"sodium","version":"1"}`}, "sodium-1.jar")
		_, err := resolveDHSnapshotSource(wd, world, "1")
		if err == nil || !strings.Contains(err.Error(), "no Distant Horizons jar") {
			t.Errorf("err = %v", err)
		}
	})

	t.Run("no databases", func(t *testing.T) {
		wd, world := dhServer(t, dhTestConfig, dhFabricJar, "DistantHorizons-3.3.3-b.jar")
		if err := os.RemoveAll(filepath.Join(world, "data")); err != nil {
			t.Fatal(err)
		}
		_, err := resolveDHSnapshotSource(wd, world, "1")
		if err == nil || !strings.Contains(err.Error(), "DistantHorizons.sqlite") {
			t.Errorf("err = %v", err)
		}
	})
}

func TestDHJarVersion(t *testing.T) {
	t.Run("no mods folder", func(t *testing.T) {
		if _, err := dhJarVersion(t.TempDir()); err == nil {
			t.Error("expected an error")
		}
	})

	t.Run("a mod whose file name mentions DH is not DH", func(t *testing.T) {
		wd := t.TempDir()
		mods := filepath.Join(wd, "mods")
		if err := os.MkdirAll(mods, 0755); err != nil {
			t.Fatal(err)
		}
		writeJar(t, filepath.Join(mods, "distanthorizons-compat-1.0.jar"), map[string]string{
			"fabric.mod.json": `{"id":"dhcompat","version":"1.0"}`,
		})
		writeJar(t, filepath.Join(mods, "DistantHorizons-3.3.3.jar"), map[string]string{
			"fabric.mod.json": `{"id":"distanthorizons","version":"3.3.3"}`,
		})
		got, err := dhJarVersion(wd)
		if err != nil || got != "3.3.3" {
			t.Errorf("got (%q, %v), want 3.3.3", got, err)
		}
	})

	t.Run("a jar with no manifest falls back to its name", func(t *testing.T) {
		wd := t.TempDir()
		mods := filepath.Join(wd, "mods")
		if err := os.MkdirAll(mods, 0755); err != nil {
			t.Fatal(err)
		}
		writeJar(t, filepath.Join(mods, "DistantHorizons-neoforge-3.3.3-b-1.21.1.jar"), map[string]string{"x": "y"})
		got, err := dhJarVersion(wd)
		if err != nil || got != "3.3.3-b-1.21.1" {
			t.Errorf("got (%q, %v)", got, err)
		}
	})

	t.Run("a disabled jar does not count", func(t *testing.T) {
		wd := t.TempDir()
		mods := filepath.Join(wd, "mods")
		if err := os.MkdirAll(mods, 0755); err != nil {
			t.Fatal(err)
		}
		writeJar(t, filepath.Join(mods, "DistantHorizons-3.3.3.jar.disabled"), dhFabricJar)
		if _, err := dhJarVersion(wd); err == nil {
			t.Error("a .disabled jar was read as installed")
		}
	})
}
