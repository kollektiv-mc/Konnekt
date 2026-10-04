import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { models } from '../../../wailsjs/go/models'
import { ContentDetailPanel } from './ContentDetailPanel'
import { ConfirmInstallError } from './useMods'

vi.mock('../../../wailsjs/runtime/runtime')

afterEach(cleanup)

const project = models.ModProject.createFrom({
  id: 'sodium',
  slug: 'sodium',
  title: 'Sodium',
  description: 'A rendering engine',
  author: 'jellysquid',
  downloads: 10,
  follows: 2,
  categories: [],
  gallery: [],
})

const versions = [
  models.ModVersion.createFrom({
    id: 'ver2',
    projectId: 'sodium',
    versionNumber: '0.6.0',
    versionType: 'release',
    gameVersions: ['1.21.1'],
  }),
]

function renderPanel(props: Partial<Parameters<typeof ContentDetailPanel>[0]> = {}) {
  return render(
    <ContentDetailPanel
      project={project}
      projectLoading={false}
      versions={versions}
      versionsLoading={false}
      installing={false}
      installError={null}
      moreByAuthorProjects={[]}
      onGetVersions={vi.fn()}
      onGetAllVersions={vi.fn()}
      onResolveDeps={vi.fn().mockResolvedValue([])}
      onInstall={vi.fn().mockResolvedValue(undefined)}
      onInstallLatest={vi.fn().mockResolvedValue(undefined)}
      onClose={vi.fn()}
      onSelectProject={vi.fn()}
      {...props}
    />,
  )
}

// #473: the version row called `void onInstall([v.id])` and the dependency
// confirm awaited with no catch, so a refused install was an unhandled
// rejection with nothing on screen.
describe('ContentDetailPanel install failures', () => {
  it('shows a failed version-row install in the panel', async () => {
    const onInstall = vi.fn().mockRejectedValue('install refused: nobody answered')
    const { getByText, findByRole } = renderPanel({ onInstall })

    fireEvent.click(getByText('versions'))
    // The row's own button; the panel's Install button is the other one.
    fireEvent.click(getByText('0.6.0').closest('div.flex.items-start')!.querySelector('button')!)

    const alert = await findByRole('alert')
    expect(alert.textContent).toBe('install refused: nobody answered')
    expect(onInstall).toHaveBeenCalledWith(['ver2'])
  })

  it('shows a failed Install of the latest version in the panel', async () => {
    const onInstallLatest = vi.fn().mockRejectedValue(new Error('No compatible version found'))
    const { getByText, findByRole } = renderPanel({ onInstallLatest })

    fireEvent.click(getByText('Install'))

    expect((await findByRole('alert')).textContent).toBe('No compatible version found')
  })

  it('keeps the dependency dialog open and says why a confirmed install failed', async () => {
    const onInstallLatest = vi.fn().mockRejectedValue(new ConfirmInstallError([], 'ver9', true))
    const onInstall = vi.fn().mockRejectedValue(new Error('install refused: desktop said no'))
    const { getByText, findByText, findAllByRole } = renderPanel({ onInstallLatest, onInstall })

    fireEvent.click(getByText('Install'))
    fireEvent.click(await findByText('Install anyway'))

    const alerts = await findAllByRole('alert')
    expect(alerts.map((a) => a.textContent)).toContain('install refused: desktop said no')
    expect(onInstall).toHaveBeenCalledWith(['ver9'])
    expect(getByText('Client-only mod')).toBeTruthy()

    onInstall.mockResolvedValueOnce(undefined)
    fireEvent.click(getByText('Install anyway'))
    await waitFor(() => expect(document.body.textContent).not.toContain('Client-only mod'))
  })
})
