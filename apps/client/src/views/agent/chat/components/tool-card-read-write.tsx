/**
 * 写文件工具卡：默认是 `CodeDiff` 一种形态，另有一层可选的「按块审阅」。
 *
 * 审阅走 assistant-ui 的 `reviewable-diff` 元素：把这次写入的行级 diff 切成块，
 * 逐块保留 / 丢弃，「应用」时只把保留的块写回文件（丢弃的块退回写入前的内容）。
 * 只对「整文件 before/after」开放 —— 打开审阅与落盘前都会拿磁盘内容比对一次，
 * 片段级改动（old_string / new_string）或之后又被改过的文件都会被拒。
 *
 * 头就是 CodeDiff 自己的标题栏 —— 文件名 + `+N −M` + 右侧「审阅 / 工作区」，一行说完；
 * 不再套 `Tool` / `ToolHeader` 那层「wrench 图标 + 中文状态徽章」的外壳，
 * 状态由工具行本身表达（运行中展开、结束后收起）。
 *
 * 拿不到 before/after（只有路径或纯覆盖写）时退回通用的 `ToolFallback` 明细，
 * 仍然是一行摘要 + 展开参数 / 结果。
 */
import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import { Icon } from '@iconify/react/offline'
import { CodeBlock } from '@cogito/design/assistant/code-block'
import { CodeDiff } from '@cogito/design/assistant/code-diff'
import { ReviewableDiff, type HunkDecision } from '@cogito/design/assistant/reviewable-diff'
import { ToolFallback } from '@cogito/design/assistant/tool-fallback.aui'
import { Button } from '@cogito/design/components/button'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { normalizeToolPath } from '@/features/agent/tool-paths'
import { toAgentToolLabel } from '@/features/agent/tool-labels'
import { useActiveWorkspace } from '@/features/agent/workspace/active'
import { bumpWorkspaceRevision } from '@/features/agent/workspace/revision'
import { openAsideReview } from '@/views/agent/chat/components/open-aside-review'
import {
  fetchWriteCodeDiff,
  findWritePath,
  parseWriteCodeDiff,
  type WriteCodeDiff
} from '@/views/agent/chat/components/parse-tool-result'
import {
  isSameText,
  normalizeEol,
  parseWriteReview,
  rebuildReviewedText,
  type WriteReview
} from '@/views/agent/chat/components/write-review'
import { joinPath, readCodeFile, writeCodeFile } from '@/views/code/lib/fs'

function WorkspaceDiffAction(props: { relative: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="text-muted-foreground hover:text-foreground h-7 gap-1 rounded-md px-2 text-xs"
      title="在右栏查看 HEAD ↔ 工作区差异"
      onClick={function (event) {
        event.stopPropagation()
        openAsideReview(props.relative)
      }}>
      <Icon
        icon="lucide:git-compare"
        className="size-3.5"
      />
      工作区
    </Button>
  )
}

