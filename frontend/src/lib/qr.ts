/**
 * A QR Code Model 2 encoder, written for one job: drawing the Remote Access
 * tunnel's address (`https://<words>.trycloudflare.com`) so a phone can read it
 * off the desktop screen. It is a pure function from a string to a matrix and
 * touches no DOM, so the address never leaves the process (#479).
 *
 * It does exactly what that needs and no more: byte mode, error-correction
 * level M, versions 1 to 10 (213 bytes at most). Level M recovers about 15% of
 * the codewords, which is ample margin for glare and moire on a screen that is
 * never smudged or torn, while costing about a third less area than Q or H; L
 * would shrink the symbol a little more but leaves no slack for a poor camera.
 * Every table below is the M column of ISO/IEC 18004:2015, cited where it
 * appears, and `qr.test.ts` pins them against the published values.
 */

/** Level M's two-bit indicator (ISO/IEC 18004 Table 12). The others are L=01, Q=11, H=10. */
const EC_LEVEL_M_BITS = 0b00

const MIN_VERSION = 1
const MAX_VERSION = 10

/** Quiet zone width in modules, ISO/IEC 18004 section 6.3.8. */
export const QUIET_ZONE = 4

// ---------------------------------------------------------------------------
// GF(256), the field Reed-Solomon works in. ISO/IEC 18004 section 7.5.2: the
// field is built from the primitive polynomial x^8 + x^4 + x^3 + x^2 + 1
// (0x11D), and the generator's roots are the powers of alpha = 2.

const FIELD_POLY = 0x11d

const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
{
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= FIELD_POLY
  }
  // Doubling the table lets a product of two logs index it without a modulo.
  for (let i = 255; i < EXP.length; i++) EXP[i] = EXP[i - 255]
}

export function gfMul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]
}

const generators = new Map<number, number[]>()

/**
 * The Reed-Solomon generator polynomial of the given degree, the product of
 * (x - alpha^i) for i below it, highest power first. The leading coefficient
 * (always 1) is kept, so the array holds `degree + 1` entries.
 */
export function rsGenerator(degree: number): number[] {
  const cached = generators.get(degree)
  if (cached) return cached
  let poly = [1]
  for (let i = 0; i < degree; i++) {
    const next = Array.from({ length: poly.length + 1 }, () => 0)
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j]
      next[j + 1] ^= gfMul(poly[j], EXP[i])
    }
    poly = next
  }
  generators.set(degree, poly)
  return poly
}

/** The `degree` error-correction codewords of `data`: the remainder of data * x^degree over the generator. */
export function rsEncode(data: readonly number[], degree: number): number[] {
  const gen = rsGenerator(degree)
  const rem = Array.from({ length: degree }, () => 0)
  for (const byte of data) {
    const factor = byte ^ (rem.shift() ?? 0)
    rem.push(0)
    for (let i = 0; i < degree; i++) rem[i] ^= gfMul(gen[i + 1], factor)
  }
  return rem
}

// ---------------------------------------------------------------------------
// Capacity, versions 1 to 10, level M.

interface Layout {
  /** Error-correction codewords in each block. */
  ec: number
  /** Blocks as [count, data codewords per block]; the second group, when there is one, is a codeword longer. */
  groups: readonly (readonly [number, number])[]
}

/** ISO/IEC 18004:2015 Table 9, level M, indexed by version minus one. */
const LAYOUTS: readonly Layout[] = [
  { ec: 10, groups: [[1, 16]] },
  { ec: 16, groups: [[1, 28]] },
  { ec: 26, groups: [[1, 44]] },
  { ec: 18, groups: [[2, 32]] },
  { ec: 24, groups: [[2, 43]] },
  { ec: 16, groups: [[4, 27]] },
  { ec: 18, groups: [[4, 31]] },
  {
    ec: 22,
    groups: [
      [2, 38],
      [2, 39],
    ],
  },
  {
    ec: 22,
    groups: [
      [3, 36],
      [2, 37],
    ],
  },
  {
    ec: 26,
    groups: [
      [4, 43],
      [1, 44],
    ],
  },
]

