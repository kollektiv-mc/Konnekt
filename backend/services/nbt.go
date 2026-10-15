package services

import (
	"compress/gzip"
	"encoding/binary"
	"fmt"
	"io"
	"math"
	"os"
	"strconv"

	"konnekt/backend/models"
)

// NBT tag type constants (Minecraft NBT spec).
const (
	tagEnd       = 0
	tagByte      = 1
	tagShort     = 2
	tagInt       = 3
	tagLong      = 4
	tagFloat     = 5
	tagDouble    = 6
	tagByteArray = 7
	tagString    = 8
	tagList      = 9
	tagCompound  = 10
	tagIntArray  = 11
	tagLongArray = 12
)

// nbtValue is a parsed NBT node. Compounds are map[string]*nbtValue, lists are []*nbtValue.
type nbtValue struct {
	tagType  byte
	str      string
	i64      int64
	f64      float64
	compound map[string]*nbtValue
	list     []*nbtValue
}

// readLevelDat opens a gzip-compressed level.dat and extracts world metadata.
func readLevelDat(path string) (models.WorldMeta, error) {
	f, err := os.Open(path)
	if err != nil {
		return models.WorldMeta{}, err
	}
	defer f.Close()
	return readLevelDatFromReader(f)
}

// readLevelDatFromReader parses a gzip-compressed level.dat from an io.Reader.
// Used when reading level.dat directly out of a zip archive entry.
func readLevelDatFromReader(r io.Reader) (models.WorldMeta, error) {
	gr, err := gzip.NewReader(r)
	if err != nil {
		return models.WorldMeta{}, fmt.Errorf("nbt: gzip: %w", err)
	}
	defer gr.Close()

	root, err := readNamedTag(gr)
	if err != nil {
		return models.WorldMeta{}, fmt.Errorf("nbt: parse: %w", err)
	}

	meta := models.WorldMeta{Found: true}
	data := compoundGet(root, "Data")
	if data == nil {
		return meta, nil
	}

	meta.LevelName = stringGet(data, "LevelName")

	if ver := compoundGet(data, "Version"); ver != nil {
		meta.Version = stringGet(ver, "Name")
	}

	switch intGet(data, "GameType") {
	case 0:
		meta.GameMode = "survival"
	case 1:
		meta.GameMode = "creative"
	case 2:
		meta.GameMode = "adventure"
	case 3:
		meta.GameMode = "spectator"
	}

	switch intGet(data, "Difficulty") {
	case 0:
		meta.Difficulty = "peaceful"
	case 1:
		meta.Difficulty = "easy"
	case 2:
		meta.Difficulty = "normal"
	case 3:
		meta.Difficulty = "hard"
	}

	meta.Hardcore = byteGet(data, "hardcore") != 0
	meta.LastPlayed = longGet(data, "LastPlayed")
	meta.SpawnX = int(intGet(data, "SpawnX"))
	meta.SpawnY = int(intGet(data, "SpawnY"))
	meta.SpawnZ = int(intGet(data, "SpawnZ"))

	// Seed: 1.16+ stores it under WorldGenSettings.seed (long); older versions use RandomSeed.
	if wgs := compoundGet(data, "WorldGenSettings"); wgs != nil {
		if sv, ok := wgs.compound["seed"]; ok {
			meta.Seed = strconv.FormatInt(sv.i64, 10)
		}
	}
	if meta.Seed == "" {
		if rs := longGet(data, "RandomSeed"); rs != 0 {
			meta.Seed = strconv.FormatInt(rs, 10)
		}
	}

	return meta, nil
}

// ─── NBT reader helpers ───────────────────────────────────────────────────────

func readNamedTag(r io.Reader) (*nbtValue, error) {
	tagType, err := readByte(r)
	if err != nil {
		return nil, err
	}
	if tagType == tagEnd {
		return &nbtValue{tagType: tagEnd}, nil
	}
	// Skip the name (we only need the root compound's payload).
	if err := skipString(r); err != nil {
		return nil, err
	}
	return readPayload(r, tagType)
}

