import { useState, useCallback } from 'react'

export function usePopover() {
  const [open, setOpen] = useState(false)
  const toggle = useCallback(() => setOpen((v) => !v), [])
  const close = useCallback(() => setOpen(false), [])
  return { open, toggle, close }
}
