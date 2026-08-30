import { useEffect, useRef, useState } from 'react'
import { DetectServerLoader } from '../../../wailsjs/go/main/App'
import { useServerConfigStore } from '../../stores/useServerConfigStore'
import { PLUGIN_LOADERS } from '../../lib/constants'
import { readOr } from '../../lib/ipc'

/**
 * Whether this server takes mods or plugins, detecting the loader once if the
 * saved config does not name one.
 *
 * Its own module because the tile root and the Overview roll-up's summary card
 * both need it. `detected` is a per-instance ref, so two mounted consumers can
 * each fire detection once; `saveConfig` is idempotent and the second write
 * lands on the same value.
 */
export function useServerKind(serverId: string): { kind: 'mods' | 'plugins'; detecting: boolean } {
  const config = useServerConfigStore((s) => s.configs.find((c) => c.id === serverId))
  const saveConfig = useServerConfigStore((s) => s.saveConfig)
  const [detecting, setDetecting] = useState(false)
  const detected = useRef(false)

  useEffect(() => {
    if (detected.current) return
    if (!config) return
    // A NeoForge/Forge install has no jar path — detection falls back to the
    // working dir's logs, so gate on having neither rather than on the jar.
    if (config.loader || (!config.jarPath && !config.workingDir)) return

    detected.current = true
    setDetecting(true)
    readOr(() => DetectServerLoader(serverId), null)
      .then((cfg) => {
        if (cfg) saveConfig(cfg)
      })
      .finally(() => setDetecting(false))
  }, [serverId, config, saveConfig])

  const kind = (PLUGIN_LOADERS as readonly string[]).includes(config?.loader ?? '')
    ? 'plugins'
    : 'mods'
  return { kind, detecting }
}
