import { useState, useCallback, useRef } from 'react'
import { ListConfigFiles, ReadConfigFile, WriteConfigFile } from '../../../wailsjs/go/main/App'
import type { ConfigFile } from '../../types'

export function useConfigEditor(serverId: string) {
  const [files, setFiles] = useState<ConfigFile[]>([])
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [listError, setListError] = useState<string | null>(null)

  const [selectedRelPath, setSelectedRelPathRaw] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [originalContent, setOriginalContent] = useState('')
  const [loadingContent, setLoadingContent] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const isDirty = content !== originalContent
  const selectedFile = files.find((f) => f.relPath === selectedRelPath) ?? null

  // Track last loaded path to avoid stale set after fast switching
  const loadingFor = useRef<string | null>(null)

  const refresh = useCallback(async () => {
    setLoadingFiles(true)
    setListError(null)
    try {
      const result = await ListConfigFiles(serverId)
      setFiles((result as ConfigFile[]) ?? [])
    } catch (e) {
      setListError(String(e))
    } finally {
      setLoadingFiles(false)
    }
  }, [serverId])

  const selectFile = useCallback(
    async (relPath: string) => {
      if (relPath === selectedRelPath) return
      setSelectedRelPathRaw(relPath)
      setSaveError(null)
      setLoadingContent(true)
      loadingFor.current = relPath
      try {
        const text = await ReadConfigFile(serverId, relPath)
        if (loadingFor.current !== relPath) return // switched away
        setContent(text)
        setOriginalContent(text)
      } catch (e) {
        if (loadingFor.current !== relPath) return
        setContent('')
        setOriginalContent('')
        setSaveError(String(e))
      } finally {
        if (loadingFor.current === relPath) setLoadingContent(false)
      }
    },
    [serverId, selectedRelPath],
  )

  const save = useCallback(async () => {
    if (!selectedRelPath || !isDirty) return
    setSaving(true)
    setSaveError(null)
    try {
      await WriteConfigFile(serverId, selectedRelPath, content)
      setOriginalContent(content)
    } catch (e) {
      setSaveError(String(e))
    } finally {
      setSaving(false)
    }
  }, [serverId, selectedRelPath, content, isDirty])

  const revert = useCallback(() => {
    setContent(originalContent)
    setSaveError(null)
  }, [originalContent])

  return {
    files,
    loadingFiles,
    listError,
    refresh,
    selectedFile,
    selectedRelPath,
    selectFile,
    content,
    setContent,
    isDirty,
    loadingContent,
    saving,
    saveError,
    save,
    revert,
  }
}
