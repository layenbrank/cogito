import { Icon } from '@iconify/react/offline'
import { useAuiState } from '@assistant-ui/react'
import { Badge } from '@i-thinking/design/components/badge'
import { Button } from '@i-thinking/design/components/button'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

import { formatDurationText, useRunClock } from '@/features/agent/duration.ts'
import {
  collectReferences,
  findLastActivityAt,
  findRunPhase,
  summarizeToolCalls
} from '@/features/agent/insight.ts'
import { findLatestPlan, type PlanItem } from '@/features/agent/plan.ts'
import { useActiveWorkspace, useActiveWorkspaceID } from '@/features/agent/workspace/client.ts'
import { findApprovalPolicy } from '@/features/chat/approval.ts'
import { findPlatformBlocker } from '@/features/chat/platform.ts'
import { findTargetLabel } from '@/features/chat/port/model.ts'
import { useProviders } from '@/features/chat/provider/query.ts'
import { useSessionID, useThreadKey } from '@/features/chat/session.ts'
import { useAgentStore } from '@/stores/agent.ts'
import { AsideChanges } from './aside-changes.tsx'
import {
  AsideCard,
  AsideCopy,
  AsideHint,
  AsideRow
} from './aside-ui.tsx'
import { AsideQuota, AsideUsage } from './aside-usage.tsx'
import { useAsidePanel } from './use-aside-panel.ts'
import { formatDateTime } from '@/views/agent/settings/components/format.ts'

/**
 * 右栏 —— 任务详情。
 *
 * 这是**当前会话这一份任务的状态面板**，对齐 Qoder「任务详情」与 Cursor 的会话边栏：
 * 运行阶段与耗时、计划、变更（可审阅可撤销）、引用与工具、用量与额度、模型与权限、
 * 工作区、会话信息。数据全部就地派生自线程消息、本机账本与平台接口 —— 不另存一份快照，
 * 否则「哪份是真的」迟早要打架。
 *
 * 分工（配置类动作不在这里）：换工作区在左栏，换模型 / 审批在输入区右下角，完整配置在设置页。
 * 这里额外提供「运行产物的撤销」：改文件是本会话干的，撤销点放在能看见完整清单的地方。
 *
 * 三个用量口径必须各自标名，否则读的人会把它们当同一个数：本机账本（重启不清零）、
 * 平台额度（只算平台模型）、消息里标的用量（历史会话的兜底）。
 */

/** 计划条目：状态只用图标表达，勾选交给 Agent —— 本地勾了也会被下一次整份覆盖抹掉 */
function PlanRow(props: { item: PlanItem }) {
  const { item } = props

  return (
    <li className="flex items-start gap-1.5 text-xs leading-relaxed">
      {item.status === 'completed' ? (
        <Icon icon="lucide:circle-check" className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
      ) : (
        <Icon icon="lucide:circle" className="text-muted-foreground/60 mt-0.5 size-3.5 shrink-0" />
      )}
      <span className={item.status === 'completed' ? 'text-muted-foreground' : ''}>
        {item.text}
      </span>
    </li>
  )
}

/** 工具统计最多列几种：种类多了这一屏会变成日志，明细该去看消息流里的工具卡 */
const TOOL_ROW_LIMIT = 6

interface AsideProps {
  onClose?: () => void
}

