import { open as dialogOpen } from '@tauri-apps/plugin-dialog'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { toast } from 'sonner'

import { basename } from './attach-menu-path'
import type { AgentSenderHandle } from './agent-sender'
import type { TriggerMatch } from './sender-trigger'
import { savePasteImage } from './paste-image'
import { normalizePath } from '@/features/agent/model/workspace-path'
import type { FilePartData } from '@/features/agent/types'

function matchKey(match: TriggerMatch | null) {
  if (!match) return null
  return `${match.char}:${match.query}:${match.behaviorId}`
}

interface UseComposerAttachOptions {
  value: string
  files: FilePartData[]
  onAttach: (file: FilePartData) => void
  onRemoveFile: (path: string) => void
  senderRef: RefObject<AgentSenderHandle | null>
}

function useComposerAttach(options: UseComposerAttachOptions) {
  const [attachOpen, updateAttachOpen] = useState(false)
  const [triggerMatch, updateTriggerMatch] = useState<TriggerMatch | null>(null)
  const [chipPaths, updateChipPaths] = useState<string[]>([])
  const [canSend, updateCanSend] = useState(false)
  const suppressedTriggerKey = useRef<string | null>(null)
  const chipPathsRef = useRef<string[]>([])

  useEffect(
    function () {
      if (options.value !== '') return
      options.senderRef.current?.clear({ silent: true })
      chipPathsRef.current = []
      suppressedTriggerKey.current = null
    },
    [options.value, options.senderRef]
  )

  const [prevValue, updatePrevValue] = useState(options.value)
  if (prevValue !== options.value) {
    updatePrevValue(options.value)
    if (options.value === '') {
      updateTriggerMatch(null)
      updateChipPaths([])
      updateCanSend(false)
    }
  }

  function syncChipPaths() {
    const paths = options.senderRef.current?.findChipPaths() ?? []
    const pathSet = new Set(paths)
    const prev = chipPathsRef.current
    chipPathsRef.current = paths
    updateChipPaths(paths)
    for (const path of prev) {
      if (pathSet.has(path)) continue
      const attached = options.files.some(function (file) {
        return normalizePath(file.path) === path
      })
      if (attached) options.onRemoveFile(path)
    }
  }

  function handleTriggerChange(match: TriggerMatch | null) {
    const key = matchKey(match)
    if (key && key === suppressedTriggerKey.current) {
      updateTriggerMatch(null)
      return
    }
    if (!key) suppressedTriggerKey.current = null
    updateTriggerMatch(match)
  }

  function handleTriggerClose() {
    suppressedTriggerKey.current = matchKey(triggerMatch)
    updateTriggerMatch(null)
  }

  function insertFileChip(file: FilePartData, relative = '') {
    const path = normalizePath(file.path)
    const relativePath = relative || file.name
    options.senderRef.current?.insertChip({
      kind: 'file',
      label: file.name,
      value: `@${relativePath}`,
      meta: { path, name: file.name, relative: relativePath }
    })
    syncChipPaths()
  }

  function handleAttach(file: FilePartData, relative?: string) {
    const next = { ...file, path: normalizePath(file.path), name: file.name }
    const relativePath = relative ? normalizePath(relative) : ''
    options.onAttach(next)
    updateAttachOpen(false)
    insertFileChip(next, relativePath)
  }

  function handleAttachSkill(file: FilePartData, relative?: string) {
    const path = normalizePath(file.path)
    const relativePath = relative ? normalizePath(relative) : path
    updateAttachOpen(false)
    options.senderRef.current?.insertChip({
      kind: 'skill',
      label: file.name,
      value: `/${file.name}`,
      meta: { path, name: file.name, relative: relativePath }
    })
    syncChipPaths()
  }

  async function handlePickFiles() {
    const selected = await dialogOpen({
      multiple: true,
      title: '添加文件'
    })
    if (!selected) return
    const paths = Array.isArray(selected) ? selected : [selected]
    for (const path of paths) {
      handleAttach({ path: normalizePath(path), name: basename(path) })
    }
  }

  async function handlePickImages() {
    const selected = await dialogOpen({
      multiple: true,
      title: '添加图片',
      filters: [
        {
          name: '图片',
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif']
        }
      ]
    })
    if (!selected) return
    const paths = Array.isArray(selected) ? selected : [selected]
    for (const path of paths) {
      handleAttach({ path: normalizePath(path), name: basename(path) })
    }
  }

  async function handlePickFolders() {
    const selected = await dialogOpen({
      directory: true,
      multiple: true,
      title: '添加文件夹'
    })
    if (!selected) return
    const paths = Array.isArray(selected) ? selected : [selected]
    for (const path of paths) {
      handleAttach({ path: normalizePath(path), name: basename(path) })
    }
  }

  async function handlePasteImages(files: File[]) {
    await Promise.all(
      files.map(async function (file) {
        try {
          const part = await savePasteImage(file)
          handleAttach(part)
        } catch (error) {
          toast.error(typeof error === 'string' ? error : '粘贴图片失败')
        }
      })
    )
  }

  return {
    attachOpen,
    updateAttachOpen,
    triggerMatch,
    updateTriggerMatch,
    chipPaths,
    canSend,
    updateCanSend,
    syncChipPaths,
    handleTriggerChange,
    handleTriggerClose,
    handleAttach,
    handleAttachSkill,
    handlePickFiles,
    handlePickImages,
    handlePickFolders,
    handlePasteImages,
    suppressedTriggerKey
  }
}

export { useComposerAttach }
