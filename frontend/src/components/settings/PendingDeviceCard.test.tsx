import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { PendingDeviceCard } from './PendingDeviceCard'
import type { RemotePendingDevice } from '../../stores/useRemoteStore'

afterEach(cleanup)

// What the user approves a device on, so it is shown whole and wraps.
describe('PendingDeviceCard user agent', () => {
  it('renders the whole string without truncating it', () => {
    const userAgent = `Mozilla/5.0 (X11; Linux x86_64) ${'AppleWebKit/537.36 '.repeat(8)}Chrome/130.0`
    const request = { code: 'ABC-123', userAgent } as unknown as RemotePendingDevice
    render(
      <PendingDeviceCard request={request} onApprove={async () => {}} onDeny={async () => {}} />,
    )
    const line = screen.getByText(userAgent)
    expect(line.className).not.toContain('truncate')
    expect(line.className).toContain('break-words')
  })
})