export default function AgentAside(props: AsideProps) {
  const navigate = useNavigate()
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const { focus, clearFocus } = useAsidePanel()

  const messages = useAuiState(function (state) {
    return state.thread.messages
  })
  const isRunning = useAuiState(function (state) {
    return state.thread.isRunning
  })
  const isLoading = useAuiState(function (state) {
    return state.thread.isLoading
  })

  const sessionID = useSessionID()
  const threadKey = useThreadKey()
  const workspaceID = useActiveWorkspaceID()
  const activeWorkspace = useActiveWorkspace()

  const providerID = useAgentStore(function (state) {
    return state.settings.chat.providerID
  })
  const model = useAgentStore(function (state) {
    return state.settings.chat.model
  })
  const approval = useAgentStore(function (state) {
    return state.settings.chat.approval
  })
  const durationFormat = useAgentStore(function (state) {
    return state.settings.chat.durationFormat
  })

  const providersQuery = useProviders()
  const providers = providersQuery.data ?? []

  const clock = useRunClock(isRunning, threadKey)

  const phase = useMemo(
    function () {
      return findRunPhase(messages, isRunning)
    },
    [messages, isRunning]
  )
  const plan = useMemo(
    function () {
      return findLatestPlan(messages)
    },
    [messages]
  )
  const references = useMemo(
    function () {
      return collectReferences(messages)
    },
    [messages]
  )
  const tools = useMemo(
    function () {
      return summarizeToolCalls(messages)
    },
    [messages]
  )
  const lastActivityAt = useMemo(
    function () {
      return findLastActivityAt(messages)
    },
    [messages]
  )

  // 生效目标从发送链路那份推导里拿，避免右栏说的模型和真正跑的不是同一个
  const target = findTargetLabel(providers, { providerID, model })
  const policy = findApprovalPolicy(approval)

  // 与底栏共用查询键：同一工作区两处只发一次 probe
  const git = useQuery({
    queryKey: ['workspace', 'git', 'probe', workspaceID],
    queryFn: function () {
      return itc.workspace.git.probe({ workspaceID: workspaceID as string })
    },
    enabled: Boolean(workspaceID),
    staleTime: 15_000
  })

  // 段落定位：`open('changes')` 这类调用把焦点交给这里消费，滚完即清，免得下次开栏又跳一次
  useEffect(
    function () {
      if (!focus) return

      const container = bodyRef.current
      const target = container?.querySelector('[data-aside-section="' + focus + '"]')
      if (container && target) {
        container.scrollTo({
          top:
            target.getBoundingClientRect().top -
            container.getBoundingClientRect().top +
            container.scrollTop,
          behavior: 'smooth'
        })
      }
      clearFocus()
    },
    [focus, clearFocus]
  )

  const otherFolders = (activeWorkspace?.folders ?? []).filter(function (folder) {
    return !folder.isPrimary
  })

  return (
    <aside
      data-slot="agent-aside"
      className="bg-sidebar flex h-full min-h-0 flex-col">
      <header className="border-border bg-background flex h-10 shrink-0 items-center justify-between gap-2 border-b px-3">
        <span className="text-sm font-medium">任务详情</span>

        {props.onClose ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground size-7 rounded-md"
            aria-label="关闭任务详情"
            title="关闭任务详情"
            onClick={props.onClose}>
            <Icon icon="lucide:x" className="size-3.5" />
          </Button>
        ) : null}
      </header>

      <div
        ref={bodyRef}
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2.5">
        <AsideCard
          id="run"
          label="运行">
          <AsideRow label="状态">
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                data-running={isRunning ? 'true' : 'false'}
                className="bg-muted-foreground data-[running=true]:bg-success size-1.5 rounded-full"
              />
              {isLoading ? '加载中…' : phase.label}
            </span>
          </AsideRow>

          {clock.elapsedMs !== null ? (
            <AsideRow label="已用时">
              {formatDurationText(clock.elapsedMs, durationFormat)}
            </AsideRow>
          ) : clock.lastRunMs !== null ? (
            <AsideRow label="上一轮耗时">
              {formatDurationText(clock.lastRunMs, durationFormat)}
            </AsideRow>
          ) : null}

          <AsideRow label="消息">{messages.length} 条</AsideRow>
        </AsideCard>

        <AsideCard
          id="plan"
          label="计划"
          count={plan?.total}>
          {plan ? (
            <>
              <AsideRow label="完成">{`${plan.done}/${plan.total}`}</AsideRow>
              <ul className="flex flex-col gap-1">
                {plan.items.map(function (item) {
                  return (
                    <PlanRow
                      key={item.id}
                      item={item}
                    />
                  )
                })}
              </ul>
            </>
          ) : (
            <AsideHint>多步任务会自动写计划。</AsideHint>
          )}
        </AsideCard>

        <AsideChanges
          sessionID={sessionID}
          isRunning={isRunning}
        />

        <AsideCard
          id="references"
          label="引用"
          count={references.length}>
          {references.length === 0 ? (
            <AsideHint>用 @ 引用工作区文件。</AsideHint>
          ) : (
            <ul className="flex flex-col gap-1">
              {references.map(function (name) {
                return (
                  <li
                    key={name}
                    className="flex items-center gap-1.5 text-xs"
                    title={name}>
                    <Icon icon="lucide:file" className="text-muted-foreground size-3.5 shrink-0" />
                    <span className="truncate font-mono">{name}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </AsideCard>

        <AsideCard
          id="tools"
          label="工具调用"
          count={tools.total}>
          {tools.total === 0 ? (
            <AsideHint>本次会话还没有调用工具。</AsideHint>
          ) : (
            <>
              <AsideRow label="失败">
                {tools.failed === 0 ? (
                  '无'
                ) : (
                  <span className="text-destructive">{tools.failed} 次</span>
                )}
              </AsideRow>
              <ul className="flex flex-col gap-1">
                {tools.items.slice(0, TOOL_ROW_LIMIT).map(function (item) {
                  return (
                    <li
                      key={item.name}
                      className="flex items-baseline justify-between gap-2 text-xs leading-5"
                      title={item.name}>
                      <span className="text-muted-foreground truncate">{item.label}</span>
                      <span className="shrink-0 tabular-nums">{item.count} 次</span>
                    </li>
                  )
                })}
              </ul>
              {tools.items.length > TOOL_ROW_LIMIT ? (
                <AsideHint>
                  {`还有 ${tools.items.length - TOOL_ROW_LIMIT} 种，明细看消息流。`}
                </AsideHint>
              ) : null}
            </>
          )}
        </AsideCard>

        <AsideUsage sessionID={sessionID} />

        <AsideQuota />

        <AsideCard
          id="model"
          label="模型与权限">
          {target ? (
            <>
              <p className="flex items-center gap-1.5 text-xs leading-5">
                <span className="min-w-0 break-all">{target.model}</span>
                {target.isAuto ? (
                  <Badge
                    variant="secondary"
                    title="自动：跟随当前可用模型，组织模型优先">
                    自动
                  </Badge>
                ) : null}
              </p>
              <p className="text-muted-foreground text-xs leading-5 break-all">{target.source}</p>
            </>
          ) : (
            <AsideHint>
              {providersQuery.isPending
                ? '正在读取可用模型…'
                : (findPlatformBlocker() ?? '还没有可用模型，去设置里添加。')}
            </AsideHint>
          )}

          <AsideRow
            label="权限"
            title={policy?.hint}>
            {policy?.label ?? '未知档位'}
          </AsideRow>

          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="text-muted-foreground hover:text-foreground self-start"
            onClick={function () {
              void navigate('/agent/settings?section=model')
            }}>
            去设置改模型与权限
          </Button>
        </AsideCard>

        <AsideCard
          id="workspace"
          label="工作区">
          {activeWorkspace ? (
            <>
              <span className="truncate text-xs font-medium">{activeWorkspace.title}</span>

              <div className="flex items-start gap-1">
                <p className="text-muted-foreground min-w-0 flex-1 font-mono text-xs leading-5 break-all">
                  {activeWorkspace.primaryPath ?? '（无源文件夹）'}
                </p>
                <AsideCopy
                  value={activeWorkspace.primaryPath ?? undefined}
                  label="复制工作区路径"
                />
              </div>

              {otherFolders.length > 0 ? (
                <div className="flex flex-col gap-1">
                  <span className="text-muted-foreground text-xs">
                    其它文件夹（{otherFolders.length}）
                  </span>
                  {otherFolders.map(function (folder) {
                    return (
                      <p
                        key={folder.path}
                        className="text-muted-foreground truncate font-mono text-xs leading-5"
                        title={folder.path}>
                        {folder.path}
                      </p>
                    )
                  })}
                </div>
              ) : null}

              {git.data?.isRepo ? (
                <AsideRow
                  label="分支"
                  title={git.data.branch ?? undefined}>
                  {git.data.branch ?? '—'}
                </AsideRow>
              ) : git.isSuccess ? (
                <AsideHint>不是 git 仓库：变更清单仍可看，但没有分支可切。</AsideHint>
              ) : null}
            </>
          ) : (
            <AsideHint>未选择工作区。</AsideHint>
          )}
        </AsideCard>

        <AsideCard
          id="session"
          label="会话">
          {sessionID === null ? (
            <AsideHint>会话落库后才有 id：发一条消息就会生成。</AsideHint>
          ) : (
            <>
              <div className="flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{sessionID}</span>
                <AsideCopy
                  value={sessionID}
                  label="复制会话 id"
                />
              </div>
              <AsideRow label="最后活动">
                {lastActivityAt ? formatDateTime(lastActivityAt.getTime()) : '—'}
              </AsideRow>
            </>
          )}
        </AsideCard>
      </div>
    </aside>
  )
}