/**
 * Alignment pattern centre coordinates, ISO/IEC 18004:2015 Annex E, indexed by
 * version minus one. Version 1 has none.
 */
export const ALIGNMENT_CENTRES: readonly (readonly number[])[] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
]

function dataCodewordCount(version: number): number {
  return LAYOUTS[version - 1].groups.reduce((sum, [count, len]) => sum + count * len, 0)
}

/** Table 3: the character count indicator is 8 bits up to version 9 and 16 from 10. */
function countBits(version: number): number {
  return version < 10 ? 8 : 16
}

/** Bytes that fit in a version: its data bits less the 4-bit mode and the count indicator. */
function byteCapacity(version: number): number {
  return Math.floor((dataCodewordCount(version) * 8 - 4 - countBits(version)) / 8)
}

/** The smallest version that holds `byteLength` bytes, or a RangeError when none of 1 to 10 does. */
export function selectVersion(byteLength: number): number {
  for (let v = MIN_VERSION; v <= MAX_VERSION; v++) {
    if (byteLength <= byteCapacity(v)) return v
  }
  throw new RangeError(
    `Too long for a QR code: ${byteLength} bytes, at most ${byteCapacity(MAX_VERSION)}`,
  )
}

// ---------------------------------------------------------------------------
// The codeword stream.

function appendBits(bits: number[], value: number, length: number): void {
  for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1)
}

/** Sections 7.4.2 to 7.4.10: mode, count, data, terminator, byte alignment, then alternating pad codewords. */
export function dataCodewords(bytes: Uint8Array, version: number): number[] {
  const capacityBits = dataCodewordCount(version) * 8
  const bits: number[] = []
  appendBits(bits, 0b0100, 4) // byte mode indicator, Table 2
  appendBits(bits, bytes.length, countBits(version))
  for (const byte of bytes) appendBits(bits, byte, 8)
  appendBits(bits, 0, Math.min(4, capacityBits - bits.length))
  while (bits.length % 8 !== 0) bits.push(0)

  const words: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    words.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0))
  }
  // 0xEC and 0x11 alternate to fill what the data leaves, section 7.4.10.
  for (let pad = 0xec; words.length < capacityBits / 8; pad ^= 0xec ^ 0x11) words.push(pad)
  return words
}

/**
 * Splits the data into blocks, appends each block's error-correction codewords
 * and interleaves them as section 7.6 lays out: data column by column across the
 * blocks, then error correction the same way.
 */
export function interleave(data: readonly number[], version: number): number[] {
  const { ec, groups } = LAYOUTS[version - 1]
  const blocks: number[][] = []
  let at = 0
  for (const [count, len] of groups) {
    for (let i = 0; i < count; i++, at += len) blocks.push(data.slice(at, at + len))
  }
  const checks = blocks.map((block) => rsEncode(block, ec))
  const out: number[] = []
  const longest = Math.max(...blocks.map((block) => block.length))
  for (let i = 0; i < longest; i++) {
    for (const block of blocks) if (i < block.length) out.push(block[i])
  }
  for (let i = 0; i < ec; i++) {
    for (const check of checks) out.push(check[i])
  }
  return out
}

// ---------------------------------------------------------------------------
// Format and version information, both BCH codes (section 7.9 and 7.10).

/** The remainder of `value` shifted up by `bits` and divided by `poly`, which has degree `bits`. */
function bchRemainder(value: number, poly: number, bits: number): number {
  let rem = value
  for (let i = 0; i < bits; i++) rem = (rem << 1) ^ ((rem >>> (bits - 1)) * poly)
  return rem
}

/**
 * The 15 format bits for level M and a mask: 5 data bits, a (15,5) BCH code
 * with generator 0x537, XORed with 0x5412 so the result is never all zeros.
 */
export function formatBits(mask: number): number {
  const data = (EC_LEVEL_M_BITS << 3) | mask
  return ((data << 10) | bchRemainder(data, 0x537, 10)) ^ 0x5412
}

