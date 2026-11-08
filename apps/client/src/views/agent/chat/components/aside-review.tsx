/**
 * 右栏审阅：本地 / 远端改动一览 + 逐文件内联对比 + 暂存 / 提交 / 拉取 / 推送。
 *
 * 数据来自 agent 共享的 Git 快照（`useWorkspaceGitSnapshot`），动作也走共享动作层，
 * 所以这里切分支、拉取、提交后 composer 与代码窗都会同步更新。
 */
import { useAuiState } from '@assistant-ui/react'
import { useEffect, useRef, useState } from 'react'

import { useActiveWorkspace } from '@/features/agent/workspace/active.ts'
import {
  checkoutNow,
  commitNow,
  discardNow,
  fetchNow,
  pullNow,
  pushNow,
  refreshNow,
  stageNow,
  unstageNow,
  useWorkspaceGitSnapshot
} from '@/features/agent/workspace/git.ts'
import { AsideDiff } from '@/views/agent/chat/components/aside-diff'
import {
  AsideReviewList,
  type ReviewSelection
} from '@/views/agent/chat/components/aside-review-list'
import { AsideReviewStatusBar } from '@/views/agent/chat/components/aside-review-status-bar'
import { useAsideReviewRows } from '@/views/agent/chat/components/aside-review-rows'
import { useStructuralThreadMessages } from '@/views/agent/chat/components/use-structural-messages.ts'
import {
  DiscardDialog,
  toDiscardTarget,
  type DiscardTarget
} from '@/views/code/workspace/scm/discard-dialog'

interface AsideReviewProps {
  initialRelative?: string | null
  /** 打开工作区文件（切到「文件」页签预览） */
  onOpenFile?: (relative: string) => void
}

function AsideReview(props: AsideReviewProps) {
  const { rootPath } = useActiveWorkspace()
  const snapshot = useWorkspaceGitSnapshot(rootPath)
  // 审阅行只由工具调用决定（不看正文）：按结构订阅，流式时不重算 O(消息数) 的投影
  const messages = useStructuralThreadMessages()
  const isRunning = useAuiState(function (state) {
    return state.thread.isRunning
  })
  const wasRunning = useRef(isRunning)

  const [selection, updateSelection] = useState<ReviewSelection | null>(
    props.initialRelative ? { relative: props.initialRelative } : null
  )
  const [seenInitial, updateSeenInitial] = useState(props.initialRelative ?? null)
  const [discardTarget, setDiscardTarget] = useState<DiscardTarget | null>(null)
  // 切文件夹由 AgentAside 的 key 触发重挂：选中项 / 展开态自然清空，不必在这里再判一次

  if (props.initialRelative !== seenInitial) {
    updateSeenInitial(props.initialRelative ?? null)
    updateSelection(props.initialRelative ? { relative: props.initialRelative } : null)
  }

  const rows = useAsideReviewRows(rootPath, snapshot.entries, messages)

  // 一轮 run 结束后磁盘可能已被 agent 改过：清缓存再读，比「刷新按钮」靠得住
  useEffect(
    function () {
      if (wasRunning.current && !isRunning) {
        void refreshNow(rootPath)
      }
      wasRunning.current = isRunning
    },
    [isRunning, rootPath]
  )

  async function onConfirmDiscard() {
    if (!discardTarget) return
    await discardNow(rootPath, discardTarget.paths, discardTarget.isUntracked)
    setDiscardTarget(null)
  }

  if (!rootPath) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center p-4 text-center text-xs">
        先在左栏添加一个工作区
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AsideReviewStatusBar
        branch={snapshot.branch}
        ahead={snapshot.ahead}
        behind={snapshot.behind}
        upstream={snapshot.upstream}
        branches={snapshot.branches}
        isPending={snapshot.isPending}
        onCheckout={function (name, fromRemote) {
          return checkoutNow(rootPath, name, fromRemote)
        }}
        onFetch={function () {
          return fetchNow(rootPath)
        }}
        onPull={function () {
          return pullNow(rootPath)
        }}
        onPush={function () {
          const isFirstPush = !snapshot.upstream?.hasUpstream
          return pushNow(rootPath, snapshot.branch, isFirstPush)
        }}
        onRefresh={function () {
          return refreshNow(rootPath)
        }}
      />

      {selection ? (
        <AsideDiff
          rootPath={rootPath}
          relative={selection.relative}
          revs={selection.revs}
          label={selection.label}
          onBack={function () {
            updateSelection(null)
          }}
        />
      ) : (
        <AsideReviewList
          upstream={snapshot.upstream}
          isRepo={snapshot.isRepo}
          isPending={snapshot.isPending}
          error={snapshot.error}
          rows={rows}
          onSelect={function (next) {
            updateSelection(next)
          }}
          onOpenFile={function (relative) {
            props.onOpenFile?.(relative)
          }}
          onStage={function (paths) {
            void stageNow(rootPath, paths)
          }}
          onUnstage={function (paths) {
            void unstageNow(rootPath, paths)
          }}
          onDiscard={function (paths, isUntracked) {
            setDiscardTarget(toDiscardTarget(paths, isUntracked))
          }}
          onCommit={async function (message, isStageAll) {
            const outcome = await commitNow(rootPath, message, isStageAll)
            return outcome.ok
          }}
        />
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
    </div>
  )
}

export { AsideReview }