function WriteToolCard(props: ToolCallMessagePartProps & { outputText: string }) {
  const { rootPath } = useActiveWorkspace()
  const label = toAgentToolLabel(props.toolName)
  const writePath = findWritePath(props.args)
  const relativePath = useMemo(
    function () {
      if (!writePath) return null
      return normalizeToolPath(writePath, rootPath)
    },
    [writePath, rootPath]
  )
  // 同步首屏用本地 LCS，Tauri 下异步升级到 Rust lineDiff
  const toolArgs = props.args as unknown
  const [codeDiff, updateCodeDiff] = useState<WriteCodeDiff | null>(function () {
    return parseWriteCodeDiff(toolArgs)
  })
  useEffect(
    function () {
      updateCodeDiff(parseWriteCodeDiff(toolArgs))
      let cancelled = false
      void fetchWriteCodeDiff(toolArgs)
        .then(function (next) {
          if (!cancelled) updateCodeDiff(next)
        })
        .catch(function (error: unknown) {
          console.warn('[agent] fetchWriteCodeDiff 失败，保留同步 diff:', error)
        })
      return function () {
        cancelled = true
      }
    },
    [toolArgs]
  )

  // 按块审阅：只对「整文件 before/after」有意义。片段级改动（old_string / new_string）
  // 与「写入后又被改过」的文件，都会在打开审阅 / 落盘前被磁盘内容比对拒掉。
  const review = useMemo(
    function () {
      return parseWriteReview(toolArgs)
    },
    [toolArgs]
  )
  const [reviewing, updateReviewing] = useState<WriteReview | null>(null)
  // 改动正文默认折叠：只留一行「文件名 + +N −M + 动作」，大 diff 不进布局；要看再手动展开
  const [isDiffOpen, setDiffOpen] = useState(false)
  const [decisions, updateDecisions] = useState<Record<string, HunkDecision>>({})
  const [isApplying, updateApplying] = useState(false)
  // 应用过审阅结果后，卡上这份 diff 就不再等于磁盘内容 —— 关掉审阅入口，避免再点一次拿到误导性的报错
  const [appliedCount, updateAppliedCount] = useState(0)
  // 连点保护：isApplying 是异步状态，同一 tick 的两次点击都能穿过 state 判断
  const applyingRef = useRef(false)
  const absolutePath = useMemo(
    function () {
      if (!rootPath || !relativePath) return null
      return joinPath(rootPath, relativePath)
    },
    [rootPath, relativePath]
  )
  const canReview = Boolean(
    review &&
    absolutePath &&
    appliedCount === 0 &&
    !props.isError &&
    props.status?.type === 'complete'
  )

  async function openReview() {
    if (!review || !absolutePath) return
    try {
      const current = await readCodeFile(absolutePath)
      if (!isSameText(current, review.after)) {
        toast.error(
          normalizeEol(current).includes(normalizeEol(review.after))
            ? '这是片段级改动，没法逐块保留'
            : '这次写入之后文件又变了，无法按块保留'
        )
        return
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '读不到这个文件')
      return
    }
    updateDecisions({})
    updateReviewing(review)
  }

  async function applyReview() {
    if (!reviewing || !absolutePath || applyingRef.current) return
    applyingRef.current = true
    updateApplying(true)
    try {
      const current = await readCodeFile(absolutePath)
      if (!isSameText(current, reviewing.after)) {
        toast.error('审阅期间文件被改过了，请重新打开审阅')
        updateReviewing(null)
        return
      }
      const next = rebuildReviewedText(reviewing, decisions)
      if (isSameText(next, current)) {
        toast.message('没有丢弃任何块，文件保持原样')
        updateReviewing(null)
        return
      }
      await writeCodeFile(absolutePath, next)
      bumpWorkspaceRevision()
      const kept = reviewing.hunks.filter(function (hunk) {
        return (decisions[hunk.id] ?? 'pending') !== 'discarded'
      }).length
      toast.success(`已保留 ${kept} / ${reviewing.hunks.length} 块改动`)
      updateAppliedCount(kept)
      updateReviewing(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '写入失败')
    } finally {
      applyingRef.current = false
      updateApplying(false)
    }
  }

  if (reviewing) {
    const hunks = reviewing.hunks.map(function (hunk) {
      return {
        id: hunk.id,
        range: hunk.range,
        lines: hunk.lines,
        decision: decisions[hunk.id] ?? 'pending'
      }
    })
    return (
      <div
        data-slot="agent-write-review"
        className="my-1 flex flex-col gap-1.5">
        <ReviewableDiff
          filename={reviewing.fileName}
          hunks={hunks}
          onKeep={function (id) {
            updateDecisions(function (prev) {
              return { ...prev, [id]: 'kept' }
            })
          }}
          onDiscard={function (id) {
            updateDecisions(function (prev) {
              return { ...prev, [id]: 'discarded' }
            })
          }}
          onUndo={function (id) {
            updateDecisions(function (prev) {
              return { ...prev, [id]: 'pending' }
            })
          }}
          onApply={function () {
            void applyReview()
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs">
            只保留选中的块，其余改动还原
          </span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="text-muted-foreground hover:text-foreground h-6 gap-1 px-1.5 font-normal"
            disabled={isApplying}
            onClick={function () {
              updateReviewing(null)
            }}>
            <Icon
              icon="lucide:arrow-left"
              className="size-3"
            />
            返回对比
          </Button>
        </div>
      </div>
    )
  }

  if (!codeDiff) {
    return (
      <ToolFallback.Root className="my-1 mb-0">
        <ToolFallback.Trigger
          toolName={label}
          status={props.status}
          title={props.toolName}
        />
        <ToolFallback.Content>
          <ToolFallback.Error status={props.status} />
          <ToolFallback.Args argsText={props.argsText ?? JSON.stringify(props.args, null, 2)} />
          {props.outputText ? (
            <CodeBlock
              code={props.outputText}
              language="markdown"
              showHeader={false}
              contentClassName="max-h-[min(36vh,20rem)]"
            />
          ) : (
            <ToolFallback.Result result={props.result} />
          )}
          {relativePath && !props.isError ? (
            <div className="flex justify-end">
              <WorkspaceDiffAction relative={relativePath} />
            </div>
          ) : null}
        </ToolFallback.Content>
      </ToolFallback.Root>
    )
  }

  return (
    <div
      data-slot="agent-write-card"
      className="my-1 flex flex-col gap-1.5">
      <CodeDiff
        filename={codeDiff.filename}
        subtitle={relativePath ?? undefined}
        additions={codeDiff.additions}
        deletions={codeDiff.deletions}
        lines={codeDiff.lines}
        cycle={0}
        expanded={isDiffOpen}
        onToggle={function () {
          setDiffOpen(function (prev) {
            return !prev
          })
        }}
        action={
          canReview || appliedCount > 0 || (relativePath && !props.isError) ? (
            <div className="flex items-center gap-1">
              {appliedCount > 0 ? (
                <span className="text-muted-foreground shrink-0 px-1 text-xs tabular-nums">
                  已保留 {appliedCount} 块
                </span>
              ) : null}
              {canReview ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-foreground h-7 gap-1 rounded-md px-2 text-xs"
                  title="逐块决定保留 / 丢弃，只把保留的改动留在文件里"
                  onClick={function () {
                    void openReview()
                  }}>
                  <Icon
                    icon="lucide:list-checks"
                    className="size-3.5"
                  />
                  审阅
                </Button>
              ) : null}
              {relativePath && !props.isError ? (
                <WorkspaceDiffAction relative={relativePath} />
              ) : null}
            </div>
          ) : undefined
        }
      />
      {props.isError ? (
        <div
          role="alert"
          className="text-destructive border-border/50 bg-muted/40 rounded-md border px-3 py-2 text-xs whitespace-pre-wrap">
          {props.outputText || '执行出错'}
        </div>
      ) : null}
    </div>
  )
}

export { WriteToolCard }
