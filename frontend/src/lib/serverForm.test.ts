import { describe, it, expect } from 'vitest'
import {
  parseRamFromArgs,
  mergeRamIntoArgs,
  dirOf,
  baseOf,
  isLaunchScript,
  heapToMB,
  heapAdvice,
  formatMB,
} from './serverForm'

describe('parseRamFromArgs', () => {
  it('reads both flags', () => {
    expect(parseRamFromArgs('-Xms512M -Xmx2G')).toEqual({ minRam: '512M', maxRam: '2G' })
  })

  it('reads them out of a longer expression, in any order', () => {
    expect(parseRamFromArgs('-XX:+UseG1GC -Xmx8G -Dfoo=bar -Xms1G')).toEqual({
      minRam: '1G',
      maxRam: '8G',
    })
  })

  it('gives empty strings for flags that are absent', () => {
    expect(parseRamFromArgs('-XX:+UseG1GC')).toEqual({ minRam: '', maxRam: '' })
  })
})

describe('mergeRamIntoArgs', () => {
  it('replaces flags in place, keeping the rest of the expression', () => {
    expect(mergeRamIntoArgs('-Xms512M -XX:+UseG1GC -Xmx2G', '1G', '8G')).toBe(
      '-Xms1G -XX:+UseG1GC -Xmx8G',
    )
  })

  it('appends flags that are not there yet', () => {
    expect(mergeRamIntoArgs('-XX:+UseG1GC', '1G', '8G')).toBe('-XX:+UseG1GC -Xms1G -Xmx8G')
  })

  it('leaves a flag alone when its value is empty', () => {
    expect(mergeRamIntoArgs('-Xms512M -Xmx2G', '', '8G')).toBe('-Xms512M -Xmx8G')
  })

  it('round-trips through parse without drift', () => {
    const args = '-Xms512M -XX:+UseG1GC -Xmx2G'
    const { minRam, maxRam } = parseRamFromArgs(args)
    expect(mergeRamIntoArgs(args, minRam, maxRam)).toBe(args)
  })
})

describe('dirOf and baseOf', () => {
  it.each([
    ['/home/user/server/server.jar', '/home/user/server', 'server.jar'],
    ['C:\\Servers\\smp\\run.bat', 'C:\\Servers\\smp', 'run.bat'],
    ['server.jar', '', 'server.jar'],
  ])('splits %s', (path, dir, base) => {
    expect(dirOf(path)).toBe(dir)
    expect(baseOf(path)).toBe(base)
  })

  it('ignores trailing separators when naming a directory', () => {
    expect(baseOf('/home/user/smp/')).toBe('smp')
    expect(baseOf('C:\\Servers\\smp\\')).toBe('smp')
  })
})

describe('isLaunchScript', () => {
  it.each(['/srv/mc/run.sh', 'C:\\mc\\run.bat', 'run.cmd', '/srv/RUN.SH'])(
    'recognises %s',
    (path) => {
      expect(isLaunchScript(path)).toBe(true)
    },
  )

  it.each(['/srv/mc/server.jar', 'runner.sh', '/srv/mc/prerun.bat', ''])('rejects %s', (path) => {
    expect(isLaunchScript(path)).toBe(false)
  })
})

describe('heapToMB', () => {
  it.each([
    ['2G', 2048],
    ['2g', 2048],
    ['512M', 512],
    ['1536m', 1536],
    ['1048576K', 1024],
    ['1T', 1024 * 1024],
    ['1073741824', 1024],
    [' 4G ', 4096],
  ])('reads %s', (value, mb) => {
    expect(heapToMB(value)).toBe(mb)
  })

  it.each(['', 'G', '2GB', '-2G', '1.5G', 'lots'])('gives null for %j', (value) => {
    expect(heapToMB(value)).toBeNull()
  })
})

describe('formatMB', () => {
  it.each([
    [512, '512 MB'],
    [1024, '1 GB'],
    [15872, '15.5 GB'],
    [16384, '16 GB'],
  ])('writes %d as %s', (mb, text) => {
    expect(formatMB(mb)).toBe(text)
  })
})

describe('heapAdvice', () => {
  const total = 16384

  it('says nothing below 85 percent', () => {
    expect(heapAdvice('13G', total)).toBeNull() // 81%
    expect(heapAdvice('2G', total)).toBeNull()
  })

  it('warns from 85 percent, naming both numbers', () => {
    const advice = heapAdvice('14G', total) // 87.5%
    expect(advice?.level).toBe('warning')
    expect(advice?.message).toContain('14 GB')
    expect(advice?.message).toContain('16 GB')
    expect(advice?.message).toContain('88%')
  })

  it('treats exactly 85 percent as a warning', () => {
    expect(heapAdvice('17000M', 20000)?.level).toBe('warning')
    expect(heapAdvice('16999M', 20000)).toBeNull()
  })

  it('warns strongly from 95 percent, and above all of it', () => {
    expect(heapAdvice('15616M', total)?.level).toBe('strong') // 95.3%
    expect(heapAdvice('15G', total)?.level).toBe('warning') // 93.75%
    expect(heapAdvice('32G', total)?.level).toBe('strong')
  })

  it('stays quiet when it cannot compare', () => {
    expect(heapAdvice('', total)).toBeNull()
    expect(heapAdvice('nonsense', total)).toBeNull()
    expect(heapAdvice('15G', null)).toBeNull()
    expect(heapAdvice('15G', 0)).toBeNull()
  })
})
