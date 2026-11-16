/**
 * 源码管理面板：分支条 + 提交框 + 变更分组 + 提交历史。
 *
 * 「更改」与「提交」各占一栏，中间的横向分隔条可拖 —— 提交多了就把历史拉高，
 * 只想看工作区改动就把历史压回去。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  Splitter,
  SplitterHandle,
  SplitterPane,
  usePaneRef
} from '@cogito/design/components/splitter'
import { Textarea } from '@cogito/design/components/textarea'
import { cn } from 'cn'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { useCodeGitStore, type GitOutcome } from '@/stores/code-git'
import { useCodeStore } from '@/stores/code'
import { GitOperationsMenu } from '@/features/git-operations/menu.tsx'
import { OperationBanner } from '@/features/git-operations/operation-banner.tsx'
import { WorktreeDialog } from '@/features/git-operations/worktree-dialog.tsx'
import { groupEntries } from '@/views/code/lib/git-status.ts'
import { joinPath } from '@/views/code/lib/path.ts'
import { BranchSwitcher } from '@/views/code/workspace/scm/branch-switcher.tsx'
import { Changes, type GroupKind } from '@/views/code/workspace/scm/changes.tsx'
import { CommitBar } from '@/views/code/workspace/scm/commit-bar.tsx'
import {
  DiscardDialog,
  toDiscardTarget,
  type DiscardTarget
} from '@/views/code/workspace/scm/discard-dialog.tsx'
import { ScmHistory } from '@/views/code/workspace/scm/history.tsx'
import { RepoSwitcher } from '@/views/code/workspace/scm/repo-switcher.tsx'

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
  const roots = useCodeStore(function (state) {
    return state.roots
  })
  const repoRoot = useCodeGitStore(function (state) {
    return state.repoRoot
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
  const branch = useCodeGitStore(function (state) {
    return state.branch
  })
  const branches = useCodeGitStore(function (state) {
    return state.branches
  })
  const operation = useCodeGitStore(function (state) {
    return state.operation
  })
  const stashes = useCodeGitStore(function (state) {
    return state.stashes
  })
  const conflicted = useCodeGitStore(function (state) {
    return state.conflicted
  })
  const worktrees = useCodeGitStore(function (state) {
    return state.worktrees
  })
  const isWorktreesLoading = useCodeGitStore(function (state) {
    return state.isWorktreesLoading
  })

  const [message, updateMessage] = useState('')
  const [discardTarget, setDiscardTarget] = useState<DiscardTarget | null>(null)
  // 提交历史栏的手柄：收起时压到只剩表头（`collapsedSize`），空间让给「更改」
  const historyPaneRef = usePaneRef()
  const [isWorktreeOpen, setWorktreeOpen] = useState(false)

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
      // 储藏列表 / 多步操作态只在进面板与换仓库时读：写操作自己会补读
      void useCodeGitStore.getState().toLoadState()
    },
    [isRepo, repoRoot]
  )

  /** 相对路径一律相对「当前仓库根」拼 —— 多根时它不一定等于 roots[0] */
  function onOpenDiff(relative: string) {
    if (!repoRoot) return
    // 与 VS Code 一致：SCM 点击打开「工作区」差异标签，可与编辑标签并存
    useCodeStore.getState().toOpenDiffTab({ path: joinPath(repoRoot, relative) })
  }

  function onOpenFile(relative: string) {
    if (!repoRoot) return
    useCodeStore.getState().toOpenTab({ path: joinPath(repoRoot, relative) })
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
    setDiscardTarget(toDiscardTarget(paths, isUntracked))
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

  const emptyClass =
    'text-muted-foreground flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs'

  // 仓库条常驻：没有仓库时也要能在这里切到别的根，否则用户只能回 Explorer 再切工作区
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border/50 flex h-9 shrink-0 items-center gap-0.5 border-b px-1.5">
        <RepoSwitcher className="min-w-0 flex-1" />
        {isRepo ? (
          <div className="flex shrink-0 items-center gap-0.5">
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
            <GitOperationsMenu
              stashes={stashes}
              operation={operation}
              branch={branch}
              branches={branches}
              onStashPush={function (options) {
                return useCodeGitStore.getState().toStashPush(options)
              }}
              onStashApply={function (index, isPop) {
                return useCodeGitStore.getState().toStashApply(index, isPop)
              }}
              onStashDrop={function (index) {
                return useCodeGitStore.getState().toStashDrop(index)
              }}
              onRebase={function (upstream) {
                return useCodeGitStore.getState().toRebase(upstream)
              }}
              onRebaseContinue={function () {
                return useCodeGitStore.getState().toRebaseContinue()
              }}
              onRebaseAbort={function () {
                return useCodeGitStore.getState().toRebaseAbort()
              }}
              onOpenWorktrees={function () {
                setWorktreeOpen(true)
              }}
            />
          </div>
        ) : null}
      </div>

      {isRepo && operation ? (
        <OperationBanner
          operation={operation}
          conflicted={conflicted}
          onContinue={function () {
            void useCodeGitStore.getState().toRebaseContinue()
          }}
          onAbort={function () {
            void useCodeGitStore.getState().toRebaseAbort()
          }}
        />
      ) : null}

      {isRepo ? (
        <div className="border-border/50 flex h-9 shrink-0 items-center border-b px-1.5">
          <BranchSwitcher
            size="md"
            tone="header"
            className="min-w-0"
          />
        </div>
      ) : null}

      {roots.length === 0 ? (
        <div className={emptyClass}>
          <Icon
            icon="lucide:git-branch"
            className="size-8 opacity-40"
          />
          <p>尚未打开文件夹</p>
        </div>
      ) : !isRepo ? (
        <div className={emptyClass}>
          <Icon
            icon="lucide:git-branch"
            className="size-8 opacity-40"
          />
          <p>{error ? '无法读取 Git 仓库' : '当前工作区没有 Git 仓库'}</p>
          {error ? <p className="text-destructive max-w-56 break-words">{error}</p> : null}
          <p className="max-w-56 break-words opacity-70">
            用上方仓库选择器切到其它文件夹，或在资源管理器里打开 / 添加文件夹
          </p>
        </div>
      ) : (
        <>
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

          {/* 变更与历史各自成栏：分隔条可拖，两栏各自滚动，互不挤占 */}
          <Splitter
            id="code-scm-split"
            orientation="vertical"
            className="min-h-0 flex-1">
            <SplitterPane
              id="code-scm-changes"
              defaultSize="58%"
              min={72}
              className="min-h-0 overflow-hidden">
              <div className="h-full min-h-0 overflow-y-auto">
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
            </SplitterPane>
            <SplitterHandle withHandle />
            <SplitterPane
              id="code-scm-history"
              paneRef={historyPaneRef}
              defaultSize="42%"
              min={96}
              collapsedSize={28}
              className="min-h-0 overflow-hidden">
              <ScmHistory paneRef={historyPaneRef} />
            </SplitterPane>
          </Splitter>
        </>
      )}

      <DiscardDialog
        target={discardTarget}
        onOpenChange={function (open) {
          if (!open) setDiscardTarget(null)
        }}
        onConfirm={function () {
          void onConfirmDiscard()
        }}
      />

      <WorktreeDialog
        open={isWorktreeOpen}
        onOpenChange={setWorktreeOpen}
        worktrees={worktrees}
        isLoading={isWorktreesLoading}
        branches={branches}
        onReload={function () {
          void useCodeGitStore.getState().toLoadWorktrees()
        }}
        onAdd={function (options) {
          return useCodeGitStore.getState().toAddWorktree(options)
        }}
        onRemove={function (targetPath, isForce) {
          return useCodeGitStore.getState().toRemoveWorktree(targetPath, isForce)
        }}
      />
    </div>
  )
}

export { ScmSurface }
