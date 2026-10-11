import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@i-thinking/design/components/alert-dialog'
import { Button } from '@i-thinking/design/components/button'
import { Input } from '@i-thinking/design/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@i-thinking/design/components/select'
import { ScrollArea } from '@i-thinking/design/components/scroll-area'
import { Skeleton } from '@i-thinking/design/components/skeleton'
import { Spinner } from '@i-thinking/design/components/spinner'
import { Icon } from '@iconify/react/offline'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { open as dialogOpen } from '@tauri-apps/plugin-dialog'

import { useCorexStore } from '@/stores/corex.ts'
import { findFreeName } from '@/views/directive/model/draft.ts'
import { useNow } from '@/views/directive/use-now.ts'
import {
  EMPTY_RUNS,
  indexLastRuns,
  indexRunSummaries,
  indexStepCounts
} from '@/views/directive/run/run-status'
import DirectiveCard from './directive-card'

type SortKey = 'name' | 'recent'

interface DirectiveLibraryProps {
  activeName?: string
  onOpen?: (name: string) => void
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

function DirectiveLibrary(props: DirectiveLibraryProps) {
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

  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
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

  const onOpenProp = props.onOpen
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
    setPendingDelete(name)
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
    setIsDeleting(true)
    try {
      await deleteDirectiveFromHost(pendingDelete)
      await refreshDirectives()
      toast.success('已删除')
      if (props.activeName === pendingDelete) void navigate('/directive')
    } catch (error) {
      toast.error('删除失败', {
        description: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setIsDeleting(false)
      setPendingDelete(null)
    }
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col gap-3 bg-muted/35 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={function (event) {
            setQuery(event.target.value)
          }}
          placeholder="搜索指令…"
          className="max-w-xs bg-background"
        />
        <Select
          items={{ name: '按名称', recent: '最近运行' }}
          value={sortKey}
          onValueChange={function (value) {
            if (value === 'name' || value === 'recent') setSortKey(value)
          }}>
          <SelectTrigger className="h-8 w-32 bg-background">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">按名称</SelectItem>
            <SelectItem value="recent">最近运行</SelectItem>
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="secondary"
          onClick={function () {
            void handleNew()
          }}>
          <Icon
            icon="lucide:plus"
            className="size-4"
          />
          新建
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="bg-background"
          onClick={function () {
            void handleImport()
          }}>
          <Icon
            icon="lucide:upload"
            className="size-4"
          />
          导入
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {isLoading && !isLoaded ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            <Skeleton className="h-28 w-full rounded-xl" />
            <Skeleton className="h-28 w-full rounded-xl" />
            <Skeleton className="h-28 w-full rounded-xl" />
            <Skeleton className="h-28 w-full rounded-xl" />
          </div>
        ) : null}

        {loadError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
            <p className="font-medium text-destructive">无法加载指令库</p>
            <p className="mt-1 text-muted-foreground">{loadError}</p>
            <Button
              size="sm"
              className="mt-3"
              variant="outline"
              onClick={function () {
                void initialize()
              }}>
              重试
            </Button>
          </div>
        ) : null}

        {!loadError && isLoaded && filtered.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">还没有指令，点「新建」开始编排。</p>
        ) : null}

        {[...groups.entries()].map(function ([folder, entries]) {
          return (
            <div
              key={folder ?? '__root'}
              className="mb-5">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Icon
                  icon="lucide:folder-open"
                  className="size-3.5"
                />
                {folder ?? '未分组'}
                <span className="text-muted-foreground/70">{entries.length}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {entries.map(function (entry) {
                  return (
                    <DirectiveCard
                      key={entry.name}
                      entry={entry}
                      isActive={props.activeName === entry.name}
                      runs={runSummaries[entry.name] ?? EMPTY_RUNS}
                      stepCount={stepCounts[entry.name] ?? 0}
                      now={now}
                      onOpen={openName}
                      onRun={quickRun}
                      onDelete={askDelete}
                    />
                  )
                })}
              </div>
            </div>
          )
        })}
      </ScrollArea>

      {isDeleting ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/40">
          <Spinner className="size-6" />
        </div>
      ) : null}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={function (open) {
          if (!open) setPendingDelete(null)
        }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除指令？</AlertDialogTitle>
            <AlertDialogDescription>
              「{pendingDelete}」将从 corex 指令库中永久删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={function () {
                void confirmDelete()
              }}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export { DirectiveLibrary }
