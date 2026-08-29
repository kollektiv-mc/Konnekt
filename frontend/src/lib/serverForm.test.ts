import { describe, it, expect } from 'vitest'
import { parseRamFromArgs, mergeRamIntoArgs, dirOf, baseOf, isLaunchScript } from './serverForm'

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
