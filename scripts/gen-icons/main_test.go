package main

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
	"testing"
)

// A 4x4 source: opaque red in the top-left quadrant, transparent elsewhere.
// Small enough to reason about by hand, and it exercises the alpha path that
// the real mark (fully opaque) never would.
func quadrant() *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, 4, 4))
	for y := 0; y < 4; y++ {
		for x := 0; x < 4; x++ {
			c := color.NRGBA{}
			if x < 2 && y < 2 {
				c = color.NRGBA{R: 255, A: 255}
			}
			img.Set(x, y, c)
		}
	}
	return img
}

func TestResizeAveragesCoverage(t *testing.T) {
	got := resize(quadrant(), 2)

	// Each destination pixel covers one 2x2 quadrant, so the top-left is fully
	// opaque red and the other three are fully transparent.
	if c := got.NRGBAAt(0, 0); c != (color.NRGBA{R: 255, A: 255}) {
		t.Errorf("top-left = %+v, want opaque red", c)
	}
	for _, p := range []image.Point{{X: 1, Y: 0}, {X: 0, Y: 1}, {X: 1, Y: 1}} {
		if a := got.NRGBAAt(p.X, p.Y).A; a != 0 {
			t.Errorf("pixel %v alpha = %d, want 0", p, a)
		}
	}
}

func TestResizeDoesNotBleedTransparentColour(t *testing.T) {
	// One pixel down from a source that is a quarter opaque red: the alpha is
	// the coverage (a quarter of 255), and the colour stays pure red rather than
	// being dragged towards the black of the transparent pixels. Averaging
	// straight NRGBA channels instead of premultiplied ones would give R=64.
	got := resize(quadrant(), 1).NRGBAAt(0, 0)
	if got.R != 255 || got.G != 0 || got.B != 0 {
		t.Errorf("colour = %+v, want pure red: transparent pixels bled into it", got)
	}
	if want := uint8(64); got.A != want {
		t.Errorf("alpha = %d, want %d (a quarter coverage, rounded)", got.A, want)
	}
}

func TestResizeSquaresANonZeroOriginImage(t *testing.T) {
	// image.Decode can hand back an image whose bounds do not start at (0,0).
	// Indexing Pix as though they did would read the wrong pixels.
	offset := image.NewNRGBA(image.Rect(10, 20, 12, 22))
	offset.Set(10, 20, color.NRGBA{G: 255, A: 255})
	offset.Set(11, 20, color.NRGBA{G: 255, A: 255})
	offset.Set(10, 21, color.NRGBA{G: 255, A: 255})
	offset.Set(11, 21, color.NRGBA{G: 255, A: 255})

	got := resize(offset, 1)
	if c := got.NRGBAAt(0, 0); c != (color.NRGBA{G: 255, A: 255}) {
		t.Errorf("pixel = %+v, want opaque green", c)
	}
}

func TestEncodeICODirectory(t *testing.T) {
	sizes := []int{256, 32, 16}
	data, err := encodeICO(quadrant(), sizes)
	if err != nil {
		t.Fatalf("encodeICO: %v", err)
	}

	reserved := binary.LittleEndian.Uint16(data[0:2])
	kind := binary.LittleEndian.Uint16(data[2:4])
	count := binary.LittleEndian.Uint16(data[4:6])
	if reserved != 0 || kind != 1 || int(count) != len(sizes) {
		t.Fatalf("ICONDIR = {reserved:%d type:%d count:%d}, want {0 1 %d}",
			reserved, kind, count, len(sizes))
	}

	for i, size := range sizes {
		entry := data[6+16*i : 6+16*(i+1)]

		// 256 does not fit in the single byte the format gives the dimension,
		// and is written as 0.
		wantDim := byte(size)
		if entry[0] != wantDim || entry[1] != wantDim {
			t.Errorf("%dpx entry dimensions = %dx%d, want %d", size, entry[0], entry[1], wantDim)
		}
		if planes := binary.LittleEndian.Uint16(entry[4:6]); planes != 1 {
			t.Errorf("%dpx entry planes = %d, want 1", size, planes)
		}
		if bpp := binary.LittleEndian.Uint16(entry[6:8]); bpp != 32 {
			// The fixture has transparent pixels, so every frame keeps its alpha.
			t.Errorf("%dpx entry bpp = %d, want 32", size, bpp)
		}

		length := binary.LittleEndian.Uint32(entry[8:12])
		offset := binary.LittleEndian.Uint32(entry[12:16])
		if int(offset+length) > len(data) {
			t.Fatalf("%dpx frame at %d+%d runs past the %d byte file",
				size, offset, length, len(data))
		}

		frame, err := png.Decode(bytes.NewReader(data[offset : offset+length]))
		if err != nil {
			t.Fatalf("%dpx frame is not decodable PNG: %v", size, err)
		}
		if b := frame.Bounds(); b.Dx() != size || b.Dy() != size {
			t.Errorf("%dpx frame decoded to %dx%d", size, b.Dx(), b.Dy())
		}
	}
}

func TestBitsPerPixelFollowsTheEncodedFrame(t *testing.T) {
	opaque := image.NewNRGBA(image.Rect(0, 0, 2, 2))
	for y := 0; y < 2; y++ {
		for x := 0; x < 2; x++ {
			opaque.Set(x, y, color.NRGBA{B: 255, A: 255})
		}
	}

	for _, tc := range []struct {
		name string
		img  image.Image
		want uint16
	}{
		// image/png drops the alpha channel when nothing is transparent, which is
		// the case for the real mark.
		{"opaque", opaque, 24},
		{"with alpha", quadrant(), 32},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var buf bytes.Buffer
			if err := png.Encode(&buf, tc.img); err != nil {
				t.Fatalf("encode: %v", err)
			}
			if got := bitsPerPixel(buf.Bytes()); got != tc.want {
				t.Errorf("bitsPerPixel = %d, want %d", got, tc.want)
			}
		})
	}
}
