import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import type { FilePartData } from '@/features/agent/types'
import { WorkspaceFiles, type DirEntry, type SearchHit } from '@/lib/workspace-files'
import { WorkspaceSkills, type WorkspaceSkill } from '@/lib/workspace-skills'

import type { AttachCategory, WorkspaceRoot } from './attach-menu-types.ts'

function parentRelative(relative: string) {
  const normalized = relative.replace(/\\/g, '/').replace(/\/+$/, '')
  const index = normalized.lastIndexOf('/')
  if (index < 0) return ''
  return normalized.slice(0, index)
}

interface UseAttachMenuBrowseOptions {
  roots: WorkspaceRoot[]
  category: AttachCategory
  initialQuery?: string
  onAttach: (file: FilePartData, relative?: string) => void
  onPickFile?: (relative: string) => void
}

function useAttachMenuBrowse(options: UseAttachMenuBrowseOptions) {
  const searchRef = useRef<HTMLInputElement>(null)
  const [pickedRoot, updatePickedRoot] = useState<WorkspaceRoot | null>(null)
  const activeRoot = useMemo(
    function () {
      if (options.category !== 'files') return pickedRoot
      if (options.roots.length === 1) return options.roots[0]
      return pickedRoot
    },
    [options.category, options.roots, pickedRoot]
  )
  const [relative, updateRelative] = useState('')
  const [entries, updateEntries] = useState<DirEntry[]>([])
  const [hits, updateHits] = useState<SearchHit[]>([])
  const [skills, updateSkills] = useState<WorkspaceSkill[]>([])
  const [query, updateQuery] = useState(options.initialQuery ?? '')
  const [loading, updateLoading] = useState(false)
  const searchSeq = useRef(0)

  const rootPaths = useMemo(
    function () {
      return options.roots.map(function (item) {
        return item.path
      })
    },
    [options.roots]
  )

  useEffect(
    function () {
      if (options.initialQuery !== undefined) {
        updateQuery(options.initialQuery)
      }
    },
    [options.initialQuery]
  )

  useEffect(
    function () {
      if (options.category !== 'files' || !activeRoot) return
      const trimmed = query.trim()
      if (trimmed) return
      let cancelled = false
      updateLoading(true)
      void WorkspaceFiles.listDir(activeRoot.path, relative)
        .then(function (next) {
          if (!cancelled) updateEntries(next)
        })
        .catch(function (error) {
          if (!cancelled) {
            toast.error(typeof error === 'string' ? error : '无法读取目录')
            updateEntries([])
          }
        })
        .finally(function () {
          if (!cancelled) updateLoading(false)
        })
      return function () {
        cancelled = true
      }
    },
    [options.category, activeRoot, relative, query]
  )

  useEffect(
    function () {
      if (options.category !== 'files') return
      const trimmed = query.trim()
      if (!trimmed) {
        updateHits([])
        return
      }
      if (rootPaths.length === 0) return
      const seq = ++searchSeq.current
      updateLoading(true)
      const timer = window.setTimeout(function () {
        void WorkspaceFiles.search(rootPaths, trimmed, 50)
          .then(function (next) {
            if (searchSeq.current !== seq) return
            updateHits(next)
          })
          .catch(function (error) {
            if (searchSeq.current !== seq) return
            toast.error(typeof error === 'string' ? error : '搜索失败')
            updateHits([])
          })
          .finally(function () {
            if (searchSeq.current === seq) updateLoading(false)
          })
      }, 150)
      return function () {
        window.clearTimeout(timer)
      }
    },
    [options.category, query, rootPaths]
  )

  useEffect(
    function () {
      if (options.category !== 'skills') return
      if (rootPaths.length === 0) {
        updateSkills([])
        return
      }
      let cancelled = false
      updateLoading(true)
      void WorkspaceSkills.fetchSkills(rootPaths)
        .then(function (next) {
          if (!cancelled) updateSkills(next)
        })
        .catch(function (error) {
          if (!cancelled) {
            toast.error(typeof error === 'string' ? error : '无法加载技能')
            updateSkills([])
          }
        })
        .finally(function () {
          if (!cancelled) updateLoading(false)
        })
      return function () {
        cancelled = true
      }
    },
    [options.category, rootPaths]
  )

  useEffect(
    function () {
      if (options.category === 'files' || options.category === 'skills') {
        window.setTimeout(function () {
          searchRef.current?.focus()
        }, 0)
      }
    },
    [options.category]
  )

  const filteredSkills = useMemo(
    function () {
      const trimmed = query.trim().toLowerCase()
      if (!trimmed) return skills
      return skills.filter(function (skill) {
        return (
          skill.name.toLowerCase().includes(trimmed) ||
          skill.description.toLowerCase().includes(trimmed)
        )
      })
    },
    [skills, query]
  )

  function handleAttachPath(path: string, name: string, relativePath?: string) {
    const relativeNorm = relativePath ? relativePath.replace(/\\/g, '/') : undefined
    options.onAttach({ path: path.replace(/\\/g, '/'), name }, relativeNorm)
    if (relativeNorm) {
      options.onPickFile?.(relativeNorm)
    }
  }

  function handleEnterRoot(root: WorkspaceRoot) {
    updatePickedRoot(root)
    updateRelative('')
    updateQuery('')
  }

  function handleEnterDir(entry: DirEntry) {
    updateRelative(entry.relative)
    updateQuery('')
  }

  function handleBack() {
    if (relative) {
      updateRelative(parentRelative(relative))
      return
    }
    if (options.roots.length > 1) {
      updatePickedRoot(null)
    }
  }

  const isSearchMode = options.category === 'files' && query.trim().length > 0
  const showRootPicker =
    options.category === 'files' && !activeRoot && options.roots.length > 1 && !isSearchMode
  const canGoBack =
    !isSearchMode && Boolean(activeRoot) && (Boolean(relative) || options.roots.length > 1)

  return {
    searchRef,
    query,
    updateQuery,
    loading,
    activeRoot,
    relative,
    entries,
    hits,
    filteredSkills,
    isSearchMode,
    showRootPicker,
    canGoBack,
    handleAttachPath,
    handleEnterRoot,
    handleEnterDir,
    handleBack
  }
}

export { useAttachMenuBrowse }
