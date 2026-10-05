import { describe, expect, it } from 'vitest'
import { releaseUrlToOpen } from './releaseUrl'

describe('releaseUrlToOpen', () => {
  it.each([
    'https://github.com/kollektiv-mc/Konnekt/releases/tag/v0.2.0',
    'https://github.com/kollektiv-mc/Konnekt/releases/download/v0.2.0/konnekt.rpm',
    'https://GitHub.com/kollektiv-mc/Konnekt/releases',
    'https://github.com:443/kollektiv-mc/Konnekt/releases',
  ])('allows %s', (url) => {
    expect(releaseUrlToOpen(url)).toBe(new URL(url).href)
  })

  it.each([
    '',
    'not a url',
    'http://github.com/kollektiv-mc/Konnekt/releases',
    'smb://github.com/kollektiv-mc/Konnekt/releases',
    'javascript:alert(1)//github.com/kollektiv-mc/Konnekt/',
    'https://example.com/kollektiv-mc/Konnekt/releases',
    'https://github.com.evil.example/kollektiv-mc/Konnekt/',
    'https://evilgithub.com/kollektiv-mc/Konnekt/',
    'https://github.com@evil.example/kollektiv-mc/Konnekt/',
    'https://github.com:8443@evil.example/kollektiv-mc/Konnekt/',
    'https://user@github.com/kollektiv-mc/Konnekt/releases',
    'https://github.com:8443/kollektiv-mc/Konnekt/releases',
    'https://github.com/kollektiv-mc/Konnekt-evil/releases',
    'https://github.com/kollektiv-mc/Konnekt',
    'https://github.com/other/Konnekt/releases',
    'https://github.com/kollektiv-mc/Konnekt/../../evil/repo',
    'https://github.com/kollektiv-mc/konnekt/releases',
  ])('refuses %s', (url) => {
    expect(releaseUrlToOpen(url)).toBeNull()
  })
})
