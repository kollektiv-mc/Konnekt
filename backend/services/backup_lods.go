package services

import (
	"fmt"
	"path/filepath"
	"strings"
)

// Distant Horizons keeps one SQLite database per dimension at
// <dimension folder>/data/DistantHorizons.sqlite and runs it in WAL mode, so a
// copy taken while the server runs can hold a main file torn by a checkpoint
// next to a -wal that no longer matches it (#563). The level data is
// regenerable, so a backup of a running server leaves the three files out and
// says so; a stopped server has no writer, and its three files are a consistent
// set that the backup keeps.
//
// Minecraft's save-off and save-all do not reach this database, which is why
// quiesce alone does not make the copy safe.
var lodDatabaseNames = map[string]bool{
	"distanthorizons.sqlite":     true,
	"distanthorizons.sqlite-wal": true,
	"distanthorizons.sqlite-shm": true,
}

// isLodDatabase reports whether path is one of the three Distant Horizons
// database files sitting directly in a folder named data, at any depth, so
// world/data, world/DIM-1/data and world/dimensions/<ns>/<path>/data all match.
// Both names compare case-insensitively: Windows and macOS volumes do, and
// nothing else writes these names. A file of the same name anywhere else is
// somebody's data and is kept.
func isLodDatabase(path string) bool {
	if !lodDatabaseNames[strings.ToLower(filepath.Base(path))] {
		return false
	}
	return strings.EqualFold(filepath.Base(filepath.Dir(path)), "data")
}

// lodTally is what a copy left out of a running server's backup. A nil *lodTally
// means the server was stopped and nothing is left out, so the callers that take
// one have a single shape for both cases.
type lodTally struct {
	files int
	bytes int64
}

func (t *lodTally) add(size int64) {
	t.files++
	t.bytes += size
}

// skipped reports whether anything was actually left out, which is what the
// archive's flag records: a running server with no Distant Horizons databases
// lost nothing, and its backup is not marked.
func (t *lodTally) skipped() bool {
	return t != nil && t.files > 0
}

// narration is the console line for a copy that left databases out, empty when
// nothing matched so a server without Distant Horizons hears nothing.
func (t *lodTally) narration() string {
	if !t.skipped() {
		return ""
	}
	noun := "files"
	if t.files == 1 {
		noun = "file"
	}
	return fmt.Sprintf("Skipped Distant Horizons LODs (%d %s, %s): the server was running", t.files, noun, fmtBytes(t.bytes))
}

// lodsNote is the words the Backups tile card and a restore both use for an
// archive taken without them.
const lodsNote = "LODs not included (server was running)"

// lodsRestoreNarration says what the note means for the world that comes back:
// a restore replaces whole dimension folders, so no database survives it.
const lodsRestoreNarration = lodsNote + ": the restored world has no Distant Horizons database until Distant Horizons makes a new one"
