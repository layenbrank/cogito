import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { open as dialogOpen } from '@tauri-apps/plugin-dialog'

import type { ImportResult } from '@/shared/ipc/specs/sidecar'

import { useCorexStore } from '@/stores/corex.ts'
import { findFreeName } from '@/views/directive/model/draft.ts'
import { indexLastRuns, indexRunSummaries, indexStepCounts } from '@/views/directive/run/run-status'

import {
  formatImportSummary,
  importFailure,
  importNames,
  joinNames,
  mergeImportResults
} from './import.ts'

type SortKey = 'name' | 'recent'

/** 目录由 corex 递归扫；文件是多选一批 */
type ImportKind = 'folder' | 'files'

interface ImportPlan {
  paths: string[]
  /** 预检扫出来的同名指令 */
  conflicts: string[]
}

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

interface UseLibraryOptions {
  activeName?: string
  onOpen?: (name: string) => void
}

function useLibrary(options: UseLibraryOptions) {
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
  const [importPlan, updateImportPlan] = useState<ImportPlan | null>(null)
  const [isImporting, updateIsImporting] = useState(false)

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
      const keyword = query.trim().toLowerCase()
      let matches = directives
      if (keyword) {
        matches = directives.filter(function (entry) {
          return (
            entry.name.toLowerCase().includes(keyword) ||
            (entry.summary?.description ?? '').toLowerCase().includes(keyword) ||
            (entry.folder ?? '').toLowerCase().includes(keyword)
          )
        })
      }
      const sorted = [...matches]
      if (sortKey === 'recent') {
        sorted.sort(function (left, right) {
          const leftAt = runSummaries[left.name]?.lastAt?.getTime() ?? 0
          const rightAt = runSummaries[right.name]?.lastAt?.getTime() ?? 0
          if (leftAt !== rightAt) return rightAt - leftAt
          return left.name.localeCompare(right.name)
        })
      } else {
        sorted.sort(function (left, right) {
          return left.name.localeCompare(right.name)
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

  const onOpen = options.onOpen
  const openDirective = useCallback(
    function (name: string) {
      if (onOpen) onOpen(name)
      else void navigate('/directive/' + encodeURIComponent(name))
    },
    [navigate, onOpen]
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

  function handleNew() {
    const name = findFreeName(
      directives.map(function (entry) {
        return entry.name
      })
    )
    openDirective(name)
  }

  /**
   * 选路径：目录交给 corex 递归扫；文件多选一批，一次落一批。
   */
  async function pickImportPaths(kind: ImportKind): Promise<string[] | null> {
    try {
      if (kind === 'folder') {
        const picked = await dialogOpen({ directory: true })
        return picked ? [picked] : null
      }
      const picked = await dialogOpen({
        multiple: true,
        filters: [{ name: 'YAML', extensions: ['yaml', 'yml'] }]
      })
      return picked && picked.length > 0 ? picked : null
    } catch (error) {
      toast.error('没能打开选择框', {
        description: error instanceof Error ? error.message : String(error)
      })
      return null
    }
  }

  function reportImport(result: ImportResult) {
    const failed = importNames(result, 'failed')
    const description = [
      formatImportSummary(result),
      failed.length > 0 ? `失败：${joinNames(failed)}` : ''
    ]
      .filter(Boolean)
      .join('；')
    if (failed.length > 0) toast.error('部分文件导入失败', { description })
    else toast.success('导入完成', { description })
  }

  /** 一条路径炸了不连累后面的：给自己记一条失败，最后一起报 */
  async function importPaths(paths: readonly string[], isOverwrite: boolean) {
    updateIsImporting(true)
    try {
      const results: ImportResult[] = []
      for (const path of paths) {
        try {
          results.push(await importDirectivesFromHost({ path, is_overwrite: isOverwrite }))
        } catch (error) {
          // 失败会进 mergeImportResults 给用户看，但开发侧也要能看到是哪一条炸的
          console.debug('[directive] 导入单条失败（已记入结果）:', error)
          results.push(importFailure(path, error))
        }
      }
      await refreshDirectives()
      reportImport(mergeImportResults(results))
    } catch (error) {
      toast.error('导入后刷新指令库失败', {
        description: error instanceof Error ? error.message : String(error)
      })
    } finally {
      updateIsImporting(false)
    }
  }

  /** dry_run 预检：corex 只报计数，同名条目得自己挑出来问 */
  async function previewImportPaths(paths: readonly string[]): Promise<ImportResult[]> {
    const previews: ImportResult[] = []
    for (const path of paths) {
      previews.push(await importDirectivesFromHost({ path, is_dry_run: true }))
    }
    return previews
  }

  /**
   * 导入 YAML：先选目录或一批文件，再 dry_run 扫同名。
   * 有同名就问一次（跳过 / 覆盖 / 取消）；没有冲突直接落库。
   *
   * 选路径与预检期间也置忙：预检还没回来就能再点一次导入，两批会交叉落库。
   */
  async function importFrom(kind: ImportKind) {
    if (isImporting) return
    updateIsImporting(true)
    try {
      const paths = await pickImportPaths(kind)
      if (!paths) return

      let previews: ImportResult[]
      try {
        previews = await previewImportPaths(paths)
      } catch (error) {
        toast.error('导入预检失败', {
          description: error instanceof Error ? error.message : String(error)
        })
        return
      }

      const conflicts = importNames(mergeImportResults(previews), 'skipped')
      if (conflicts.length > 0) {
        updateImportPlan({ paths, conflicts })
        return
      }
      await importPaths(paths, false)
    } finally {
      updateIsImporting(false)
    }
  }

  async function handleImportFolder() {
    await importFrom('folder')
  }

  async function handleImportFiles() {
    await importFrom('files')
  }

  function cancelImport() {
    updateImportPlan(null)
  }

  function confirmImport(isOverwrite: boolean) {
    const plan = importPlan
    if (!plan || isImporting) return
    updateImportPlan(null)
    void importPaths(plan.paths, isOverwrite)
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
    importConflicts: importPlan ? importPlan.conflicts : null,
    isImporting,
    cancelImport,
    confirmImport,
    isLoaded,
    isLoading,
    loadError,
    initialize,
    filtered,
    groups,
    runSummaries,
    stepCounts,
    openDirective,
    quickRun,
    askDelete,
    handleNew,
    handleImportFolder,
    handleImportFiles,
    confirmDelete
  }
}

export { useLibrary }
export type { SortKey }
