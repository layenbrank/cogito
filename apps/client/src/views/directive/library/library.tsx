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

import { useNow } from '@/views/directive/use-now.ts'
import { EMPTY_RUNS } from '@/views/directive/run/run-status'
import DirectiveCard from './directive-card'
import { useDirectiveLibrary } from './use-directive-library'

interface DirectiveLibraryProps {
  activeName?: string
  onOpen?: (name: string) => void
}

function DirectiveLibrary(props: DirectiveLibraryProps) {
  const now = useNow(60_000, true)
  const lib = useDirectiveLibrary({
    activeName: props.activeName,
    onOpen: props.onOpen
  })

  return (
    <div className="relative flex h-full min-h-0 flex-col gap-3 bg-muted/35 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={lib.query}
          onChange={function (event) {
            lib.updateQuery(event.target.value)
          }}
          placeholder="搜索指令…"
          className="max-w-xs bg-background"
        />
        <Select
          items={{ name: '按名称', recent: '最近运行' }}
          value={lib.sortKey}
          onValueChange={function (value) {
            if (value === 'name' || value === 'recent') lib.updateSortKey(value)
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
            void lib.handleNew()
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
            void lib.handleImport()
          }}>
          <Icon
            icon="lucide:upload"
            className="size-4"
          />
          导入
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {lib.isLoading && !lib.isLoaded ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            <Skeleton className="h-28 w-full rounded-xl" />
            <Skeleton className="h-28 w-full rounded-xl" />
            <Skeleton className="h-28 w-full rounded-xl" />
            <Skeleton className="h-28 w-full rounded-xl" />
          </div>
        ) : null}

        {lib.loadError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
            <p className="font-medium text-destructive">无法加载指令库</p>
            <p className="mt-1 text-muted-foreground">{lib.loadError}</p>
            <Button
              size="sm"
              className="mt-3"
              variant="outline"
              onClick={function () {
                void lib.initialize()
              }}>
              重试
            </Button>
          </div>
        ) : null}

        {!lib.loadError && lib.isLoaded && lib.filtered.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">还没有指令，点「新建」开始编排。</p>
        ) : null}

        {[...lib.groups.entries()].map(function ([folder, entries]) {
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
                      runs={lib.runSummaries[entry.name] ?? EMPTY_RUNS}
                      stepCount={lib.stepCounts[entry.name] ?? 0}
                      now={now}
                      onOpen={lib.openName}
                      onRun={lib.quickRun}
                      onDelete={lib.askDelete}
                    />
                  )
                })}
              </div>
            </div>
          )
        })}
      </ScrollArea>

      {lib.isDeleting ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/40">
          <Spinner className="size-6" />
        </div>
      ) : null}

      <AlertDialog
        open={lib.pendingDelete !== null}
        onOpenChange={function (open) {
          if (!open) lib.updatePendingDelete(null)
        }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除指令？</AlertDialogTitle>
            <AlertDialogDescription>
              「{lib.pendingDelete}」将从 corex 指令库中永久删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={function () {
                void lib.confirmDelete()
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
