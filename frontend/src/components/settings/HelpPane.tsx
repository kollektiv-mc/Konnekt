import { useState } from 'react'
import { GetLogTail } from '../../../wailsjs/go/main/App'
import { BrowserOpenURL } from '../../../wailsjs/runtime/runtime'
import { bugReportUrl } from '../../lib/bugReport'
import { DOCS_URL } from '../../lib/docs'
import { isRemoteBrowser } from '../../lib/ipc'
import { SettingRow } from '../ui/SettingRow'
import { CopyButton } from './CopyButton'
import { QUIET_BUTTON } from './controls'

function open(url: string) {
  try {
    BrowserOpenURL(url)
  } catch {
    /* non-Wails context */
  }
}

export function HelpPane({ version }: { version: string | null }) {
  const [copyError, setCopyError] = useState<string | null>(null)

  return (
    <div className="flex flex-col">
      <SettingRow label="Docs">
        <button onClick={() => open(DOCS_URL)} className={QUIET_BUTTON}>
          Open
        </button>
      </SettingRow>
      <SettingRow label="Report an issue">
        <button onClick={() => open(bugReportUrl(version))} className={QUIET_BUTTON}>
          Open
        </button>
      </SettingRow>
      {/* GetLogTail is desktop-only: the log names remote callers. */}
      {!isRemoteBrowser() && (
        <SettingRow label="Konnekt log" note={copyError ?? undefined}>
          <CopyButton text={GetLogTail} onResult={setCopyError} />
        </SettingRow>
      )}
    </div>
  )
}
