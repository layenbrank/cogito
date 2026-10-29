/**
 * 源码管理面板：分支条 + 提交框 + 变更分组。
 */
import { Icon } from '@iconify/react/offline'
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
import { Textarea } from '@cogito/design/components/textarea'
import { cn } from 'cn'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { useCodeGitStore, type GitOutcome } from '@/stores/code-git'
import { useCodeStore } from '@/stores/code'
import { groupEntries } from '@/views/code/lib/git-status.ts'
import { joinPath } from '@/views/code/lib/path.ts'
import { BranchSwitcher } from '@/views/code/workspace/scm/branch-switcher.tsx'
import { Changes, type GroupKind } from '@/views/code/workspace/scm/changes.tsx'
import { ScmHistory } from '@/views/code/workspace/scm/history.tsx'

interface DiscardTarget {
  paths: string[]
  isUntracked: boolean
  label: string
}

function report(outcome: GitOutcome) {
  if (outcome.ok) toast.success(outcome.message)
  else toast.error(outcome.message)
}

function CommitBar(props: {
  canCommitStaged: boolean
  canCommitAll: boolean
  onCommitStaged: () => void
  onCommitAll: () => void
}) {
  const hasChoice = props.canCommitStaged || props.canCommitAll
  return (
    <div className="flex w-full">
      <Button
        type="button"
        className="h-9 min-w-0 flex-1 rounded-none rounded-l-md text-sm"
        disabled={!props.canCommitStaged}
        title={props.canCommitStaged ? '提交暂存的更改' : '请先暂存要提交的更改'}
        onClick={props.onCommitStaged}>
        <Icon
          icon="lucide:check"
          className="size-4"
        />
        提交
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="提交选项"
          disabled={!hasChoice}
          className="bg-primary text-primary-foreground hover:bg-primary-hover flex h-9 w-9 shrink-0 items-center justify-center rounded-r-md border-l border-primary-foreground/25 outline-none disabled:pointer-events-none disabled:opacity-50">
          <Icon
            icon="lucide:chevron-down"
            className="size-4"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-44">
          <DropdownMenuItem
            className="text-sm"
            disabled={!props.canCommitStaged}
            onClick={props.onCommitStaged}>
            提交暂存的更改
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-sm"
            disabled={!props.canCommitAll}
            onClick={props.onCommitAll}>
            提交所有更改
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function ActionButton(props: {
  icon: string
  label: string
  isBusy?: boolean
  onClick: () => void
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      type="button"
      aria-label={props.label}
      title={props.label}
      disabled={props.isBusy}
      className={cn(
        'hover:bg-muted hover:text-foreground text-muted-foreground flex size-7 items-center justify-center rounded-sm',
        props.isBusy && 'opacity-50'
      )}
      onClick={props.onClick}>
      <Icon
        icon={props.icon}
        className="size-4"
      />
    </Button>
  )
}

function ScmSurface() {
  const workspaceRoot = useCodeStore(function (state) {
    return state.workspaceRoot
  })
  const isRepo = useCodeGitStore(function (state) {
    return state.isRepo
  })
  const entries = useCodeGitStore(function (state) {
    return state.entries
  })
  const isLoading = useCodeGitStore(function (state) {
    return state.isLoading
  })
  const error = useCodeGitStore(function (state) {
    return state.error
  })

  const [message, updateMessage] = useState('')
  const [discardTarget, setDiscardTarget] = useState<DiscardTarget | null>(null)

  const groups = useMemo(
    function () {
      const parsed = groupEntries(entries)
      const list: { kind: GroupKind; title: string; entries: typeof parsed.staged }[] = [
        { kind: 'staged', title: '暂存的更改', entries: parsed.staged },
        { kind: 'changed', title: '更改', entries: parsed.changed },
        { kind: 'untracked', title: '未跟踪', entries: parsed.untracked }
      ]
      return list
    },
    [entries]
  )

  const stagedCount = groups[0].entries.length
  const hasMessage = message.trim().length > 0
  const canCommitStaged = hasMessage && stagedCount > 0
  const canCommitAll = hasMessage && entries.length > 0

  // probe 仍由 code.tsx 统一触发；此处只 invalidate+status，避免工作区改动因指纹未变而一直空列表
  useEffect(
    function () {
      if (!isRepo) return
      void useCodeGitStore.getState().toInvalidateAndRefresh()
    },
    [isRepo, workspaceRoot]
  )

  function onOpenDiff(relative: string) {
    if (!workspaceRoot) return
    // 与 VS Code 一致：SCM 点击打开「工作区」差异标签，可与编辑标签并存
    useCodeStore.getState().toOpenDiffTab({ path: joinPath(workspaceRoot, relative) })
  }

  function onOpenFile(relative: string) {
    if (!workspaceRoot) return
    useCodeStore.getState().toOpenTab({ path: joinPath(workspaceRoot, relative) })
  }

  function onStage(paths: string[]) {
    void useCodeGitStore
      .getState()
      .toStage(paths)
      .then(report)
  }

  function onUnstage(paths: string[]) {
    void useCodeGitStore
      .getState()
      .toUnstage(paths)
      .then(report)
  }

  function onDiscard(paths: string[], isUntracked: boolean) {
    setDiscardTarget({
      paths,
      isUntracked,
      label: paths.length === 1 ? paths[0] : `${paths.length} 个文件`
    })
  }

  async function onConfirmDiscard() {
    if (!discardTarget) return
    const outcome = await useCodeGitStore
      .getState()
      .toDiscard(discardTarget.paths, discardTarget.isUntracked)
    report(outcome)
    setDiscardTarget(null)
    useCodeStore.getState().toBumpTree()
  }

  async function onCommit(isStageAll: boolean) {
    const outcome = await useCodeGitStore.getState().toCommit(message.trim(), isStageAll)
    report(outcome)
    if (outcome.ok) updateMessage('')
  }

  async function onPull() {
    const outcome = await useCodeGitStore.getState().toPull()
    report(outcome)
    if (outcome.ok) useCodeStore.getState().toBumpTree()
  }

  async function onFetch() {
    report(await useCodeGitStore.getState().toFetch())
  }

  if (!workspaceRoot) {
    return (
      <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs">
        <Icon
          icon="lucide:git-branch"
          className="size-8 opacity-40"
        />
        <p>尚未打开文件夹</p>
      </div>
    )
  }

  if (!isRepo) {
    return (
      <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs">
        <Icon
          icon="lucide:git-branch"
          className="size-8 opacity-40"
        />
        <p>{error ? '无法读取 Git 仓库' : '当前文件夹不是 Git 仓库'}</p>
        {error ? <p className="text-destructive max-w-56 break-words">{error}</p> : null}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border/50 flex h-9 shrink-0 items-center gap-0.5 border-b px-1.5">
        <BranchSwitcher
          size="md"
          tone="header"
          className="min-w-0"
        />
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <ActionButton
            icon="lucide:refresh-cw"
            label="刷新"
            isBusy={isLoading}
            onClick={function () {
              // 工作区改动不进指纹：刷新必须先 invalidate，否则会一直命中空缓存
              void useCodeGitStore.getState().toInvalidateAndRefresh()
            }}
          />
          <ActionButton
            icon="lucide:cloud-download"
            label="获取远程更新"
            onClick={function () {
              void onFetch()
            }}
          />
          <ActionButton
            icon="lucide:arrow-down-to-line"
            label="拉取"
            onClick={function () {
              void onPull()
            }}
          />
          <ActionButton
            icon="lucide:git-commit-horizontal"
            label="搜索提交"
            onClick={function () {
              useCodeStore.getState().toOpenCommitsTab()
            }}
          />
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-1.5 border-b border-border/40 p-2">
        <Textarea
          value={message}
          placeholder="提交说明"
          aria-label="提交说明"
          style={{ height: 150, minHeight: 150, maxHeight: 150, fieldSizing: 'fixed' }}
          className="field-sizing-fixed h-[150px] max-h-[150px] min-h-[150px] resize-none overflow-y-auto scroll-smooth text-sm"
          onChange={function (event) {
            updateMessage(event.target.value)
          }}
        />
        <CommitBar
          canCommitStaged={canCommitStaged}
          canCommitAll={canCommitAll}
          onCommitStaged={function () {
            void onCommit(false)
          }}
          onCommitAll={function () {
            void onCommit(true)
          }}
        />
        {error ? <p className="text-destructive text-xs">{error}</p> : null}
      </div>

      {/* 变更独占主滚动区，历史钉在底部，避免互相挤占 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {entries.length === 0 && !isLoading ? (
          <p className="text-muted-foreground px-3 py-2 text-xs">没有待提交的更改</p>
        ) : (
          <Changes
            groups={groups}
            onOpenDiff={onOpenDiff}
            onOpenFile={onOpenFile}
            onStage={onStage}
            onUnstage={onUnstage}
            onDiscard={onDiscard}
          />
        )}
      </div>

      <div className="border-border/40 shrink-0 border-t">
        <ScmHistory />
      </div>

      <AlertDialog
        open={discardTarget !== null}
        onOpenChange={function (open) {
          if (!open) setDiscardTarget(null)
        }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {discardTarget?.isUntracked ? '删除未跟踪文件？' : '撤销这些更改？'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {discardTarget?.label}
              {discardTarget?.isUntracked
                ? ' 删除后无法恢复。'
                : ' 未保存到暂存区的修改会丢失，且无法恢复。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={function () {
                void onConfirmDiscard()
              }}>
              继续
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export { ScmSurface }
