import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { models } from '../../../wailsjs/go/models'
import { LAYER, declaredLayer } from '../../lib/layers'
import { ModPreviewDialog } from './ModPreviewDialog'

vi.mock('../../../wailsjs/runtime/runtime')

afterEach(cleanup)

const mod = models.InstalledMod.createFrom({
  fileName: 'EssentialsX-2.21.0.jar',
  displayName: 'EssentialsX',
  source: 'modrinth',
  projectId: 'ess',
  versionId: 'ver1',
  versionNumber: '2.21.0',
  targetFolder: 'plugins',
  enabled: true,
  sizeBytes: 1024,
})

const versions = [
  models.ModVersion.createFrom({
    id: 'ver2',
    projectId: 'ess',
    versionNumber: '2.22.0',
    versionType: 'release',
    gameVersions: ['1.21.1'],
  }),
]

function renderDialog(props: Partial<Parameters<typeof ModPreviewDialog>[0]> = {}) {
  return render(
    <ModPreviewDialog
      mod={mod}
      project={null}
      projectLoading={false}
      versions={versions}
      versionsLoading={false}
      installing={false}
      installError={null}
      onClose={vi.fn()}
      onGetVersions={vi.fn()}
      onGetAllVersions={vi.fn()}
      onResolveDeps={vi.fn().mockResolvedValue([])}
      onInstall={vi.fn().mockResolvedValue(undefined)}
      onChangeVersion={vi.fn().mockResolvedValue(undefined)}
      onOpenInBrowser={vi.fn()}
      {...props}
    />,
  )
}

// The layer a node declares, read off its class list and resolved through
// lib/layers.ts. jsdom computes no layout and Tailwind's classes never reach it
// as CSS, so the declared value is the only thing there is to compare — which
// is exactly the axis the bug was on, so it is the right thing to pin. A bare
// number is not accepted on purpose: a surface that regresses to a literal has
// left the scale, and that should fail here rather than be compared.
function declaredZ(el: Element | null): number {
  const layer = declaredLayer(el?.className ?? '')
  if (!layer) throw new Error(`no z-<layer> class on ${el?.className || 'a missing element'}`)
  return LAYER[layer]
}

describe('ModPreviewDialog', () => {
  // The bug behind #257: opened from the compact InstalledPanel, this 600px
  // dialog rendered inline in a grid tile that react-grid-layout transforms,
  // and a transformed ancestor is the containing block for `fixed`, so it was
  // clamped to the tile's box. The portal is what gets it out; the layer
  // assertions below are what keep it ordered once it is there.
  it('renders outside the tile that opened it', () => {
    const { container, getByText } = renderDialog()
    const panel = getByText('EssentialsX').closest('.fixed')
    expect(panel).not.toBeNull()
    expect(container.contains(panel)).toBe(false)
  })

  // The bug: the dependency dialog was z-50 and this one was z-[400]/z-[401],
  // so confirming a switch that needed a dependency mounted the confirm dialog
  // *under* this dialog's backdrop. All the user saw was the page dimming a
  // second time, and the next click landed on the backdrop and closed
  // everything — a version switch that silently could not be made. Now the
  // pair is z-dialog over z-modal, and this pins that the scale still says so.
  it('opens the dependency dialog above itself', async () => {
    const { getByText, findByText } = renderDialog({
      onResolveDeps: vi.fn().mockResolvedValue([
        {
          projectId: 'vault',
          projectTitle: 'Vault',
          version: models.ModVersion.createFrom({ id: 'vault-1', versionNumber: '1.7.3' }),
          required: true,
          alreadyInstalled: false,
        },
      ]),
    })

    fireEvent.click(getByText('versions'))
    fireEvent.click(getByText('Switch'))

    const depDialog = (await findByText('Dependencies')).closest('.fixed')
    const previewPanel = getByText('EssentialsX').closest('.fixed')
    expect(declaredZ(depDialog)).toBeGreaterThan(declaredZ(previewPanel))
  })

  // Switching to a client-only version needs a yes even with no dependency to
  // pick, and the switch must not start until it is given.
  it('asks before switching to a client-only version', async () => {
    const onChangeVersion = vi.fn().mockResolvedValue(undefined)
    const { getByText, findByText } = renderDialog({
      versions: [models.ModVersion.createFrom({ ...versions[0], clientOnly: true })],
      onChangeVersion,
    })

    fireEvent.click(getByText('versions'))
    expect(getByText('client only')).toBeTruthy()
    fireEvent.click(getByText('Switch'))

    expect(await findByText('Client-only mod')).toBeTruthy()
    expect(getByText('Install anyway')).toBeTruthy()
    expect(onChangeVersion).not.toHaveBeenCalled()
  })

  // The other half of the same silence: a dependency check that cannot reach
  // Modrinth leaves the version list empty, and the error used to render only
  // inside the branch that draws that list.
  it('shows why nothing happened even with no versions to list', () => {
    const { getByText } = renderDialog({
      versions: [],
      installError: 'modrinth: HTTP 429',
    })

    fireEvent.click(getByText('versions'))
    expect(getByText('modrinth: HTTP 429')).toBeTruthy()
  })

  // A jar that is one of a release's extra files (an EssentialsX module) has a
  // project but no version of its own, so every Switch button is withheld. An
  // unexplained list of versions with no buttons reads as a broken dialog.
  it('says why a file with no version of its own cannot be switched', async () => {
    const { getByText, queryByText } = renderDialog({
      mod: models.InstalledMod.createFrom({ ...mod, versionId: '' }),
    })

    fireEvent.click(getByText('versions'))
    await waitFor(() => expect(getByText(/no version to switch it to/)).toBeTruthy())
    expect(queryByText('Switch')).toBeNull()
  })

  // #473: the confirm used to close the dependency dialog first and await the
  // install with no catch, so a refused install (admin tier through Remote
  // Access) was an unhandled rejection with nothing on screen. The dependency
  // dialog is above this one, so the message has to be in it.
  it('keeps the dependency dialog open and says why a confirmed install failed', async () => {
    const onInstall = vi.fn().mockRejectedValue('install refused: nobody answered on the desktop')
    const onClose = vi.fn()
    const { getByText, findByText, findByRole } = renderDialog({
      versions: [models.ModVersion.createFrom({ ...versions[0], clientOnly: true })],
      onInstall,
      onClose,
    })

    fireEvent.click(getByText('versions'))
    fireEvent.click(getByText('Switch'))
    fireEvent.click(await findByText('Install anyway'))

    const alert = await findByRole('alert')
    expect(alert.textContent).toBe('install refused: nobody answered on the desktop')
    expect(onInstall).toHaveBeenCalledWith(['ver2'])
    expect(getByText('Client-only mod')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()

    // Retryable from the same dialog, and a success closes both.
    onInstall.mockResolvedValueOnce(undefined)
    fireEvent.click(getByText('Install anyway'))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })
})
