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
import { Switch } from '@cogito/design/components/switch'
import { Textarea } from '@cogito/design/components/textarea'
import { cn } from 'cn'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { useCodeGitStore, type GitOutcome } from '@/stores/code-git'
import { useCodeStore } from '@/stores/code'
import { groupEntries } from '@/views/code/lib/git-status.ts'
import { Changes, type GroupKind } from '@/views/code/workspace/scm/changes.tsx'

interface DiscardTarget {
  paths: string[]
  isUntracked: boolean
  label: string
}

function report(outcome: GitOutcome) {
  if (outcome.ok) toast.success(outcome.message)
  else toast.error(outcome.message)
}

function ActionButton(props: {
  icon: string
  label: string
  isBusy?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      disabled={props.isBusy}
      className={cn(
        'hover:bg-muted hover:text-foreground text-muted-foreground flex size-5 items-center justify-center rounded-sm',
        props.isBusy && 'opacity-50'
      )}
      onClick={props.onClick}>
      <Icon
        icon={props.icon}
        className="size-3.5"
      />
    </button>
  )
}

function ScmPanel() {
  const workspaceRoot = useCodeStore(function (state) {
    return state.workspaceRoot
  })
  const isRepo = useCodeGitStore(function (state) {
    return state.isRepo
  })
  const branch = useCodeGitStore(function (state) {
    return state.branch
  })
  const ahead = useCodeGitStore(function (state) {
    return state.ahead
  })
  const behind = useCodeGitStore(function (state) {
    return state.behind
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
  const [isStageAll, setStageAll] = useState(true)
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
  const canCommit = message.trim().length > 0 && (isStageAll || stagedCount > 0)

  // 工作区切换时重新探测仓库；同一工作区内由各操作自行刷新
  useEffect(
    function () {
      void useCodeGitStore.getState().toSync(workspaceRoot)
    },
    [workspaceRoot]
  )

  function onOpenDiff(relative: string) {
    void useCodeGitStore
      .getState()
      .toOpenDiff(relative)
      .then(function (outcome) {
        if (!outcome.ok) toast.error(outcome.message)
      })
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

  async function onCommit() {
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
      <div className="border-border/50 flex h-7 shrink-0 items-center gap-1 border-b px-2 text-xs">
        <Icon
          icon="lucide:git-branch"
          className="text-muted-foreground size-3.5 shrink-0"
        />
        <span className="text-foreground truncate">{branch || '未知分支'}</span>
        {ahead > 0 ? (
          <span className="text-muted-foreground shrink-0 text-[11px]">↑{ahead}</span>
        ) : null}
        {behind > 0 ? (
          <span className="text-muted-foreground shrink-0 text-[11px]">↓{behind}</span>
        ) : null}
        <div className="ml-auto flex shrink-0 items-center">
          <ActionButton
            icon="lucide:refresh-cw"
            label="刷新"
            isBusy={isLoading}
            onClick={function () {
              void useCodeGitStore.getState().toRefresh()
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
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-1.5 p-2">
        <Textarea
          value={message}
          placeholder="提交说明"
          aria-label="提交说明"
          className="min-h-14 resize-none text-xs"
          onChange={function (event) {
            updateMessage(event.target.value)
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <label className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
            <Switch
              checked={isStageAll}
              onCheckedChange={function (checked) {
                setStageAll(checked === true)
              }}
            />
            提交前暂存全部更改
          </label>
          <Button
            type="button"
            size="sm"
            className="h-7 shrink-0 text-xs"
            disabled={!canCommit}
            onClick={function () {
              void onCommit()
            }}>
            提交
          </Button>
        </div>
        {!isStageAll && stagedCount === 0 ? (
          <p className="text-muted-foreground text-[11px]">暂无已暂存的更改</p>
        ) : null}
        {error ? <p className="text-destructive text-[11px]">{error}</p> : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {entries.length === 0 && !isLoading ? (
          <p className="text-muted-foreground px-3 text-xs">没有待提交的更改</p>
        ) : (
          <Changes
            groups={groups}
            onOpenDiff={onOpenDiff}
            onStage={onStage}
            onUnstage={onUnstage}
            onDiscard={onDiscard}
          />
        )}
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

export { ScmPanel }
