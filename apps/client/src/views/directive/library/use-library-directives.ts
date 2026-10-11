import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { open as dialogOpen } from '@tauri-apps/plugin-dialog'

import { useCorexStore } from '@/stores/corex.ts'
import { findFreeName } from '@/views/directive/model/draft.ts'
import { useNow } from '@/views/directive/use-now.ts'
import {
  indexLastRuns,
  indexRunSummaries,
  indexStepCounts
} from '@/views/directive/run/run-status'

import type { SortKey } from './library-toolbar.tsx'

function groupByFolder(
  entries: ReturnType<typeof useCorexStore.getState>['directives']
): Map<string | null, typeof entries> {
  const map = new Map<string | null, typeof entries>()
  entries.forEach(function (entry) {
    const key = entry.folder
    const bucket = map.get(key) ?? []
    bucket.push(entry)
    map.set(key, bucket)
  })
  return map
}

function useLibraryDirectives(options: {
  activeName?: string
  onOpen?: (name: string) => void
}) {
  const navigate = useNavigate()
  const directives = useCorexStore(function (state) {
    return state.directives
  })
  const runs = useCorexStore(function (state) {
    return state.runs
  })
  const isLoaded = useCorexStore(function (state) {
    return state.isLoaded
  })
  const isLoading = useCorexStore(function (state) {
    return state.isLoading
  })
  const loadError = useCorexStore(function (state) {
    return state.loadError
  })
  const initialize = useCorexStore(function (state) {
    return state.initialize
  })
  const refreshDirectives = useCorexStore(function (state) {
    return state.refreshDirectives
  })
  const deleteDirectiveFromHost = useCorexStore(function (state) {
    return state.deleteDirectiveFromHost
  })
  const importDirectivesFromHost = useCorexStore(function (state) {
    return state.importDirectivesFromHost
  })
  const startRun = useCorexStore(function (state) {
    return state.startRun
  })

  const [query, updateQuery] = useState('')
  const [sortKey, updateSortKey] = useState<SortKey>('name')
  const [pendingDelete, updatePendingDelete] = useState<string | null>(null)
  const [isDeleting, updateIsDeleting] = useState(false)
  const now = useNow(60_000, true)

  useEffect(
    function () {
      void initialize()
    },
    [initialize]
  )

  const lastRuns = useMemo(
    function () {
      return indexLastRuns(directives)
    },
    [directives]
  )

  const runSummaries = useMemo(
    function () {
      return indexRunSummaries(runs, {}, lastRuns)
    },
    [runs, lastRuns]
  )

  const stepCounts = useMemo(
    function () {
      return indexStepCounts(directives)
    },
    [directives]
  )

  const filtered = useMemo(
    function () {
      const q = query.trim().toLowerCase()
      let list = directives
      if (q) {
        list = directives.filter(function (entry) {
          return (
            entry.name.toLowerCase().includes(q) ||
            (entry.summary?.description ?? '').toLowerCase().includes(q) ||
            (entry.folder ?? '').toLowerCase().includes(q)
          )
        })
      }
      const sorted = [...list]
      if (sortKey === 'recent') {
        sorted.sort(function (a, b) {
          const aAt = runSummaries[a.name]?.lastAt?.getTime() ?? 0
          const bAt = runSummaries[b.name]?.lastAt?.getTime() ?? 0
          if (aAt !== bAt) return bAt - aAt
          return a.name.localeCompare(b.name)
        })
      } else {
        sorted.sort(function (a, b) {
          return a.name.localeCompare(b.name)
        })
      }
      return sorted
    },
    [directives, query, sortKey, runSummaries]
  )

  const groups = useMemo(
    function () {
      return groupByFolder(filtered)
    },
    [filtered]
  )

  const onOpenProp = options.onOpen
  const openName = useCallback(
    function (name: string) {
      if (onOpenProp) onOpenProp(name)
      else void navigate('/directive/' + encodeURIComponent(name))
    },
    [navigate, onOpenProp]
  )

  const quickRun = useCallback(
    function (name: string) {
      startRun(name, {})
      toast.message(`已启动「${name}」`)
    },
    [startRun]
  )

  const askDelete = useCallback(function (name: string) {
    updatePendingDelete(name)
  }, [])

  async function handleNew() {
    const name = findFreeName(
      directives.map(function (d) {
        return d.name
      })
    )
    openName(name)
  }

  async function handleImport() {
    const selected = await dialogOpen({
      multiple: false,
      directory: false,
      filters: [{ name: 'YAML', extensions: ['yaml', 'yml'] }]
    })
    if (!selected || Array.isArray(selected)) return
    try {
      const result = await importDirectivesFromHost({ path: selected })
      await refreshDirectives()
      toast.success('导入完成', {
        description: `新建 ${result.created}，更新 ${result.updated}，跳过 ${result.skipped}`
      })
    } catch (error) {
      toast.error('导入失败', {
        description: error instanceof Error ? error.message : String(error)
      })
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    updateIsDeleting(true)
    try {
      await deleteDirectiveFromHost(pendingDelete)
      await refreshDirectives()
      toast.success('已删除')
      if (options.activeName === pendingDelete) void navigate('/directive')
    } catch (error) {
      toast.error('删除失败', {
        description: error instanceof Error ? error.message : String(error)
      })
    } finally {
      updateIsDeleting(false)
      updatePendingDelete(null)
    }
  }

  return {
    query,
    updateQuery,
    sortKey,
    updateSortKey,
    pendingDelete,
    updatePendingDelete,
    isDeleting,
    now,
    isLoaded,
    isLoading,
    loadError,
    initialize,
    filtered,
    groups,
    runSummaries,
    stepCounts,
    openName,
    quickRun,
    askDelete,
    handleNew,
    handleImport,
    confirmDelete
  }
}

export { useLibraryDirectives }
