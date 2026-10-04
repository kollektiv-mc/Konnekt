package services

import (
	"bytes"
	"encoding/binary"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
	"time"
	"unicode/utf16"
)

type fontNameRecord struct {
	platform, encoding, language, nameID uint16
	text                                 string
}

func encodeFontName(record fontNameRecord) []byte {
	if record.platform == 1 {
		return []byte(record.text)
	}
	var out []byte
	for _, unit := range utf16.Encode([]rune(record.text)) {
		out = binary.BigEndian.AppendUint16(out, unit)
	}
	return out
}

// buildFont writes a minimal sfnt: an offset table with one table record, and
// a name table holding the given records. base is where the font starts in the
// file, because table offsets are absolute and a collection places fonts after
// its own header.
func buildFont(t *testing.T, base int, records []fontNameRecord) []byte {
	t.Helper()
	const headerSize = 12 + 16
	put := func(buf *bytes.Buffer, value any) {
		t.Helper()
		if err := binary.Write(buf, binary.BigEndian, value); err != nil {
			t.Fatal(err)
		}
	}
	var storage []byte
	var name bytes.Buffer
	put(&name, uint16(0))
	put(&name, uint16(len(records)))
	put(&name, uint16(6+12*len(records)))
	for _, record := range records {
		text := encodeFontName(record)
		for _, field := range []uint16{
			record.platform, record.encoding, record.language, record.nameID,
			uint16(len(text)), uint16(len(storage)),
		} {
			put(&name, field)
		}
		storage = append(storage, text...)
	}
	name.Write(storage)

	var font bytes.Buffer
	put(&font, uint32(0x00010000))
	put(&font, uint16(1))
	font.Write(make([]byte, 6))
	font.WriteString("name")
	put(&font, uint32(0))
	put(&font, uint32(base+headerSize))
	put(&font, uint32(name.Len()))
	font.Write(name.Bytes())
	return font.Bytes()
}

func windowsFontName(nameID uint16, text string) fontNameRecord {
	return fontNameRecord{platform: 3, encoding: 1, language: 0x409, nameID: nameID, text: text}
}

func TestFontFamilyNamePrefersTypographicFamily(t *testing.T) {
	font := buildFont(t, 0, []fontNameRecord{
		windowsFontName(1, "Inter Bold"),
		windowsFontName(16, "Inter"),
	})
	got, err := fontFamilyNames(bytes.NewReader(font))
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, []string{"Inter"}) {
		t.Fatalf("got %q, want [Inter]", got)
	}
}

func TestFontFamilyNameEncodings(t *testing.T) {
	cases := []struct {
		name    string
		records []fontNameRecord
		want    []string
	}{
		{
			"US English beats another Windows language",
			[]fontNameRecord{
				{platform: 3, encoding: 1, language: 0x407, nameID: 1, text: "Schrift"},
				windowsFontName(1, "Type"),
			},
			[]string{"Type"},
		},
		{
			"Mac Roman when nothing else is present",
			[]fontNameRecord{{platform: 1, encoding: 0, nameID: 1, text: "Geneva"}},
			[]string{"Geneva"},
		},
		{
			"Unicode platform",
			[]fontNameRecord{{platform: 0, encoding: 3, nameID: 1, text: "Noto Sans"}},
			[]string{"Noto Sans"},
		},
		{
			"non-Latin family",
			[]fontNameRecord{windowsFontName(1, "源ノ角ゴシック")},
			[]string{"源ノ角ゴシック"},
		},
		{
			"macOS hidden UI face is dropped",
			[]fontNameRecord{windowsFontName(1, ".SF NS")},
			nil,
		},
		{
			"no family record",
			[]fontNameRecord{windowsFontName(4, "Full Name Only")},
			nil,
		},
		{
			"unsupported encoding only",
			[]fontNameRecord{{platform: 3, encoding: 0, nameID: 1, text: "Symbol"}},
			nil,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := fontFamilyNames(bytes.NewReader(buildFont(t, 0, c.records)))
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, c.want) {
				t.Fatalf("got %q, want %q", got, c.want)
			}
		})
	}
}

