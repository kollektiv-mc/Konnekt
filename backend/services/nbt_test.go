package services

import (
	"bytes"
	"compress/gzip"
	"encoding/binary"
	"math"
	"os"
	"testing"
)

// buildTestLevelDat writes a minimal gzip-compressed NBT compound that mimics
// a real level.dat structure.  It contains the fields readLevelDat reads so we
// can assert they are parsed correctly without needing a real Minecraft world.
func buildTestLevelDat(t *testing.T) string {
	t.Helper()

	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)

	write := func(v any) {
		if err := binary.Write(gz, binary.BigEndian, v); err != nil {
			t.Fatalf("binary.Write: %v", err)
		}
	}
	writeStr := func(s string) {
		write(uint16(len(s)))
		gz.Write([]byte(s))
	}
	startCompound := func(name string) {
		gz.Write([]byte{tagCompound})
		writeStr(name)
	}
	endCompound := func() { gz.Write([]byte{tagEnd}) }
	writeTagByte := func(name string, v int8) {
		gz.Write([]byte{tagByte})
		writeStr(name)
		gz.Write([]byte{byte(v)})
	}
	writeTagInt := func(name string, v int32) {
		gz.Write([]byte{tagInt})
		writeStr(name)
		write(v)
	}
	writeTagLong := func(name string, v int64) {
		gz.Write([]byte{tagLong})
		writeStr(name)
		write(v)
	}
	writeTagString := func(name, v string) {
		gz.Write([]byte{tagString})
		writeStr(name)
		writeStr(v)
	}

	// Root compound (name "")
	startCompound("")

	// Data compound
	startCompound("Data")

	writeTagString("LevelName", "testworld")
	writeTagInt("GameType", 0)   // survival
	writeTagInt("Difficulty", 2) // normal
	writeTagByte("hardcore", 0)
	writeTagLong("LastPlayed", 1_700_000_000_000)
	writeTagLong("RandomSeed", -42)
	writeTagInt("SpawnX", 0)
	writeTagInt("SpawnY", 64)
	writeTagInt("SpawnZ", 0)

	// Version sub-compound
	startCompound("Version")
	writeTagString("Name", "1.20.4")
	endCompound()

	// WorldGenSettings sub-compound with seed
	startCompound("WorldGenSettings")
	writeTagLong("seed", 12345)
	endCompound()

	endCompound() // end Data
	endCompound() // end root

	gz.Close()

	f, err := os.CreateTemp("", "level-*.dat")
	if err != nil {
		t.Fatalf("create temp: %v", err)
	}
	if _, err := f.Write(buf.Bytes()); err != nil {
		t.Fatalf("write temp: %v", err)
	}
	f.Close()
	return f.Name()
}

func TestNBT_readLevelDat(t *testing.T) {
	path := buildTestLevelDat(t)
	defer os.Remove(path)

	meta, err := readLevelDat(path)
	if err != nil {
		t.Fatalf("readLevelDat: %v", err)
	}
	if !meta.Found {
		t.Fatal("expected Found=true")
	}
	if meta.LevelName != "testworld" {
		t.Errorf("LevelName: got %q, want %q", meta.LevelName, "testworld")
	}
	if meta.GameMode != "survival" {
		t.Errorf("GameMode: got %q, want %q", meta.GameMode, "survival")
	}
	if meta.Difficulty != "normal" {
		t.Errorf("Difficulty: got %q, want %q", meta.Difficulty, "normal")
	}
	if meta.Version != "1.20.4" {
		t.Errorf("Version: got %q, want %q", meta.Version, "1.20.4")
	}
	if meta.SpawnY != 64 {
		t.Errorf("SpawnY: got %d, want 64", meta.SpawnY)
	}
	// WorldGenSettings.seed should win over RandomSeed
	if meta.Seed != "12345" {
		t.Errorf("Seed: got %q, want %q", meta.Seed, "12345")
	}
}

