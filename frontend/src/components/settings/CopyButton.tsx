import { useEffect, useRef, useState } from 'react'
import { errMsg } from '../../lib/ipc'
import { QUIET_BUTTON } from './controls'

interface CopyButtonProps {
  /**
   * What to copy, or a function that fetches it when the button is clicked. The
   * second form is for text that must not sit in the page until it is wanted,
   * such as a private link: it is held here only for the length of the copy.
   */
  text: string | (() => Promise<string>)
  /** The button's resting label. */
  label?: string
  /**
   * Told how each click ended: `null` when the text was copied, else why not.
   * Without it a failure is silent, which suits text that is on screen beside
   * the button; fetched text is not, so it needs this.
   */
  onResult?: (error: string | null) => void
}

/**
 * Copies `text` and says so for a moment. A refused clipboard leaves the label
 * alone: whatever was to be copied is on screen beside it, to copy by hand.
 */
export function CopyButton({ text, label = 'Copy', onResult }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
  const [fetching, setFetching] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = async () => {
    let value: string
    if (typeof text === 'function') {
      setFetching(true)
      try {
        value = await text()
      } catch (e) {
        onResult?.(errMsg(e))
        return
      } finally {
        setFetching(false)
      }
    } else {
      value = text
    }
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      onResult?.('The clipboard refused the copy.')
      return
    }
    onResult?.(null)
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button disabled={fetching} onClick={() => void copy()} className={QUIET_BUTTON}>
      {copied ? 'Copied' : label}
    </button>
  )
}