/** The 18 version bits for version 7 and up: the version and a (18,6) BCH code with generator 0x1F25. */
export function versionBits(version: number): number {
  return (version << 12) | bchRemainder(version, 0x1f25, 12)
}

type Setter = (x: number, y: number, dark: boolean) => void

/** Both copies of the format information, then the dark module that always sits beside the lower one. */
function drawFormat(size: number, mask: number, set: Setter): void {
  const bits = formatBits(mask)
  const bit = (i: number) => ((bits >>> i) & 1) === 1
  for (let i = 0; i <= 14; i++) {
    // First copy, wrapped around the top-left finder, skipping the timing row and column.
    if (i <= 5) set(8, i, bit(i))
    else if (i === 6) set(8, 7, bit(i))
    else if (i === 7) set(8, 8, bit(i))
    else if (i === 8) set(7, 8, bit(i))
    else set(14 - i, 8, bit(i))
    // Second copy, split between the top-right and bottom-left finders.
    if (i <= 7) set(size - 1 - i, 8, bit(i))
    else set(8, size - 15 + i, bit(i))
  }
  set(8, size - 8, true)
}

/** Version information is written twice, as two 6 by 3 blocks beside the top-right and bottom-left finders. */
function drawVersion(version: number, size: number, set: Setter): void {
  if (version < 7) return
  const bits = versionBits(version)
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) === 1
    const a = size - 11 + (i % 3)
    const b = Math.floor(i / 3)
    set(a, b, dark)
    set(b, a, dark)
  }
}

// ---------------------------------------------------------------------------
// The matrix. Rows are indexed [y][x] throughout; `true` is a dark module.

interface Grid {
  size: number
  dark: boolean[][]
  /** A function module (finder, timing, alignment, format, version): data skips it and the mask leaves it alone. */
  fixed: boolean[][]
}

function blank(size: number): boolean[][] {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => false))
}

function drawFunctionPatterns(version: number): Grid {
  const size = 17 + 4 * version
  const grid: Grid = { size, dark: blank(size), fixed: blank(size) }
  const set: Setter = (x, y, dark) => {
    grid.dark[y][x] = dark
    grid.fixed[y][x] = true
  }

  // The timing patterns run first so the finders and alignment patterns draw over them.
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0)
    set(i, 6, i % 2 === 0)
  }

  // Finders with their one-module separator: concentric squares of radius 0 to 4, dark except rings 2 and 4.
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx
        const y = cy + dy
        if (x < 0 || y < 0 || x >= size || y >= size) continue
        const ring = Math.max(Math.abs(dx), Math.abs(dy))
        set(x, y, ring !== 2 && ring !== 4)
      }
    }
  }

  // Alignment patterns sit on every pair of centres except the three that would land on a finder.
  const centres = ALIGNMENT_CENTRES[version - 1]
  const last = centres.length - 1
  centres.forEach((cy, i) => {
    centres.forEach((cx, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++)
          set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
      }
    })
  })

  // Format and version cells are reserved now and rewritten once a mask is chosen.
  drawFormat(size, 0, set)
  drawVersion(version, size, set)
  return grid
}

/**
 * Writes the codewords most significant bit first, in two-column strips that
 * zigzag up and down from the bottom right (section 7.7.3). The strip pair that
 * would straddle the vertical timing pattern at x = 6 steps over it. Bits left
 * after the last codeword (the remainder bits of versions 2 to 6) stay light.
 */
function placeCodewords(grid: Grid, codewords: readonly number[]): void {
  const { size, dark, fixed } = grid
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    const upward = ((right + 1) & 2) === 0
    for (let step = 0; step < size; step++) {
      const y = upward ? size - 1 - step : step
      for (const x of [right, right - 1]) {
        if (fixed[y][x] || i >= codewords.length * 8) continue
        dark[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1
        i++
      }
    }
  }
}

/** The eight data masks of Table 10, as a predicate on the row i and column j. */
const MASKS: readonly ((i: number, j: number) => boolean)[] = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (_i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0,
]

