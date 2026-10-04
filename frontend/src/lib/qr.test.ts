import { describe, it, expect } from 'vitest'
import {
  ALIGNMENT_CENTRES,
  dataCodewords,
  encodeQr,
  formatBits,
  gfMul,
  interleave,
  rsEncode,
  rsGenerator,
  selectVersion,
  versionBits,
} from './qr'

const bin = (value: number, width: number) => value.toString(2).padStart(width, '0')
const sizeOf = (version: number) => 17 + 4 * version

/** Multiplication by shift and add, reducing by 0x11D: the field's definition, with no tables. */
function slowMul(a: number, b: number): number {
  let product = 0
  for (let i = 7; i >= 0; i--) {
    product <<= 1
    if (product & 0x100) product ^= 0x11d
    if ((b >> i) & 1) product ^= a
  }
  return product
}

/** alpha^n, by repeated multiplication of 2, independent of the module's tables. */
function alpha(n: number): number {
  let value = 1
  for (let i = 0; i < n; i++) value = slowMul(value, 2)
  return value
}

/** The matrix rows of a golden fixture: one hex string per row, most significant bit first, padded with zeros. */
function fromHex(rows: readonly string[], size: number): boolean[][] {
  return rows.map((row) => {
    const bits = [...row].map((digit) => bin(parseInt(digit, 16), 4)).join('')
    return [...bits.slice(0, size)].map((bit) => bit === '1')
  })
}

/** Both copies of the format information, read at the coordinates ISO/IEC 18004 Figure 25 gives, as [row][col]. */
function readFormat(m: boolean[][]): [number, number] {
  const size = m.length
  const first: [number, number][] = [
    [0, 8],
    [1, 8],
    [2, 8],
    [3, 8],
    [4, 8],
    [5, 8],
    [7, 8],
    [8, 8],
    [8, 7],
    [8, 5],
    [8, 4],
    [8, 3],
    [8, 2],
    [8, 1],
    [8, 0],
  ]
  const second: [number, number][] = [
    ...Array.from({ length: 8 }, (_, i): [number, number] => [8, size - 1 - i]),
    ...Array.from({ length: 7 }, (_, i): [number, number] => [size - 7 + i, 8]),
  ]
  const read = (cells: [number, number][]) =>
    cells.reduce((acc, [row, col], i) => acc | ((m[row][col] ? 1 : 0) << i), 0)
  return [read(first), read(second)]
}

/** A byte count that selects each of the versions the tests need, 1 and 2 aside. */
const CAPACITY_FOR: Record<number, number> = { 1: 5, 2: 20, 7: 110, 8: 140, 9: 170, 10: 200 }

const filler = (n: number) =>
  Array.from(
    { length: n },
    (_, i) => 'abcdefghijklmnopqrstuvwxyz0123456789-.'[(i * 7 + 3) % 38],
  ).join('')

describe('GF(256)', () => {
  it('multiplies as the field is defined, for every pair', () => {
    for (let a = 0; a < 256; a++) {
      for (let b = 0; b < 256; b++) expect(gfMul(a, b)).toBe(slowMul(a, b))
    }
  })

  it('has 2 as a generator of all 255 non-zero elements', () => {
    const seen = new Set<number>()
    let value = 1
    for (let i = 0; i < 255; i++) {
      seen.add(value)
      value = gfMul(value, 2)
    }
    expect(seen.size).toBe(255)
    expect(value).toBe(1)
  })
})

describe('Reed-Solomon', () => {
  // Thonky's QR tutorial lists these generators as exponents of alpha, highest power first.
  it('builds the generator polynomial of degree 7 as the tutorial lists it', () => {
    const exponents = [0, 87, 229, 146, 149, 238, 102, 21]
    expect(rsGenerator(7)).toEqual(exponents.map(alpha))
  })

  it('builds the generator polynomial of degree 10 as the tutorial lists it', () => {
    const exponents = [0, 251, 67, 46, 61, 118, 70, 64, 94, 32, 45]
    expect(rsGenerator(10)).toEqual(exponents.map(alpha))
  })

  it('has a root at each of alpha^0 to alpha^(degree-1)', () => {
    for (const degree of [10, 18, 26]) {
      const gen = rsGenerator(degree)
      for (let r = 0; r < degree; r++) {
        const x = alpha(r)
        expect(gen.reduce((acc, coefficient) => gfMul(acc, x) ^ coefficient, 0)).toBe(0)
      }
    }
  })

  it('reproduces the "HELLO WORLD" 1-M error-correction codewords from the tutorial', () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17]
    expect(rsEncode(data, 10)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23])
  })

  it('reproduces the "01234567" 1-M error-correction codewords from ISO/IEC 18004 Annex I', () => {
    const data = [16, 32, 12, 86, 97, 128, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17]
    expect(rsEncode(data, 10)).toEqual([165, 36, 212, 193, 237, 54, 199, 135, 44, 85])
  })

  it('makes data followed by its check codewords divisible by the generator', () => {
    const data = Array.from({ length: 44 }, (_, i) => (i * 37 + 11) % 256)
    const word = [...data, ...rsEncode(data, 26)]
    const x = alpha(5)
    expect(word.reduce((acc, c) => gfMul(acc, x) ^ c, 0)).toBe(0)
  })
})

