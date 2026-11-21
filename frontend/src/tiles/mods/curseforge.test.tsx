import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  render,
  renderHook,
  waitFor,
  act,
  cleanup,
  fireEvent,
  within,
} from '@testing-library/react'
import * as App from '../../../wailsjs/go/main/App'
import * as Runtime from '../../../wailsjs/runtime/runtime'
import { models } from '../../../wailsjs/go/models'
import { isManualDownloadError, useMods } from './useMods'
import { ContentCard } from './ContentCard'
import { DependencyDialog } from './DependencyDialog'

vi.mock('../../../wailsjs/go/main/App')
vi.mock('../../../wailsjs/runtime/runtime')

afterEach(cleanup)

const PAGE = 'https://www.curseforge.com/minecraft/mc-mods/create/files/11'

function version(over: Partial<models.ModVersion>) {
  return models.ModVersion.createFrom({
    id: 'cf:11',
    projectId: 'cf:1',
    versionNumber: 'create-6.0.0',
    fileUrl: 'https://edge.forgecdn.net/files/11/create.jar',
    pageUrl: PAGE,
    gameVersions: [],
    loaders: [],
    dependencies: [],
    ...over,
  })
}

function mockBackend(status = { keySet: true, builtIn: false }) {
  vi.mocked(App.ModListInstalled).mockResolvedValue([])
  vi.mocked(App.ModCheckUpdates).mockResolvedValue([])
  vi.mocked(App.ModCategories).mockResolvedValue([])
  vi.mocked(App.ModRescan).mockResolvedValue(undefined)
  vi.mocked(App.ModCurseForgeStatus).mockResolvedValue(models.CurseForgeStatus.createFrom(status))
  vi.mocked(App.ModSearch).mockResolvedValue(
    models.ModSearchResult.createFrom({ hits: [], total: 0, offset: 0 }),
  )
}

describe('useMods sources', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBackend()
  })

  it('searches the source the panel picked', async () => {
    const { result } = renderHook(() => useMods('srv1'))
    act(() => result.current.setSource('curseforge'))
    await act(() => result.current.search('create', [], 0, ''))
    expect(App.ModSearch).toHaveBeenLastCalledWith('srv1', 'create', 0, [], '', 'curseforge')
  })

  it('reads whether CurseForge has a key, and again when that changes', async () => {
    let onChange: (() => void) | undefined
    vi.mocked(Runtime.EventsOn).mockImplementation((name, cb) => {
      if (name === 'mod:sources-changed') onChange = cb as () => void
      return () => {}
    })
    const { result } = renderHook(() => useMods('srv1'))
    await waitFor(() => expect(result.current.curseForge?.keySet).toBe(true))

    vi.mocked(App.ModCurseForgeStatus).mockResolvedValue(
      models.CurseForgeStatus.createFrom({ keySet: false, builtIn: false }),
    )
    act(() => onChange?.())
    await waitFor(() => expect(result.current.curseForge?.keySet).toBe(false))
  })

  it('does not ask CurseForge for categories without a key', async () => {
    mockBackend({ keySet: false, builtIn: false })
    const { result } = renderHook(() => useMods('srv1'))
    await waitFor(() => expect(result.current.curseForge).not.toBeNull())
    act(() => result.current.setSource('curseforge'))
    await waitFor(() => expect(App.ModCategories).toHaveBeenCalledTimes(1))
    expect(App.ModCategories).toHaveBeenCalledWith('srv1', 'modrinth')
  })

  // The newest file being one the author keeps on CurseForge is not an error:
  // it is the page to send the user to.
  it('hands back the page when the newest file is download-by-hand', async () => {
    vi.mocked(App.ModGetVersions).mockResolvedValue([version({ fileUrl: '' })])
    const { result } = renderHook(() => useMods('srv1'))

    let thrown: unknown
    await act(async () => {
      try {
        await result.current.installLatest('cf:1')
      } catch (e) {
        thrown = e
      }
    })
    expect(isManualDownloadError(thrown) && thrown.pageUrl).toBe(PAGE)
    expect(result.current.installError).toBeNull()
    expect(App.ModInstall).not.toHaveBeenCalled()
  })
})

describe('ContentCard for a download-by-hand project', () => {
  beforeEach(() => vi.clearAllMocks())

  it('opens the CurseForge page instead of installing', () => {
    const onInstallLatest = vi.fn()
    const { getByRole } = render(
      <ContentCard
        project={models.ModProject.createFrom({
          id: 'cf:1',
          title: 'Create',
          categories: [],
          manualDownload: true,
          pageUrl: 'https://www.curseforge.com/minecraft/mc-mods/create',
        })}
        onClick={vi.fn()}
        onInstallLatest={onInstallLatest}
        onInstall={vi.fn()}
      />,
    )
    fireEvent.click(getByRole('button', { name: /Download on CurseForge/ }))
    expect(Runtime.BrowserOpenURL).toHaveBeenCalledWith(
      'https://www.curseforge.com/minecraft/mc-mods/create',
    )
    expect(onInstallLatest).not.toHaveBeenCalled()
  })
})

describe('DependencyDialog with a download-by-hand dependency', () => {
  it('links it and leaves it out of the install', () => {
    const onConfirm = vi.fn()
    const deps = [
      models.ResolvedDependency.createFrom({
        projectId: 'cf:7',
        projectTitle: 'Flywheel',
        required: true,
        alreadyInstalled: false,
        version: version({ id: 'cf:21', fileUrl: '' }),
      }),
      models.ResolvedDependency.createFrom({
        projectId: 'cf:8',
        projectTitle: 'Ponder',
        required: true,
        alreadyInstalled: false,
        version: version({ id: 'cf:22' }),
      }),
    ]
    const { getByText, getByRole } = render(
      <DependencyDialog
        primaryVersionId="cf:11"
        dependencies={deps}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )
    const row = getByText('Flywheel').closest('div')?.parentElement as HTMLElement
    expect(within(row).getByRole('button', { name: /Download/ })).toBeTruthy()
    expect(within(row).queryByRole('checkbox')).toBeNull()

    fireEvent.click(getByRole('button', { name: 'Install' }))
    expect(onConfirm).toHaveBeenCalledWith(['cf:11', 'cf:22'])
  })
})
