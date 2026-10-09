import { useEffect, useState } from 'react'
import { Environment } from '../../../wailsjs/runtime/runtime'
import { readOr } from '../../lib/ipc'
import type { WebviewGpu } from '../../types'
import { Segmented } from '../ui/Segmented'
import { SettingRow } from '../ui/SettingRow'

const OPTIONS: { value: Exclude<WebviewGpu, ''>; label: string }[] = [
  { value: 'always', label: 'On' },
  { value: 'ondemand', label: 'On demand' },
  { value: 'never', label: 'Off' },
]

/**
 * The Linux webview's hardware acceleration policy (#421). Go reads it once,
 * before the window is created, so a change applies on the next launch and the
 * row says so. Shown on Linux only: Wails ignores the policy everywhere else,
 * and a browser served by Remote Access reports `web`, which hides it there too.
 * An empty value is "never chosen" and resolves to On, the same as Go's
 * resolver in webviewgpu.go.
 */
export function WebviewGpuSetting({
  value,
  onChange,
}: {
  value: WebviewGpu
  onChange: (v: WebviewGpu) => void
}) {
  const [linux, setLinux] = useState(false)
  useEffect(() => {
    let live = true
    // readOr: with no Wails runtime the call throws before a promise exists.
    void readOr(() => Environment(), null).then((env) => {
      if (live) setLinux(env?.platform === 'linux')
    })
    return () => {
      live = false
    }
  }, [])

  if (!linux) return null
  return (
    <SettingRow
      label="Hardware acceleration"
      description="Turn it down if the window flickers, tears or runs the GPU hot. Applies the next time Konnekt starts."
    >
      <Segmented options={OPTIONS} value={value || 'always'} onChange={onChange} />
    </SettingRow>
  )
}
