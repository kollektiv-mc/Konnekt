import { useEffect, useRef, useState } from 'react'
import { QUIET_BUTTON } from './controls'

/**
 * Copies `text` and says so for a moment. A refused clipboard leaves the label
 * alone: whatever was to be copied is on screen beside it, to copy by hand.
 */
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      return
    }
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button onClick={() => void copy()} className={QUIET_BUTTON}>
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}