describe('the codeword stream', () => {
  it('lays out byte mode as mode, count, data, terminator and pad codewords', () => {
    // 0100 | 00000001 | 01000001 ("A") | 0000, then 0xEC and 0x11 alternate to 16 codewords.
    const words = dataCodewords(new TextEncoder().encode('A'), 1)
    expect(words.slice(0, 5)).toEqual([0x40, 0x14, 0x10, 0xec, 0x11])
    expect(words).toHaveLength(16)
    expect(words.slice(3).every((w, i) => w === (i % 2 === 0 ? 0xec : 0x11))).toBe(true)
  })

  it('fills the version exactly at the byte capacity, with a shortened terminator', () => {
    const words = dataCodewords(new TextEncoder().encode(filler(14)), 1)
    expect(words).toHaveLength(16)
    // 4 + 8 + 112 = 124 bits leaves 4 for the terminator, which is all the capacity allows.
    expect(bin(words[15], 8).endsWith('0000')).toBe(true)
  })

  it('writes a 16-bit count from version 10', () => {
    const words = dataCodewords(new TextEncoder().encode(filler(200)), 10)
    expect(words.slice(0, 3)).toEqual([0x40, 0x0c, 0x86])
    expect(words).toHaveLength(216)
  })

  it('interleaves unequal blocks by column, then the check codewords', () => {
    // Version 8-M: 2 blocks of 38 data codewords, then 2 of 39, 22 check codewords each.
    const data = Array.from({ length: 154 }, (_, i) => i + 1)
    const out = interleave(data, 8)
    expect(out).toHaveLength(242)
    expect(out.slice(0, 4)).toEqual([1, 39, 77, 116])
    // Column 38 exists only in the two longer blocks.
    expect(out.slice(152, 154)).toEqual([115, 154])
    const first = rsEncode(data.slice(0, 38), 22)
    const third = rsEncode(data.slice(76, 115), 22)
    expect(out.slice(154, 158)).toEqual([
      first[0],
      rsEncode(data.slice(38, 76), 22)[0],
      third[0],
      rsEncode(data.slice(115), 22)[0],
    ])
    expect(out.slice(-4)[0]).toBe(first[21])
  })
})

describe('format and version information', () => {
  // ISO/IEC 18004:2015 Table C.1, level M (data bits 00, mask 000 to 111).
  const FORMAT_M = [
    '101010000010010',
    '101000100100101',
    '101111001111100',
    '101101101001011',
    '100010111111001',
    '100000011001110',
    '100111110010111',
    '100101010100000',
  ]

  it.each(FORMAT_M.map((bits, mask) => [mask, bits] as const))(
    'has the published format bits for M and mask %i',
    (mask, bits) => {
      expect(bin(formatBits(mask), 15)).toBe(bits)
    },
  )

  // ISO/IEC 18004:2015 Table D.1.
  it.each([
    [7, '000111110010010100'],
    [8, '001000010110111100'],
    [9, '001001101010011001'],
    [10, '001010010011010011'],
  ])('has the published version bits for version %i', (version, bits) => {
    expect(bin(versionBits(version), 18)).toBe(bits)
  })
})

describe('version selection at level M, byte mode', () => {
  const CAPACITY = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213]

  it.each(CAPACITY.map((capacity, i) => [i + 1, capacity] as const))(
    'version %i holds %i bytes and no more',
    (version, capacity) => {
      expect(selectVersion(capacity)).toBe(version)
      if (version > 1) expect(selectVersion(CAPACITY[version - 2] + 1)).toBe(version)
    },
  )

  it('takes version 1 for nothing at all', () => {
    expect(selectVersion(0)).toBe(1)
  })

  it('refuses what version 10 cannot hold', () => {
    expect(() => selectVersion(214)).toThrow(RangeError)
    expect(() => encodeQr('x'.repeat(214))).toThrow(RangeError)
  })

  it('counts bytes, not characters', () => {
    // 3 + 1 characters, but the euro sign is three bytes in UTF-8: 15 bytes.
    expect(encodeQr('abc€€€€').length).toBe(sizeOf(2))
    expect(encodeQr('abcdefghijklmn').length).toBe(sizeOf(1))
  })
})

