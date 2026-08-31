import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { models } from '../../../wailsjs/go/models'
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

// The z-index a node declares, read off its class list. jsdom computes no
// layout and Tailwind's classes never reach it as CSS, so the declared value is
// the only thing there is to compare — which is exactly the axis the bug was
// on, so it is the right thing to pin.
function declaredZ(el: Element | null): number {
  const found = /(?:^|\s)z-(?:\[(\d+)\]|(\d+))(?:\s|$)/.exec(el?.className ?? '')
  if (!found) throw new Error(`no z-index class on ${el?.className ?? 'a missing element'}`)
  return Number(found[1] ?? found[2])
}

describe('ModPreviewDialog', () => {
  // The bug: the dependency dialog was z-50 and this one is z-[400]/z-[401], so
  // confirming a switch that needed a dependency mounted the confirm dialog
  // *under* this dialog's backdrop. All the user saw was the page dimming a
  // second time, and the next click landed on the backdrop and closed
  // everything — a version switch that silently could not be made.
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
})
