import { useState } from 'react'
import { BrowserOpenURL } from '../../wailsjs/runtime/runtime'
import { AcceptEula, StartServer } from '../../wailsjs/go/main/App'

const MINECRAFT_EULA_URL = 'https://aka.ms/MinecraftEULA'

interface Props {
  serverId: string
  onClose: () => void
}

export function EulaModal({ serverId, onClose }: Props) {
  const [loading, setLoading] = useState(false)

  const openEula = () => {
    try {
      BrowserOpenURL(MINECRAFT_EULA_URL)
    } catch {
      /* non-Wails context */
    }
  }

  const handleAccept = async () => {
    setLoading(true)
    try {
      await AcceptEula(serverId)
      await StartServer(serverId)
    } catch (err) {
      console.error('Failed to accept EULA or restart server:', err)
    } finally {
      setLoading(false)
      onClose()
    }
  }

  return (
    <div className="z-modal fixed inset-0 flex items-center justify-center bg-black/60">
      <div className="bg-canvas border-hairline flex w-80 flex-col gap-4 rounded-xl border-amber-400/25 p-5 font-mono">
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-bold text-yellow-400">[!]</span>
          <span className="font-title text-text-primary text-sm font-medium">EULA Required</span>
        </div>

        <p className="text-text-secondary text-xs leading-relaxed">
          The Minecraft server requires you to accept the End User License Agreement before it can
          run.
        </p>

        <button
          onClick={openEula}
          className="text-left text-xs text-yellow-400/70 transition-colors hover:text-yellow-400"
        >
          Read the Minecraft EULA →
        </button>

        <div className="border-border-subtle border-t-hairline flex gap-2 pt-1">
          <button
            onClick={handleAccept}
            disabled={loading}
            className="text-accent border-accent/30 border-hairline flex-1 rounded py-1.5 text-xs transition-colors disabled:opacity-40"
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.background =
                'rgb(var(--accent-rgb) / 0.1)'
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
            }}
          >
            {loading ? 'Starting…' : 'Accept & Restart'}
          </button>
          <button
            onClick={onClose}
            disabled={loading}
            className="text-text-faint px-3 py-1.5 text-xs transition-colors disabled:opacity-40"
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-faint)'
            }}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}