func TestNBT_missingFile(t *testing.T) {
	_, err := readLevelDat("/nonexistent/level.dat")
	if err == nil {
		t.Fatal("expected error for missing file")
	}
}

func TestNBT_intGetByteGetRange(t *testing.T) {
	root := func(tag byte, n int64) *nbtValue {
		return &nbtValue{compound: map[string]*nbtValue{"k": {tagType: tag, i64: n}}}
	}

	intCases := []struct {
		name string
		tag  byte
		in   int64
		want int32
	}{
		{"int in range", tagInt, 64, 64},
		{"int negative", tagInt, -64, -64},
		{"int max", tagInt, math.MaxInt32, math.MaxInt32},
		{"int min", tagInt, math.MinInt32, math.MinInt32},
		{"long in range", tagLong, 30_000_000, 30_000_000},
		{"long above int32", tagLong, math.MaxInt32 + 1, 0},
		{"long below int32", tagLong, math.MinInt32 - 1, 0},
		{"long that would truncate to 5", tagLong, 1<<32 + 5, 0},
	}
	for _, tc := range intCases {
		t.Run(tc.name, func(t *testing.T) {
			if got := intGet(root(tc.tag, tc.in), "k"); got != tc.want {
				t.Errorf("intGet(%d) = %d, want %d", tc.in, got, tc.want)
			}
		})
	}
	if got := intGet(root(tagInt, 7), "missing"); got != 0 {
		t.Errorf("intGet on an absent key = %d, want 0", got)
	}

	byteCases := []struct {
		name string
		tag  byte
		in   int64
		want int8
	}{
		{"byte one", tagByte, 1, 1},
		{"byte negative", tagByte, -1, -1},
		{"byte max", tagByte, math.MaxInt8, math.MaxInt8},
		{"byte min", tagByte, math.MinInt8, math.MinInt8},
		{"int above int8", tagInt, math.MaxInt8 + 1, 0},
		{"int below int8", tagInt, math.MinInt8 - 1, 0},
		{"int that would truncate to 1", tagInt, 257, 0},
	}
	for _, tc := range byteCases {
		t.Run(tc.name, func(t *testing.T) {
			if got := byteGet(root(tc.tag, tc.in), "k"); got != tc.want {
				t.Errorf("byteGet(%d) = %d, want %d", tc.in, got, tc.want)
			}
		})
	}
	if got := byteGet(root(tagByte, 1), "missing"); got != 0 {
		t.Errorf("byteGet on an absent key = %d, want 0", got)
	}
}

// A Long SpawnX outside int32 and a hardcore flag of 257 stored as an Int must
// read as absent, not truncate into 5 and true.
func TestNBT_readLevelDatOutOfRange(t *testing.T) {
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	put := func(b ...byte) {
		if _, err := gz.Write(b); err != nil {
			t.Fatalf("gzip write: %v", err)
		}
	}
	name := func(s string) {
		put(byte(len(s)>>8), byte(len(s)))
		put([]byte(s)...)
	}
	put(tagCompound)
	name("")
	put(tagCompound)
	name("Data")
	put(tagLong)
	name("SpawnX")
	if err := binary.Write(gz, binary.BigEndian, int64(1<<32+5)); err != nil {
		t.Fatalf("binary.Write: %v", err)
	}
	put(tagInt)
	name("hardcore")
	if err := binary.Write(gz, binary.BigEndian, int32(257)); err != nil {
		t.Fatalf("binary.Write: %v", err)
	}
	put(tagEnd, tagEnd)
	if err := gz.Close(); err != nil {
		t.Fatalf("gzip close: %v", err)
	}

	meta, err := readLevelDatFromReader(&buf)
	if err != nil {
		t.Fatalf("readLevelDatFromReader: %v", err)
	}
	if meta.SpawnX != 0 {
		t.Errorf("SpawnX: got %d, want 0", meta.SpawnX)
	}
	if meta.Hardcore {
		t.Error("Hardcore: got true, want false")
	}
}