describe('function patterns', () => {
  const finder = (m: boolean[][], row: number, col: number) =>
    Array.from({ length: 7 }, (_, r) =>
      Array.from({ length: 7 }, (_, c) => (m[row + r][col + c] ? '#' : '.')).join(''),
    )
  const FINDER = ['#######', '#.....#', '#.###.#', '#.###.#', '#.###.#', '#.....#', '#######']

  it.each([1, 2, 7, 10])(
    'draws the three finders, separated by light modules, in version %i',
    (version) => {
      const m = encodeQr('x'.repeat(CAPACITY_FOR[version] ?? 5))
      expect(m.length).toBe(sizeOf(version))
      const size = m.length
      expect(finder(m, 0, 0)).toEqual(FINDER)
      expect(finder(m, 0, size - 7)).toEqual(FINDER)
      expect(finder(m, size - 7, 0)).toEqual(FINDER)
      // The separators: the row and column just inside the symbol next to each finder.
      for (let i = 0; i < 8; i++) {
        expect(m[7][i] || m[i][7]).toBe(false)
        expect(m[7][size - 1 - i] || m[i][size - 8]).toBe(false)
        expect(m[size - 8][i] || m[size - 1 - i][7]).toBe(false)
      }
    },
  )

  it('runs the timing patterns alternately between the finders', () => {
    const m = encodeQr('https://example-words-here.trycloudflare.com')
    for (let i = 8; i < m.length - 8; i++) {
      expect(m[6][i]).toBe(i % 2 === 0)
      expect(m[i][6]).toBe(i % 2 === 0)
    }
  })

  it('sets the dark module beside the lower-left finder', () => {
    for (const text of ['a', 'b'.repeat(60), 'c'.repeat(200)]) {
      const m = encodeQr(text)
      expect(m[m.length - 8][8]).toBe(true)
    }
  })

  it('lists the published alignment centres', () => {
    expect(ALIGNMENT_CENTRES.map((c) => [...c])).toEqual([
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
    ])
  })

  it.each([
    [2, 'x'.repeat(20)],
    [4, 'x'.repeat(60)],
    [7, 'x'.repeat(120)],
    [10, 'x'.repeat(200)],
  ])(
    'draws an alignment pattern at every centre but the three on finders in version %i',
    (version, text) => {
      const m = encodeQr(text)
      expect(m.length).toBe(sizeOf(version))
      const centres = ALIGNMENT_CENTRES[version - 1]
      const last = centres.length - 1
      centres.forEach((cy, i) => {
        centres.forEach((cx, j) => {
          if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return
          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              expect(m[cy + dy][cx + dx]).toBe(Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
            }
          }
        })
      })
    },
  )

  it.each([7, 8, 9, 10])('writes version %i twice, in both 6 by 3 blocks', (version) => {
    const m = encodeQr('x'.repeat(CAPACITY_FOR[version]))
    expect(m.length).toBe(sizeOf(version))
    const size = m.length
    const bits = versionBits(version)
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >> i) & 1) === 1
      const row = Math.floor(i / 3)
      const col = size - 11 + (i % 3)
      expect(m[row][col]).toBe(dark)
      expect(m[col][row]).toBe(dark)
    }
  })

  it.each([0, 1, 2, 3, 4, 5, 6, 7])('writes the format bits for mask %i in both places', (mask) => {
    const m = encodeQr('https://a.co', mask)
    expect(readFormat(m)).toEqual([formatBits(mask), formatBits(mask)])
  })
})

describe('masking', () => {
  it('recovers the same unmasked data under every mask', () => {
    const text = 'https://a.co'
    const predicates = [
      (i: number, j: number) => (i + j) % 2 === 0,
      (i: number) => i % 2 === 0,
      (_i: number, j: number) => j % 3 === 0,
      (i: number, j: number) => (i + j) % 3 === 0,
      (i: number, j: number) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
      (i: number, j: number) => ((i * j) % 2) + ((i * j) % 3) === 0,
      (i: number, j: number) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
      (i: number, j: number) => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0,
    ]
    const reference = encodeQr(text, 0)
    const size = reference.length
    // Version 1 has no alignment or version blocks, so the function area is the
    // finders with separators, the timing lines and the format strips.
    const isData = (y: number, x: number) =>
      !(y < 9 && x < 9) &&
      !(y < 9 && x >= size - 8) &&
      !(y >= size - 8 && x < 9) &&
      y !== 6 &&
      x !== 6
    for (let mask = 1; mask < 8; mask++) {
      const m = encodeQr(text, mask)
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (!isData(y, x)) continue
          const unmasked = m[y][x] !== predicates[mask](y, x)
          const base = reference[y][x] !== predicates[0](y, x)
          expect(unmasked).toBe(base)
        }
      }
    }
  })

  it('rejects a mask outside 0 to 7', () => {
    expect(() => encodeQr('a', 8)).toThrow(RangeError)
    expect(() => encodeQr('a', -1)).toThrow(RangeError)
    expect(() => encodeQr('a', 1.5)).toThrow(RangeError)
  })

  it('is deterministic', () => {
    const text = 'https://example-words-here.trycloudflare.com'
    expect(encodeQr(text)).toEqual(encodeQr(text))
  })
})

