import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@cogito/design/components/alert-dialog'
import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { Input } from '@cogito/design/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { ScrollArea } from '@cogito/design/components/scroll-area'
import { Skeleton } from '@cogito/design/components/skeleton'
import { Spinner } from '@cogito/design/components/spinner'
import { Icon } from '@iconify/react/offline'
import { toast } from 'sonner'

import { useTerminalStore } from '@/stores/terminal'
import { useNow } from '@/views/directive/use-now.ts'
import { useTerminalCwd } from '@/views/directive/use-terminal-cwd.ts'
import { EMPTY_RUNS } from '@/views/directive/run/run-status'
import { setNextPrompt } from '@/features/agent/model/pending-prompt'
import Card from './card'
import { ConflictsDialog } from './conflicts-dialog.tsx'
import { DraftInbox } from './draft-inbox.tsx'
import { useLibrary } from './use-library'

interface DirectiveLibraryProps {
  activeName?: string
  onOpen?: (name: string) => void
}

function DirectiveLibrary(props: DirectiveLibraryProps) {
  const now = useNow(60_000, true)
  const library = useLibrary({
    activeName: props.activeName,
    onOpen: props.onOpen
  })
  const { cwd, emptyCwdMessage } = useTerminalCwd()
  const terminalOpen = useTerminalStore(function (state) {
    return state.open
  })
  const tabsLength = useTerminalStore(function (state) {
    return state.tabs.length
  })

  function handleOpenTerminal() {
    if (!cwd) {
      toast.error(emptyCwdMessage)
      return
    }
    const store = useTerminalStore.getState()
    if (store.tabs.length === 0) {
      store.newTab(cwd)
      return
    }
    store.setActivity('terminal')
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-muted/35">
      <div className="flex h-full min-h-0 flex-col gap-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={library.query}
            onChange={function (event) {
              library.updateQuery(event.target.value)
            }}
            placeholder="搜索指令…"
            className="h-8 max-w-xs bg-background"
          />
          <Select
            items={{ name: '按名称', recent: '最近运行' }}
            value={library.sortKey}
            onValueChange={function (value) {
              if (value === 'name' || value === 'recent') library.updateSortKey(value)
            }}>
            <SelectTrigger
              size="sm"
              className="w-32 bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">按名称</SelectItem>
              <SelectItem value="recent">最近运行</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="secondary"
            onClick={function () {
              library.handleNew()
            }}>
            <Icon
              icon="lucide:plus"
              className="size-4"
            />
            新建
          </Button>
          <Button
            variant="outline"
            className="bg-background"
            aria-label="用 AI 生成指令"
            title="用 AI 生成指令"
            onClick={function () {
              // 交给智能体聊天：预设 directive 场景与提示词，草稿生成后自动进收件箱
              setNextPrompt({
                text: '请帮我实现一条指令：',
                scenario: 'directive'
              })
              void import('@/routers').then(function (module) {
                return module.router.navigate('/agent/chat')
              })
            }}>
            <Icon
              icon="lucide:sparkles"
              className="size-4"
            />
            AI 生成
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  className="bg-background"
                  disabled={library.isImporting}
                  aria-label="导入 YAML"
                  title="导入 YAML"
                />
              }>
              <Icon
                icon="lucide:upload"
                className="size-4"
              />
              导入
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="min-w-44">
              <DropdownMenuItem
                onClick={function () {
                  void library.handleImportFolder()
                }}>
                <Icon
                  icon="lucide:folder-open"
                  className="size-4"
                />
                导入 YAML 目录…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={function () {
                  void library.handleImportFiles()
                }}>
                <Icon
                  icon="lucide:file-text"
                  className="size-4"
                />
                导入 YAML 文件…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant={terminalOpen ? 'secondary' : 'outline'}
            className="bg-background"
            aria-label="打开终端"
            title="打开终端"
            onClick={handleOpenTerminal}>
            <Icon
              icon="lucide:terminal"
              className="size-4"
            />
            终端
            {tabsLength > 0 ? (
              <span className="text-muted-foreground tabular-nums">{tabsLength}</span>
            ) : null}
          </Button>
        </div>

        <ScrollArea className="h-0 min-h-0 flex-1">
          <DraftInbox />
          {library.isLoading && !library.isLoaded ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              <Skeleton className="h-28 w-full rounded-xl" />
              <Skeleton className="h-28 w-full rounded-xl" />
              <Skeleton className="h-28 w-full rounded-xl" />
              <Skeleton className="h-28 w-full rounded-xl" />
            </div>
          ) : null}

          {library.loadError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
              <p className="font-medium text-destructive">无法加载指令库</p>
              <p className="mt-1 text-muted-foreground">{library.loadError}</p>
              <Button
                size="sm"
                className="mt-3"
                variant="outline"
                onClick={function () {
                  void library.initialize()
                }}>
                重试
              </Button>
            </div>
          ) : null}

          {!library.loadError && library.isLoaded && library.filtered.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">还没有指令，点「新建」开始编排。</p>
          ) : null}

          {[...library.groups.entries()].map(function ([folder, entries]) {
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
                      <Card
                        key={entry.name}
                        entry={entry}
                        isActive={props.activeName === entry.name}
                        runs={library.runSummaries[entry.name] ?? EMPTY_RUNS}
                        stepCount={library.stepCounts[entry.name] ?? 0}
                        now={now}
                        onOpen={library.openDirective}
                        onRun={library.quickRun}
                        onDelete={library.askDelete}
                      />
                    )
                  })}
                </div>
              </div>
            )
          })}
        </ScrollArea>
      </div>

      {library.isDeleting || library.isImporting ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/40">
          <Spinner className="size-6" />
        </div>
      ) : null}

      <ConflictsDialog
        conflicts={library.importConflicts}
        onCancel={library.cancelImport}
        onSkip={function () {
          library.confirmImport(false)
        }}
        onOverwrite={function () {
          library.confirmImport(true)
        }}
      />

      <AlertDialog
        open={library.pendingDelete !== null}
        onOpenChange={function (open) {
          if (!open) library.updatePendingDelete(null)
        }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除指令？</AlertDialogTitle>
            <AlertDialogDescription>
              「{library.pendingDelete}」将从 corex 指令库中永久删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={function () {
                void library.confirmDelete()
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