func TestFontCollection(t *testing.T) {
	// A ttcf header naming two fonts, each built at the offset it lands on.
	const header = 12 + 4*2
	first := buildFont(t, header, []fontNameRecord{windowsFontName(1, "Alpha")})
	second := buildFont(t, header+len(first), []fontNameRecord{windowsFontName(1, "Beta")})

	var file bytes.Buffer
	file.WriteString("ttcf")
	for _, field := range []uint32{0x00010000, 2, header, uint32(header + len(first))} {
		if err := binary.Write(&file, binary.BigEndian, field); err != nil {
			t.Fatal(err)
		}
	}
	file.Write(first)
	file.Write(second)

	got, err := fontFamilyNames(bytes.NewReader(file.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, []string{"Alpha", "Beta"}) {
		t.Fatalf("got %q", got)
	}
}

func TestMalformedFontFiles(t *testing.T) {
	valid := buildFont(t, 0, []fontNameRecord{windowsFontName(1, "Whole")})
	hugeTables := append([]byte(nil), valid...)
	binary.BigEndian.PutUint16(hugeTables[4:], 0xFFFF)
	cases := map[string][]byte{
		"empty":                              {},
		"truncated":                          valid[:20],
		"no name table":                      append([]byte{0, 1, 0, 0, 0, 0}, make([]byte, 6)...),
		"huge table count":                   hugeTables,
		"collection claiming too many fonts": append([]byte("ttcf\x00\x01\x00\x00"), 0xFF, 0xFF, 0xFF, 0xFF),
	}
	for name, data := range cases {
		t.Run(name, func(t *testing.T) {
			got, _ := fontFamilyNames(bytes.NewReader(data))
			if len(got) != 0 {
				t.Fatalf("got %q from a malformed file", got)
			}
		})
	}
}

func writeFontTree(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	nested := filepath.Join(root, "truetype", "nested")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	write := func(path string, data []byte) {
		t.Helper()
		if err := os.WriteFile(path, data, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write(filepath.Join(root, "b.ttf"), buildFont(t, 0, []fontNameRecord{windowsFontName(1, "beta")}))
	write(filepath.Join(nested, "a.OTF"), buildFont(t, 0, []fontNameRecord{windowsFontName(1, "Alpha")}))
	write(filepath.Join(nested, "a-bold.otf"), buildFont(t, 0, []fontNameRecord{windowsFontName(16, "Alpha")}))
	write(filepath.Join(root, "broken.ttf"), []byte("not a font"))
	write(filepath.Join(root, "readme.txt"), buildFont(t, 0, []fontNameRecord{windowsFontName(1, "Ignored")}))
	return root
}

func TestFontFamiliesWalksDedupesAndSorts(t *testing.T) {
	root := writeFontTree(t)
	got := fontFamilies([]string{root, filepath.Join(root, "does-not-exist")})
	want := []string{"Alpha", "beta"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestFontFamiliesEmptyIsNotNil(t *testing.T) {
	// The bound method hands this to the frontend, where nil would be null.
	svc := &FontService{dirs: func() []string { return nil }, now: time.Now}
	if got := svc.ListFamilies(); got == nil || len(got) != 0 {
		t.Fatalf("got %#v, want an empty non-nil slice", got)
	}
}

func TestFontServiceCachesUntilTheTTLPasses(t *testing.T) {
	root := writeFontTree(t)
	var walks atomic.Int32
	clock := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	svc := &FontService{
		dirs: func() []string {
			walks.Add(1)
			return []string{root}
		},
		now: func() time.Time { return clock },
	}

	first := svc.ListFamilies()
	// Mutating what a caller was handed must not poison the cache.
	first[0] = "tampered"
	if got := svc.ListFamilies(); !reflect.DeepEqual(got, []string{"Alpha", "beta"}) {
		t.Fatalf("second call: got %q", got)
	}
	if walks.Load() != 1 {
		t.Fatalf("walked %d times inside the TTL, want 1", walks.Load())
	}

	clock = clock.Add(fontCacheTTL + time.Second)
	svc.ListFamilies()
	if walks.Load() != 2 {
		t.Fatalf("walked %d times after the TTL, want 2", walks.Load())
	}
}

func TestFontDirsWindows(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows font folders")
	}
	t.Setenv("WINDIR", `C:\Win`)
	t.Setenv("LOCALAPPDATA", `C:\Local`)
	want := []string{`C:\Win\Fonts`, `C:\Local\Microsoft\Windows\Fonts`}
	if got := fontDirs(); !reflect.DeepEqual(got, want) {
		t.Fatalf("fontDirs() = %q, want %q", got, want)
	}

	// An unset variable must drop its folder, not become a relative "Fonts".
	t.Setenv("WINDIR", "")
	t.Setenv("LOCALAPPDATA", "")
	if got := fontDirs(); len(got) != 0 {
		t.Fatalf("fontDirs() = %q with no environment, want none", got)
	}
}

func TestFontDirsLinuxHonoursXDG(t *testing.T) {
	if runtime.GOOS == "windows" || runtime.GOOS == "darwin" {
		t.Skip("XDG directories apply on Linux")
	}
	t.Setenv("XDG_DATA_HOME", "/data-home")
	t.Setenv("XDG_DATA_DIRS", "/one:/two")
	got := fontDirs()
	for _, want := range []string{"/data-home/fonts", "/one/fonts", "/two/fonts"} {
		if !slices.Contains(got, want) {
			t.Errorf("fontDirs() = %q, missing %q", got, want)
		}
	}
}

// Real fonts from this machine, when it has any: the synthetic files above
// prove the parser against its own writer, and this proves it against fonts
// someone else wrote. Each platform probes a face it is known to ship.
func TestSystemFontsParse(t *testing.T) {
	probes := map[string]string{
		"/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf": "DejaVu Sans",
		"/usr/share/fonts/dejavu/DejaVuSans.ttf":          "DejaVu Sans",
	}
	if windir := os.Getenv("WINDIR"); windir != "" {
		probes[filepath.Join(windir, "Fonts", "arial.ttf")] = "Arial"
		probes[filepath.Join(windir, "Fonts", "segoeui.ttf")] = "Segoe UI"
	}
	checked := 0
	for path, want := range probes {
		if _, err := os.Stat(path); err != nil {
			continue
		}
		got := fontFamiliesInFile(path)
		if !reflect.DeepEqual(got, []string{want}) {
			t.Errorf("%s: got %q, want [%s]", path, got, want)
		}
		checked++
	}
	if checked == 0 {
		t.Skip("none of the probe fonts is installed")
	}

	families := fontFamilies(fontDirs())
	t.Logf("%d families installed, first few: %q", len(families), families[:min(len(families), 5)])
	for _, family := range families {
		if family == "" || family[0] == '.' || family != strings.TrimSpace(family) {
			t.Errorf("unusable family name %q", family)
		}
	}
}