/*
 * Golden symbols. Each was decoded, as an image with a four-module quiet zone,
 * by two independent readers (jsQR and zxing-cpp) to exactly the text beside
 * it, in a throwaway directory outside the repo, so a matching encoder here is
 * one that scans. They guard the whole pipeline (version choice, interleaving,
 * placement, mask scoring) against a change that keeps every unit above green
 * and breaks the symbol. Rows are hex, most significant bit first.
 */
const GOLDEN: { text: string; version: number; mask: number; rows: string[] }[] = [
  {
    text: 'https://a.co',
    version: 1,
    mask: 6,
    rows: [
      'fee3f8',
      '82ca08',
      'bafae8',
      'ba7ae8',
      'ba8ae8',
      '825a08',
      'feabf8',
      '005800',
      '9fccb8',
      'a12c70',
      'b6e578',
      '9c3520',
      'ab8410',
      '00cef0',
      'fec9a0',
      '82f268',
      'baa190',
      'bad760',
      'ba6df8',
      '8273f8',
      'fe8fc0',
    ],
  },
  {
    text: 'https://example-words-here.trycloudflare.com',
    version: 4,
    mask: 2,
    rows: [
      'fe66f13f8',
      '82474aa08',
      'bad470ae8',
      'bac38eae8',
      'ba8560ae8',
      '82998e208',
      'feaaaabf8',
      '00ab04000',
      'be17cb3e0',
      'cd98bd378',
      '73b9240b0',
      'a8238e2f8',
      'df7125cd8',
      '944bcf278',
      '924236670',
      '7140bf760',
      '075cd1d88',
      'f078f9368',
      '8e83425b0',
      '8cdcf0de0',
      '23d88e9d8',
      'dd9921268',
      'a7938e530',
      '94db07ce0',
      '82554af98',
      '00f81e8a8',
      'fe37adab0',
      '82a59f8f8',
      'bab934fc0',
      'ba818ece8',
      'babe72700',
      '8252be6e0',
      'feb853b10',
    ],
  },
  {
    // 122 bytes, the capacity of version 7, the first with version information.
    text: 'https://' + filler(114),
    version: 7,
    mask: 2,
    rows: [
      'fe2d505f0bf8',
      '821ca7e85208',
      'baff7c0ad2e8',
      'bab6fbf71ae8',
      'baff0fc33ae8',
      '82f8a8bdc208',
      'feaaaaaaabf8',
      '00a4f8db8800',
      'be163fc753e0',
      'e460d64698d8',
      '6ac0babcff70',
      'ed5ec0df90e0',
      'deba33c05648',
      '0879924f4d38',
      '577b2fa16a80',
      '8048d0d880e8',
      'bf8977c34710',
      'f556550f58a8',
      '5b0e0fe13210',
      '5dd63128f1a8',
      '0f8fffa20fd0',
      'c8aa88df98e8',
      '2a8e1af03ab0',
      '98b928e8e8e8',
      '1fde3f932fd0',
      '1d483f5b9668',
      '7e4d65742cb0',
      'c91fe68db628',
      '63dc2c576ac8',
      'cc18da569218',
      '6ed1a535e170',
      '78331e9dd378',
      '2b56d8c443d8',
      '042af21f4a18',
      '0ac4e86cac60',
      '79eec38fde68',
      '9be49fc24f88',
      '00ec48cf98e8',
      'fe2a1af93ab0',
      '82d4588ed8f0',
      'baaeeff37fd8',
      'baf0f0db96b8',
      'babf2e612c30',
      '827cbe2e8520',
      'fee131932350',
    ],
  },
]

describe('golden symbols', () => {
  it.each(GOLDEN)(
    'encodes $text to the symbol two decoders read back',
    ({ text, version, mask, rows }) => {
      const m = encodeQr(text)
      expect(m.length).toBe(sizeOf(version))
      expect(m).toEqual(fromHex(rows, m.length))
      expect(readFormat(m)).toEqual([formatBits(mask), formatBits(mask)])
    },
  )
})
