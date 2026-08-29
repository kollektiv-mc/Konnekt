import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import * as runtime from '../../../wailsjs/runtime/runtime'
import { ModAboutBody } from './ModAboutBody'

vi.mock('../../../wailsjs/runtime/runtime')

// The markdown renderer is a lazy chunk (see ModAboutBody.tsx), so every
// assertion here waits for the Suspense boundary to resolve rather than
// reading the first synchronous render.
describe('ModAboutBody', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens http(s) links in the system browser instead of navigating the webview', async () => {
    const { findByText } = render(
      <ModAboutBody
        body="See the [Folia docs](https://docs.papermc.io/paper/folia) for details."
        description=""
        loading={false}
      />,
    )
    const link = await findByText('Folia docs')
    const event = fireEvent.click(link)

    expect(runtime.BrowserOpenURL).toHaveBeenCalledWith('https://docs.papermc.io/paper/folia')
    // fireEvent.click returns false when preventDefault() was called.
    expect(event).toBe(false)
  })

  it('leaves in-page anchors and relative links to default browser behavior', async () => {
    const { findByText } = render(
      <ModAboutBody
        body="Jump to [installation](#installation) or see [changelog](./CHANGELOG.md)."
        description=""
        loading={false}
      />,
    )

    const anchorLink = await findByText('installation')
    const anchorEvent = fireEvent.click(anchorLink)
    expect(runtime.BrowserOpenURL).not.toHaveBeenCalled()
    expect(anchorEvent).toBe(true)

    const relativeLink = await findByText('changelog')
    const relativeEvent = fireEvent.click(relativeLink)
    expect(runtime.BrowserOpenURL).not.toHaveBeenCalled()
    expect(relativeEvent).toBe(true)
  })

  it('swallows errors when BrowserOpenURL is unavailable (non-Wails context)', async () => {
    vi.mocked(runtime.BrowserOpenURL).mockImplementation(() => {
      throw new TypeError('window.runtime is undefined')
    })
    const { findByText } = render(
      <ModAboutBody body="See [docs](https://example.com/docs)." description="" loading={false} />,
    )
    const link = await findByText('docs')
    expect(() => fireEvent.click(link)).not.toThrow()
  })
})