func readPayload(r io.Reader, tagType byte) (*nbtValue, error) {
	v := &nbtValue{tagType: tagType}
	switch tagType {
	case tagByte:
		b, err := readByte(r)
		if err != nil {
			return nil, err
		}
		v.i64 = int64(int8(b))
	case tagShort:
		var n int16
		if err := binary.Read(r, binary.BigEndian, &n); err != nil {
			return nil, err
		}
		v.i64 = int64(n)
	case tagInt:
		var n int32
		if err := binary.Read(r, binary.BigEndian, &n); err != nil {
			return nil, err
		}
		v.i64 = int64(n)
	case tagLong:
		var n int64
		if err := binary.Read(r, binary.BigEndian, &n); err != nil {
			return nil, err
		}
		v.i64 = n
	case tagFloat:
		var n float32
		if err := binary.Read(r, binary.BigEndian, &n); err != nil {
			return nil, err
		}
		v.f64 = float64(n)
	case tagDouble:
		if err := binary.Read(r, binary.BigEndian, &v.f64); err != nil {
			return nil, err
		}
	case tagByteArray:
		var length int32
		if err := binary.Read(r, binary.BigEndian, &length); err != nil {
			return nil, err
		}
		if _, err := io.CopyN(io.Discard, r, int64(length)); err != nil {
			return nil, err
		}
	case tagString:
		s, err := readString(r)
		if err != nil {
			return nil, err
		}
		v.str = s
	case tagList:
		elemType, err := readByte(r)
		if err != nil {
			return nil, err
		}
		var length int32
		if err := binary.Read(r, binary.BigEndian, &length); err != nil {
			return nil, err
		}
		v.list = make([]*nbtValue, 0, length)
		for i := int32(0); i < length; i++ {
			elem, err := readPayload(r, elemType)
			if err != nil {
				return nil, err
			}
			v.list = append(v.list, elem)
		}
	case tagCompound:
		v.compound = make(map[string]*nbtValue)
		for {
			childType, err := readByte(r)
			if err != nil {
				return nil, err
			}
			if childType == tagEnd {
				break
			}
			name, err := readString(r)
			if err != nil {
				return nil, err
			}
			child, err := readPayload(r, childType)
			if err != nil {
				return nil, err
			}
			v.compound[name] = child
		}
	case tagIntArray:
		var length int32
		if err := binary.Read(r, binary.BigEndian, &length); err != nil {
			return nil, err
		}
		if _, err := io.CopyN(io.Discard, r, int64(length)*4); err != nil {
			return nil, err
		}
	case tagLongArray:
		var length int32
		if err := binary.Read(r, binary.BigEndian, &length); err != nil {
			return nil, err
		}
		if _, err := io.CopyN(io.Discard, r, int64(length)*8); err != nil {
			return nil, err
		}
	default:
		return nil, fmt.Errorf("nbt: unknown tag type %d", tagType)
	}
	return v, nil
}

func readByte(r io.Reader) (byte, error) {
	var b [1]byte
	_, err := io.ReadFull(r, b[:])
	return b[0], err
}

func readString(r io.Reader) (string, error) {
	var length uint16
	if err := binary.Read(r, binary.BigEndian, &length); err != nil {
		return "", err
	}
	if length == 0 {
		return "", nil
	}
	buf := make([]byte, length)
	if _, err := io.ReadFull(r, buf); err != nil {
		return "", err
	}
	return string(buf), nil
}

func skipString(r io.Reader) error {
	var length uint16
	if err := binary.Read(r, binary.BigEndian, &length); err != nil {
		return err
	}
	_, err := io.CopyN(io.Discard, r, int64(length))
	return err
}

// ─── Compound accessors ───────────────────────────────────────────────────────

func compoundGet(v *nbtValue, key string) *nbtValue {
	if v == nil || v.compound == nil {
		return nil
	}
	return v.compound[key]
}

func stringGet(v *nbtValue, key string) string {
	c := compoundGet(v, key)
	if c == nil {
		return ""
	}
	return c.str
}

// intGet reads an integral tag as an int32. Every integral tag is stored as an
// int64, and a level.dat is not ours, so a value outside int32 reads as absent
// rather than truncating into a wrong number.
func intGet(v *nbtValue, key string) int32 {
	c := compoundGet(v, key)
	if c == nil || c.i64 < math.MinInt32 || c.i64 > math.MaxInt32 {
		return 0
	}
	return int32(c.i64)
}

func longGet(v *nbtValue, key string) int64 {
	c := compoundGet(v, key)
	if c == nil {
		return 0
	}
	return c.i64
}

// byteGet reads an integral tag as an int8, with intGet's out-of-range rule.
func byteGet(v *nbtValue, key string) int8 {
	c := compoundGet(v, key)
	if c == nil || c.i64 < math.MinInt8 || c.i64 > math.MaxInt8 {
		return 0
	}
	return int8(c.i64)
}
