package services

import (
	"encoding/binary"
	"errors"
	"io"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf16"
)

// Listing the installed font families is how Settings > Appearance suggests a
// face for each --font-* token (#444). The webview cannot answer it itself:
// the Local Font Access API exists only in Chromium, and the Linux and macOS
// webviews are WebKit. So Go walks the platform's font directories and reads
// each file's `name` table instead.
//
// No font library. A family name is a handful of fixed-offset reads, and a
// dependency for that would outweigh the code it replaced (see
// agent_docs/DEPENDENCIES.md). The parser is a port of Kommands' shell/fonts
// (kollektiv-mc/Kommands#101), kept in step by hand rather than shared, because
// each product vendors what it needs and builds from a standalone clone.

// Bounds on what a font file can make this package read. A font directory is
// written by other software, so a malformed or hostile file must cost a skip,
// never an allocation it chose.
const (
	fontMaxFiles      = 20000
	fontMaxTables     = 512
	fontMaxNameCount  = 4096
	fontMaxFontsInTTC = 256
	fontMaxNameBytes  = 512

	// fontCacheTTL is how long one walk's answer is reused. A walk reads the
	// header of every installed font (a few hundred files on Windows, several
	// thousand on a Linux desktop with CJK packs), which is cheap once and a
	// visible hitch if Settings repeats it on every open. It is a TTL rather
	// than for the life of the process so a font installed while Konnekt runs
	// shows up without a restart.
	fontCacheTTL = 5 * time.Minute
)

var errMalformedFont = errors.New("fonts: malformed font file")

// FontService lists the font families installed on this machine.
type FontService struct {
	// dirs and now are fields so the tests can point the walk at a temp
	// directory and move the clock without touching the real font folders.
	dirs func() []string
	now  func() time.Time

	mu       sync.Mutex
	cached   []string
	cachedAt time.Time
	// walked is whether cached holds an answer at all, so an empty result (a
	// machine with no readable fonts) is cached too rather than re-walked.
	walked bool
}

func NewFontService() *FontService {
	return &FontService{dirs: fontDirs, now: time.Now}
}

// ListFamilies returns every installed family, deduplicated and sorted
// case-insensitively. It never returns nil: a nil slice crosses the Wails
// bridge as null, and the frontend would have to guard every use.
//
// The mutex is held across the walk, so two Settings panes opening together
// share one walk instead of racing two.
func (s *FontService) ListFamilies() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.walked || s.now().Sub(s.cachedAt) > fontCacheTTL {
		s.cached = fontFamilies(s.dirs())
		s.cachedAt = s.now()
		s.walked = true
	}
	out := make([]string, len(s.cached))
	copy(out, s.cached)
	return out
}

// fontDirs are the directories the platform installs fonts into, for this user
// and for everyone. A directory that does not exist is left in; the walk skips
// it. An unset environment variable is dropped, because joining "" onto a
// folder name would make a path relative to the working directory.
func fontDirs() []string {
	var dirs []string
	add := func(root string, rest ...string) {
		if root == "" {
			return
		}
		dirs = append(dirs, filepath.Join(append([]string{root}, rest...)...))
	}
	home, err := os.UserHomeDir()
	if err != nil {
		home = ""
	}
	switch runtime.GOOS {
	case "windows":
		add(os.Getenv("WINDIR"), "Fonts")
		add(os.Getenv("LOCALAPPDATA"), "Microsoft", "Windows", "Fonts")
	case "darwin":
		dirs = append(dirs, "/System/Library/Fonts", "/Library/Fonts")
		add(home, "Library", "Fonts")
	default:
		dataHome := os.Getenv("XDG_DATA_HOME")
		if dataHome == "" {
			if home != "" {
				dataHome = filepath.Join(home, ".local", "share")
			}
		}
		add(dataHome, "fonts")
		add(home, ".fonts")
		dataDirs := os.Getenv("XDG_DATA_DIRS")
		if dataDirs == "" {
			dataDirs = "/usr/local/share:/usr/share"
		}
		for _, dir := range filepath.SplitList(dataDirs) {
			add(dir, "fonts")
		}
	}
	return dirs
}

// fontFamilies walks dirs and returns every family name found, deduplicated
// and sorted case-insensitively. Files that cannot be read or parsed are
// skipped: one broken font must not empty the list.
func fontFamilies(dirs []string) []string {
	seen := map[string]bool{}
	files := 0
	for _, dir := range dirs {
		err := filepath.WalkDir(dir, func(path string, entry fs.DirEntry, err error) error {
			if err != nil {
				// A missing or unreadable directory is the normal case for
				// most entries in fontDirs; skip it rather than stop the walk.
				return nil
			}
			if entry.IsDir() || !isFontFile(path) {
				return nil
			}
			files++
			if files > fontMaxFiles {
				return filepath.SkipAll
			}
			for _, name := range fontFamiliesInFile(path) {
				seen[name] = true
			}
			return nil
		})
		if err != nil {
			// The callback only ever returns nil or SkipAll, so this is
			// unreachable today; logged rather than dropped so a future
			// return of a real error is not silent.
			slog.Warn("fonts: walk", "dir", dir, "error", err)
		}
	}
	names := make([]string, 0, len(seen))
	for name := range seen {
		names = append(names, name)
	}
	sort.Slice(names, func(i, j int) bool {
		a, b := strings.ToLower(names[i]), strings.ToLower(names[j])
		if a == b {
			return names[i] < names[j]
		}
		return a < b
	})
	return names
}

func isFontFile(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".ttf", ".otf", ".ttc", ".otc":
		return true
	}
	return false
}

