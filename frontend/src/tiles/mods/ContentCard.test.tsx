import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { models } from '../../../wailsjs/go/models'
import { ContentCard } from './ContentCard'
import { ConfirmInstallError } from './useMods'

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
})

function renderCard(props: Partial<Parameters<typeof ContentCard>[0]> = {}) {
  return render(
    <ContentCard
      project={project}
      onClick={vi.fn()}
      onInstallLatest={vi.fn().mockResolvedValue(undefined)}
      onInstall={vi.fn().mockResolvedValue(undefined)}
      {...props}
    />,
  )
}

// #473: a failed quick install used to be swallowed unless it was the confirm
// signal, and the hook's installError renders only in the detail panel.
describe('ContentCard install failures', () => {
  it('shows a failed quick install on the card itself', async () => {
    const onInstallLatest = vi.fn().mockRejectedValue('install refused: nobody answered')
    const { getByTitle, findByRole, getByText } = renderCard({ onInstallLatest })

    fireEvent.click(getByTitle('Install latest version'))

    const alert = await findByRole('alert')
    expect(alert.textContent).toBe('install refused: nobody answered')
    // The card is still there to retry from, with its button free again.
    expect(getByText('Sodium')).toBeTruthy()
    await waitFor(() =>
      expect(getByTitle('Install latest version').hasAttribute('disabled')).toBe(false),
    )
  })

  it('clears the message when the install is tried again', async () => {
    const onInstallLatest = vi.fn().mockRejectedValueOnce(new Error('boom'))
    const { getByTitle, findByRole, queryByRole } = renderCard({ onInstallLatest })

    fireEvent.click(getByTitle('Install latest version'))
    expect((await findByRole('alert')).textContent).toBe('boom')

    onInstallLatest.mockResolvedValueOnce(undefined)
    fireEvent.click(getByTitle('Install latest version'))
    await waitFor(() => expect(queryByRole('alert')).toBeNull())
  })

  it('keeps the dependency dialog open and says why a confirmed install failed', async () => {
    const onInstallLatest = vi.fn().mockRejectedValue(new ConfirmInstallError([], 'ver9', true))
    const onInstall = vi.fn().mockRejectedValue(new Error('install refused: desktop said no'))
    const { getByTitle, findByText, findByRole, getByText } = renderCard({
      onInstallLatest,
      onInstall,
    })

    fireEvent.click(getByTitle('Install latest version'))
    fireEvent.click(await findByText('Install anyway'))

    const alert = await findByRole('alert')
    expect(alert.textContent).toBe('install refused: desktop said no')
    expect(onInstall).toHaveBeenCalledWith(['ver9'])
    expect(getByText('Client-only mod')).toBeTruthy()

    // Retry from the same dialog; success closes it.
    onInstall.mockResolvedValueOnce(undefined)
    fireEvent.click(getByText('Install anyway'))
    await waitFor(() => expect(document.body.textContent).not.toContain('Client-only mod'))
  })
})
