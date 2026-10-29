import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { ModsGlance } from './ModsGlance'
import type { InstalledMod } from './useMods'

// Vitest runs with `globals: false`, so RTL cannot register its own auto-cleanup.
afterEach(cleanup)

const mod = (displayName: string, enabled = true): InstalledMod =>
  ({ fileName: `${displayName}.jar`, displayName, enabled, versionNumber: '1.0' }) as InstalledMod

const base = { updates: {}, loading: false, error: null, kind: 'plugins' as const }

describe('ModsGlance', () => {
  it('lists them all by name, the disabled ones too', () => {
    render(
      <ModsGlance
        {...base}
        layout="default"
        mods={[mod('Zeta'), mod('Alpha', false), mod('Beta')]}
      />,
    )
    const names = within(screen.getByRole('list')).getAllByRole('listitem')
    expect(names.map((n) => n.textContent)).toEqual(['Alpha', 'Beta', 'Zeta'])
  })

  it('names a waiting update', () => {
    const updates = {
      'Spark.jar': {
        fileName: 'Spark.jar',
        updateAvailable: true,
        latestVersionId: 'v2',
        latestVersionNumber: '2.0',
      },
    }
    render(<ModsGlance {...base} updates={updates} layout="default" mods={[mod('Spark')]} />)
    expect(screen.getByTitle('Spark: update available')).toBeTruthy()
  })

  it('adds the version only in the detailed layout', () => {
    const { rerender } = render(<ModsGlance {...base} layout="default" mods={[mod('Spark')]} />)
    expect(screen.queryByText('1.0')).toBeNull()
    rerender(<ModsGlance {...base} layout="detailed" mods={[mod('Spark')]} />)
    expect(screen.getByText('1.0')).toBeTruthy()
  })

  it('says when there is nothing installed', () => {
    render(<ModsGlance {...base} layout="default" mods={[]} />)
    expect(screen.getByText(/no plugins installed/)).toBeTruthy()
  })
})