func fontFamiliesInFile(path string) []string {
	file, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer func() {
		if err := file.Close(); err != nil {
			slog.Debug("fonts: close", "path", path, "error", err)
		}
	}()
	names, err := fontFamilyNames(file)
	if err != nil {
		return nil
	}
	return names
}

// fontFamilyNames reads the family name of each font in an sfnt file or a
// TrueType/OpenType collection. A name starting with "." is dropped: macOS
// uses that prefix for system UI faces that are not meant to be chosen.
func fontFamilyNames(r io.ReaderAt) ([]string, error) {
	tag, err := readFontU32(r, 0)
	if err != nil {
		return nil, err
	}
	offsets := []int64{0}
	if tag == 0x74746366 { // "ttcf"
		count, err := readFontU32(r, 8)
		if err != nil {
			return nil, err
		}
		if count == 0 || count > fontMaxFontsInTTC {
			return nil, errMalformedFont
		}
		offsets = offsets[:0]
		for i := int64(0); i < int64(count); i++ {
			offset, err := readFontU32(r, 12+4*i)
			if err != nil {
				return nil, err
			}
			offsets = append(offsets, int64(offset))
		}
	}
	var names []string
	for _, offset := range offsets {
		name, err := fontFamilyName(r, offset)
		if err != nil || name == "" || strings.HasPrefix(name, ".") {
			continue
		}
		names = append(names, name)
	}
	return names, nil
}

// fontFamilyName reads one font's family from its name table: the typographic
// family (name ID 16) when present, else the legacy family (ID 1). ID 16 is
// what groups "Inter Bold" and "Inter Light" under "Inter", which is the name
// CSS font-family matches.
func fontFamilyName(r io.ReaderAt, fontOffset int64) (string, error) {
	numTables, err := readFontU16(r, fontOffset+4)
	if err != nil {
		return "", err
	}
	if numTables > fontMaxTables {
		return "", errMalformedFont
	}
	var nameOffset int64 = -1
	for i := int64(0); i < int64(numTables); i++ {
		record := fontOffset + 12 + 16*i
		tag, err := readFontU32(r, record)
		if err != nil {
			return "", err
		}
		if tag == 0x6e616d65 { // "name"
			offset, err := readFontU32(r, record+8)
			if err != nil {
				return "", err
			}
			nameOffset = int64(offset)
			break
		}
	}
	if nameOffset < 0 {
		return "", errMalformedFont
	}

	count, err := readFontU16(r, nameOffset+2)
	if err != nil {
		return "", err
	}
	storage, err := readFontU16(r, nameOffset+4)
	if err != nil {
		return "", err
	}
	if count > fontMaxNameCount {
		return "", errMalformedFont
	}

	best, bestRank := "", 0
	for i := int64(0); i < int64(count); i++ {
		var record [12]byte
		if _, err := r.ReadAt(record[:], nameOffset+6+12*i); err != nil {
			return "", err
		}
		platform := binary.BigEndian.Uint16(record[0:])
		encoding := binary.BigEndian.Uint16(record[2:])
		language := binary.BigEndian.Uint16(record[4:])
		nameID := binary.BigEndian.Uint16(record[6:])
		length := binary.BigEndian.Uint16(record[8:])
		offset := binary.BigEndian.Uint16(record[10:])
		if nameID != 1 && nameID != 16 {
			continue
		}
		rank := fontRecordRank(platform, encoding, language)
		if rank == 0 {
			continue
		}
		if nameID == 16 {
			rank += 10
		}
		if rank <= bestRank || length == 0 || length > fontMaxNameBytes {
			continue
		}
		raw := make([]byte, length)
		if _, err := r.ReadAt(raw, nameOffset+int64(storage)+int64(offset)); err != nil {
			continue
		}
		text := decodeFontName(platform, raw)
		if text == "" {
			continue
		}
		best, bestRank = text, rank
	}
	return strings.TrimSpace(best), nil
}

// fontRecordRank orders the encodings a name can be stored in, highest first.
// Zero means an encoding this package does not decode.
func fontRecordRank(platform, encoding, language uint16) int {
	switch {
	case platform == 3 && (encoding == 1 || encoding == 10) && language == 0x409:
		return 4 // Windows, Unicode, US English
	case platform == 3 && (encoding == 1 || encoding == 10):
		return 3
	case platform == 0:
		return 2 // Unicode platform
	case platform == 1 && encoding == 0:
		return 1 // Mac Roman
	}
	return 0
}

func decodeFontName(platform uint16, raw []byte) string {
	if platform == 1 {
		// Mac Roman agrees with ASCII below 0x80, which covers family names in
		// practice; anything above that is dropped rather than mis-decoded.
		var b strings.Builder
		for _, c := range raw {
			if c < 0x80 {
				b.WriteByte(c)
			}
		}
		return b.String()
	}
	if len(raw)%2 != 0 {
		return ""
	}
	units := make([]uint16, len(raw)/2)
	for i := range units {
		units[i] = binary.BigEndian.Uint16(raw[2*i:])
	}
	return string(utf16.Decode(units))
}

func readFontU16(r io.ReaderAt, offset int64) (uint16, error) {
	var b [2]byte
	if _, err := r.ReadAt(b[:], offset); err != nil {
		return 0, err
	}
	return binary.BigEndian.Uint16(b[:]), nil
}

func readFontU32(r io.ReaderAt, offset int64) (uint32, error) {
	var b [4]byte
	if _, err := r.ReadAt(b[:], offset); err != nil {
		return 0, err
	}
	return binary.BigEndian.Uint32(b[:]), nil
}
