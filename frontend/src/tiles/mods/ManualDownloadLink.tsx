import { Tooltip } from '../../components/ui/Tooltip'
import { MANUAL_DOWNLOAD_REASON, openPage } from './manualDownload'

interface Props {
  url: string
  label?: string
  className?: string
}

export function ManualDownloadLink({
  url,
  label = 'Download on CurseForge',
  className = '',
}: Props) {
  return (
    <Tooltip text={MANUAL_DOWNLOAD_REASON}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          openPage(url)
        }}
        className={`text-accent text-xs underline-offset-2 hover:underline ${className}`}
      >
        {label} ↗
      </button>
    </Tooltip>
  )
}