/** A copy of the grid's modules with the mask applied to the data area and its format bits written. */
function masked(grid: Grid, version: number, mask: number): boolean[][] {
  const { size, dark, fixed } = grid
  const out = dark.map((row, y) =>
    row.map((cell, x) => (fixed[y][x] ? cell : cell !== MASKS[mask](y, x))),
  )
  const set: Setter = (x, y, value) => {
    out[y][x] = value
  }
  drawFormat(size, mask, set)
  drawVersion(version, size, set)
  return out
}

// ---------------------------------------------------------------------------
// Mask selection, section 7.8.3. The mask with the lowest penalty wins.

const PENALTY_RUN = 3
const PENALTY_BLOCK = 3
const PENALTY_FINDER_LIKE = 40
const PENALTY_BALANCE = 10

/** The 1:1:3:1:1 finder-like run, dark first. */
const FINDER_LIKE = [true, false, true, true, true, false, true]

const lightFor = (line: readonly boolean[], from: number, to: number) =>
  from >= 0 && to <= line.length && line.slice(from, to).every((cell) => !cell)

/** Rule 1 (runs of five or more) and rule 3 (a finder-like run with four light modules beside it) along one row or column. */
function linePenalty(line: readonly boolean[]): number {
  let score = 0
  let run = 1
  for (let i = 1; i <= line.length; i++) {
    if (i < line.length && line[i] === line[i - 1]) {
      run++
      continue
    }
    if (run >= 5) score += PENALTY_RUN + run - 5
    run = 1
  }
  for (let i = 0; i + FINDER_LIKE.length <= line.length; i++) {
    if (!FINDER_LIKE.every((cell, k) => line[i + k] === cell)) continue
    if (lightFor(line, i - 4, i)) score += PENALTY_FINDER_LIKE
    if (lightFor(line, i + 7, i + 11)) score += PENALTY_FINDER_LIKE
  }
  return score
}

function penalty(modules: readonly (readonly boolean[])[]): number {
  const size = modules.length
  let score = 0
  for (let k = 0; k < size; k++) {
    score += linePenalty(modules[k])
    score += linePenalty(modules.map((row) => row[k]))
  }
  // Rule 2: every 2 by 2 block of one colour.
  for (let y = 0; y + 1 < size; y++) {
    for (let x = 0; x + 1 < size; x++) {
      const c = modules[y][x]
      if (modules[y][x + 1] === c && modules[y + 1][x] === c && modules[y + 1][x + 1] === c)
        score += PENALTY_BLOCK
    }
  }
  // Rule 4: how far the share of dark modules is from half, in steps of five percentage points.
  const darkCount = modules.reduce((sum, row) => sum + row.filter(Boolean).length, 0)
  const total = size * size
  score += Math.floor(Math.abs(darkCount * 20 - total * 10) / total) * PENALTY_BALANCE
  return score
}

// ---------------------------------------------------------------------------

/**
 * Encodes `text` (as UTF-8 bytes) into a square matrix, `true` for a dark
 * module, without the quiet zone. Throws a RangeError past 213 bytes.
 *
 * `forceMask` pins one of the eight masks instead of scoring them, which is
 * what lets a test put each of them through a real decoder.
 */
export function encodeQr(text: string, forceMask?: number): boolean[][] {
  if (
    forceMask !== undefined &&
    !(Number.isInteger(forceMask) && forceMask >= 0 && forceMask < 8)
  ) {
    throw new RangeError(`Mask must be 0 to 7, got ${forceMask}`)
  }
  const bytes = new TextEncoder().encode(text)
  const version = selectVersion(bytes.length)
  const grid = drawFunctionPatterns(version)
  placeCodewords(grid, interleave(dataCodewords(bytes, version), version))

  if (forceMask !== undefined) return masked(grid, version, forceMask)
  let best: boolean[][] = []
  let bestScore = Infinity
  for (let mask = 0; mask < MASKS.length; mask++) {
    const candidate = masked(grid, version, mask)
    const score = penalty(candidate)
    if (score < bestScore) {
      best = candidate
      bestScore = score
    }
  }
  return best
}
