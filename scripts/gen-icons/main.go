// Generates the platform icon assets that build/appicon.png cannot serve
// directly, so every shipping platform shows the Konnekt mark:
//
//	build/windows/icon.ico  the exe's icon resource and the NSIS installer icon
//	build/appicon-256.png   embedded in main.go as the GTK window icon on Linux
//
// Both are committed. This exists so they are reproducible from the one source
// image rather than being opaque bytes nobody can regenerate: the scaffolded
// icon.ico was Wails' own "W" logo and survived a year of builds precisely
// because `wails build` only creates that file when it is *missing* (see
// build/README.md), so nothing ever regenerated it and nothing ever noticed.
//
// Deliberately not wired into CI as a clean-diff check, unlike the token layer:
// PNG output is only as stable as compress/flate, so a Go release could redden
// the build without the icon having changed. The icon changes about never; the
// script is here for the day it does.
//
// Run: go run ./scripts/gen-icons
package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"image"
	"image/draw"
	"image/png"
	"os"
	"path/filepath"
)

const (
	sourcePath  = "build/appicon.png"
	icoPath     = "build/windows/icon.ico"
	linuxPath   = "build/appicon-256.png"
	linuxIconPx = 256
)

// Windows picks a frame per context: 16 in the title bar, 32 in Alt-Tab and on
// a shortcut, 48 in Explorer, 256 for the jumbo view, and the rest for the
// fractional-DPI scales in between. Largest first, which is the order every
// other .ico in the wild uses.
var icoSizes = []int{256, 128, 64, 48, 32, 24, 16}

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "gen-icons: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	// Paths are relative to the repo root, so the script behaves the same
	// whether it is run by hand or by a tool that chose its own directory.
	root, err := repoRoot()
	if err != nil {
		return err
	}

	decoded, err := loadPNG(filepath.Join(root, sourcePath))
	if err != nil {
		return fmt.Errorf("read %s: %w", sourcePath, err)
	}
	if b := decoded.Bounds(); b.Dx() != b.Dy() {
		return fmt.Errorf("%s is %dx%d: an app icon has to be square", sourcePath, b.Dx(), b.Dy())
	}
	// Normalised once, not once per frame: resize reads pixels directly out of
	// an *image.NRGBA and would otherwise re-convert all 6.5M source pixels
	// eight times over.
	src := toNRGBA(decoded)

	ico, err := encodeICO(src, icoSizes)
	if err != nil {
		return fmt.Errorf("encode %s: %w", icoPath, err)
	}
	if err := os.WriteFile(filepath.Join(root, icoPath), ico, 0o644); err != nil {
		return fmt.Errorf("write %s: %w", icoPath, err)
	}

	var linuxIcon bytes.Buffer
	if err := png.Encode(&linuxIcon, resize(src, linuxIconPx)); err != nil {
		return fmt.Errorf("encode %s: %w", linuxPath, err)
	}
	if err := os.WriteFile(filepath.Join(root, linuxPath), linuxIcon.Bytes(), 0o644); err != nil {
		return fmt.Errorf("write %s: %w", linuxPath, err)
	}

	fmt.Printf("gen-icons: wrote %s (%d frames) and %s (%dpx)\n",
		icoPath, len(icoSizes), linuxPath, linuxIconPx)
	return nil
}

// repoRoot walks up from the working directory to the directory holding go.mod,
// which is the repo root for this single-module repo.
func repoRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("no go.mod found above the working directory")
		}
		dir = parent
	}
}

func loadPNG(path string) (image.Image, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return png.Decode(bytes.NewReader(data))
}

