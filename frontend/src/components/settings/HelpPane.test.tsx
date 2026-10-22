import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import * as App from '../../../wailsjs/go/main/App'
import * as Runtime from '../../../wailsjs/runtime/runtime'
import { DOCS_URL } from '../../lib/docs'
import { bugReportUrl } from '../../lib/bugReport'
import { HelpPane } from './HelpPane'

vi.mock('../../../wailsjs/go/main/App')
vi.mock('../../../wailsjs/runtime/runtime')

afterEach(cleanup)

const button = (row: string) =>
  screen.getByText(row).closest('div')!.parentElement!.querySelector('button')!

describe('HelpPane', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
  })

  it('opens the docs', () => {
    render(<HelpPane version="v0.3.0" />)
    fireEvent.click(button('Docs'))
    expect(Runtime.BrowserOpenURL).toHaveBeenCalledWith(DOCS_URL)
  })

  it('opens the bug form with the version filled in', () => {
    render(<HelpPane version="v0.3.0" />)
    fireEvent.click(button('Report an issue'))
    expect(Runtime.BrowserOpenURL).toHaveBeenCalledWith(bugReportUrl('v0.3.0'))
  })

  it('copies the end of the log', async () => {
    vi.mocked(App.GetLogTail).mockResolvedValue('line one\n')
    render(<HelpPane version={null} />)
    await act(async () => {
      fireEvent.click(button('Konnekt log'))
    })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('line one\n')
    expect(screen.getByText('Copied')).toBeTruthy()
  })

  it('says why when the log cannot be read', async () => {
    vi.mocked(App.GetLogTail).mockRejectedValue(new Error('open log: permission denied'))
    render(<HelpPane version={null} />)
    await act(async () => {
      fireEvent.click(button('Konnekt log'))
    })
    expect(screen.getByText(/permission denied/)).toBeTruthy()
  })
})