// encodeICO writes an .ico holding one PNG-compressed frame per size. PNG frames
// at every size (rather than BMP below 256) are what Wails' own generator emits
// and what the winres loader in its build pipeline reads back, and they have
// been valid since Vista.
func encodeICO(src image.Image, sizes []int) ([]byte, error) {
	frames := make([][]byte, len(sizes))
	for i, size := range sizes {
		var buf bytes.Buffer
		if err := png.Encode(&buf, resize(src, size)); err != nil {
			return nil, fmt.Errorf("%dpx frame: %w", size, err)
		}
		frames[i] = buf.Bytes()
	}

	const dirEntryLen = 16
	out := make([]byte, 0, 6+dirEntryLen*len(sizes))

	// ICONDIR: reserved, type 1 (icon), image count. Built by appending rather
	// than through binary.Write so there is no error to swallow on a write to
	// memory that cannot fail.
	le := binary.LittleEndian
	out = le.AppendUint16(out, 0)
	out = le.AppendUint16(out, 1)
	out = le.AppendUint16(out, uint16(len(sizes)))

	offset := uint32(6 + dirEntryLen*len(sizes))
	for i, size := range sizes {
		// 256 is stored as 0: the field is a single byte and 256 does not fit.
		dim := byte(size)
		out = append(out, dim, dim, 0 /* palette size */, 0 /* reserved */)
		out = le.AppendUint16(out, 1) // colour planes
		// Reported from the frame that was actually encoded rather than hardcoded
		// to 32: image/png drops the alpha channel when every pixel is opaque, as
		// the current mark is, and a directory that claims a channel the frame
		// does not carry is the kind of small lie an icon editor will flag.
		out = le.AppendUint16(out, bitsPerPixel(frames[i]))
		out = le.AppendUint32(out, uint32(len(frames[i])))
		out = le.AppendUint32(out, offset)
		offset += uint32(len(frames[i]))
	}
	for _, frame := range frames {
		out = append(out, frame...)
	}
	return out, nil
}

// bitsPerPixel reads the encoded frame's PNG colour type and reports the bit
// depth an ICO directory entry should advertise for it. The colour type sits at
// a fixed offset: everything ahead of it in a PNG is fixed width.
func bitsPerPixel(frame []byte) uint16 {
	// 8-byte signature, then the IHDR chunk's 4-byte length and 4-byte type,
	// then IHDR's 4-byte width, 4-byte height and 1-byte bit depth.
	const colourTypeOffset = 8 + 4 + 4 + 4 + 4 + 1
	if len(frame) > colourTypeOffset && frame[colourTypeOffset] == 6 {
		return 32 // truecolour with alpha
	}
	return 24 // truecolour
}

// toNRGBA returns src as an *image.NRGBA anchored at the origin, so callers can
// index Pix directly instead of going through At(): the interface dispatch and
// the 16-bit round trip cost real time at a few million pixels per frame. It is
// a no-op for an image that is already in that shape.
func toNRGBA(src image.Image) *image.NRGBA {
	b := src.Bounds()
	if n, ok := src.(*image.NRGBA); ok && b.Eq(image.Rect(0, 0, b.Dx(), b.Dy())) {
		return n
	}
	out := image.NewNRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(out, out.Bounds(), src, b.Min, draw.Src)
	return out
}

// resize box-filters src down to size x size. Every destination pixel is the
// average of the source pixels it covers, which is the right filter here: the
// mark is flat colour with hard edges, and coverage averaging is exactly what
// antialiases those edges as they shrink towards 16px. Only ever downscaling,
// so there is no upsampling case to get wrong.
func resize(src image.Image, size int) *image.NRGBA {
	srcN := toNRGBA(src)
	sw, sh := srcN.Bounds().Dx(), srcN.Bounds().Dy()

	dst := image.NewNRGBA(image.Rect(0, 0, size, size))
	for dy := 0; dy < size; dy++ {
		y0, y1 := dy*sh/size, (dy+1)*sh/size
		if y1 <= y0 {
			y1 = y0 + 1
		}
		for dx := 0; dx < size; dx++ {
			x0, x1 := dx*sw/size, (dx+1)*sw/size
			if x1 <= x0 {
				x1 = x0 + 1
			}

			// Averaged with alpha premultiplied, then unpremultiplied on the way
			// out. Averaging straight NRGBA channels would let the colour of a
			// fully transparent source pixel bleed into the result.
			var sumR, sumG, sumB, sumA uint64
			for y := y0; y < y1; y++ {
				row := srcN.Pix[y*srcN.Stride+x0*4 : y*srcN.Stride+x1*4]
				for i := 0; i < len(row); i += 4 {
					a := uint64(row[i+3])
					sumR += uint64(row[i+0]) * a
					sumG += uint64(row[i+1]) * a
					sumB += uint64(row[i+2]) * a
					sumA += a
				}
			}

			o := dst.PixOffset(dx, dy)
			n := uint64((x1 - x0) * (y1 - y0))
			if sumA == 0 {
				dst.Pix[o+0], dst.Pix[o+1], dst.Pix[o+2], dst.Pix[o+3] = 0, 0, 0, 0
				continue
			}
			dst.Pix[o+0] = byte((sumR + sumA/2) / sumA)
			dst.Pix[o+1] = byte((sumG + sumA/2) / sumA)
			dst.Pix[o+2] = byte((sumB + sumA/2) / sumA)
			dst.Pix[o+3] = byte((sumA + n/2) / n)
		}
	}
	return dst
}
