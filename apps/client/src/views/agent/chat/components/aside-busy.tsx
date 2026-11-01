import { Icon } from '@iconify/react/offline'
import { useAuiState } from '@assistant-ui/react'
import { Source, Sources, SourcesContent, SourcesTrigger } from '@cogito/design/assistant/sources'
import { TodoList } from '@cogito/design/assistant/todo-list'
import { Button } from '@cogito/design/components/button'
import { invoke } from '@tauri-apps/api/core'
import { clsx } from 'clsx'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { toast } from 'sonner'

import { collectToolPaths } from '@/features/agent/tool-paths.ts'
import { readApprovalMode, findApprovalPolicy } from '@/features/agent/approval.ts'
import { findAgentMode, readAgentMode, subscribeAgentMode } from '@/features/agent/mode.ts'
import { savePlanToWorkspace } from '@/features/agent/plan-file'
import type { PlanSnapshot } from '@/features/agent/plan'
import { findPlanDraft } from '@/features/agent/plan-draft'
import { useActiveWorkspace } from '@/features/agent/workspace/active.ts'
import { useWorkspaceRevision } from '@/features/agent/workspace/revision.ts'
import {
  findGooseUsage,
  formatGooseUsage,
  subscribeGooseUsage
} from '@/features/agent/acp/goose-usage'
import { CHANNELS } from '@/shared/ipc/channels'
import { useProviderStore } from '@/stores/provider'
import { findStatusBadge, groupEntries } from '@/views/code/lib/git-status.ts'
import { useAsideReviewStatus } from '@/views/agent/chat/components/use-aside-review-status'

interface AsideOutputRow {
  path: string
  /** git 状态徽标（M/A/D/R）；仅工具触及、尚未进 git 感知时为空 */
  badge: string | null
}

interface AsideBusyProps {
  plan: PlanSnapshot | null
  onOpenFiles: (relative?: string | null) => void
  onOpenReview: (relative?: string | null) => void
  /** 当前会话是否处于「计划」模式：空态文案据此区分 */
  isPlanMode: boolean
}

interface ProbeR {
  isRepo: boolean
  branch: string | null
}

function truncatePath(path: string, max = 42) {
  if (path.length <= max) return path
  return `…${path.slice(-(max - 1))}`
}

function findBaseName(relative: string) {
  const slash = relative.lastIndexOf('/')
  return slash < 0 ? relative : relative.slice(slash + 1)
}

function Section(props: {
  icon: string
  /** 图标点缀色；缺省跟随 muted */
  iconClass?: string
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="border-border/70 flex flex-col gap-2 border-b px-3 py-3 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs font-medium">
          <Icon
            icon={props.icon}
            className={clsx('size-3.5 shrink-0', props.iconClass ?? 'text-muted-foreground')}
          />
          <span className="truncate">{props.title}</span>
        </div>
        {props.action}
      </div>
      {props.children}
    </section>
  )
}

/** 计划条目：状态图标 + 完成态删除线（与 goose 的 plan 事件同形） */
function PlanEntryList(props: { entries: NonNullable<AsideBusyProps['plan']>['entries'] }) {
  const items = useMemo(
    function () {
      return props.entries.map(function (entry) {
        return { content: entry.content, status: entry.status }
      })
    },
    [props.entries]
  )
  return <TodoList items={items} />
}

/** 会话分区：最后一条用户消息的摘要 + 模型/审批/运行态徐标 */
function SessionSection(props: {
  updatedLabel: string | null
  summary: string
  modelLabel: string
  approvalLabel: string
  modeLabel: string
  modeIcon: string
  messageCount: number
  toolCount: number
  usageLabel: string | null
  isRunning: boolean
}) {
  return (
    <Section
      icon="lucide:message-square"
      iconClass="text-primary"
      title={props.updatedLabel ? `更新于 ${props.updatedLabel}` : '会话'}>
      <p className="text-muted-foreground text-xs leading-relaxed">{props.summary}</p>
      <div className="text-muted-foreground flex flex-wrap gap-2 text-xs">
        <span className="bg-muted inline-flex items-center gap-1 rounded-md px-1.5 py-0.5">
          <Icon
            icon={props.modeIcon}
            className="size-3"
          />
          {props.modeLabel}模式
        </span>
        <span className="bg-muted inline-flex items-center gap-1 rounded-md px-1.5 py-0.5">
          <Icon
            icon="lucide:box"
            className="size-3"
          />
          {props.modelLabel}
        </span>
        <span className="bg-muted inline-flex items-center gap-1 rounded-md px-1.5 py-0.5">
          <Icon
            icon="lucide:circle-check"
            className="size-3"
          />
          {props.approvalLabel}
        </span>
        <span className="bg-muted inline-flex items-center gap-1 rounded-md px-1.5 py-0.5">
          <Icon
            icon={props.isRunning ? 'lucide:loader-circle' : 'lucide:circle-dot'}
            className={clsx('size-3', props.isRunning && 'animate-spin')}
          />
          {props.isRunning ? '运行中' : '空闲'}
        </span>
        <span className="bg-muted inline-flex items-center gap-1 rounded-md px-1.5 py-0.5">
          <Icon
            icon="lucide:messages-square"
            className="size-3"
          />
          {props.messageCount} 条消息
        </span>
        {props.toolCount > 0 ? (
          <span className="bg-muted inline-flex items-center gap-1 rounded-md px-1.5 py-0.5">
            <Icon
              icon="lucide:wrench"
              className="size-3"
            />
            {props.toolCount} 次工具调用
          </span>
        ) : null}
        {props.usageLabel ? (
          <span className="bg-muted inline-flex items-center gap-1 rounded-md px-1.5 py-0.5">
            <Icon
              icon="lucide:database"
              className="size-3"
            />
            {props.usageLabel}
          </span>
        ) : null}
      </div>
    </Section>
  )
}

/** 工作区分区：根路径、git 分支与附加目录 */
function WorkspaceSection(props: {
  title: string
  rootPath: string | null
  probe: ProbeR | null
  extraFolders: ReadonlyArray<{ id: string; path: string }>
  onBrowse: () => void
}) {
  const branch = props.probe?.isRepo ? props.probe.branch : null
  return (
    <Section
      icon="lucide:folder"
      iconClass="text-amber-500"
      title="工作区"
      action={
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="浏览文件树"
          title="浏览文件树"
          className="size-6"
          onClick={props.onBrowse}>
          <Icon
            icon="lucide:folder-tree"
            className="size-3.5"
          />
        </Button>
      }>
      <p
        className="text-foreground truncate text-xs font-medium"
        title={props.rootPath ?? undefined}>
        {props.title}
      </p>
      {props.rootPath ? (
        <p
          className="text-muted-foreground truncate text-xs"
          title={props.rootPath}>
          {truncatePath(props.rootPath)}
        </p>
      ) : null}
      <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1">
          <Icon
            icon="lucide:monitor"
            className="size-3"
          />
          本地
        </span>
        {branch ? (
          <span className="inline-flex items-center gap-1">
            <Icon
              icon="lucide:git-branch"
              className="size-3"
            />
            {branch}
          </span>
        ) : null}
      </div>
      {props.extraFolders.length > 0 ? (
        <ul className="text-muted-foreground mt-1 space-y-0.5 text-xs">
          {props.extraFolders.slice(0, 4).map(function (folder) {
            return (
              <li
                key={folder.id}
                className="truncate"
                title={folder.path}>
                {truncatePath(folder.path, 36)}
              </li>
            )
          })}
        </ul>
      ) : null}
    </Section>
  )
}

/** 产出分区：本会话改过的文件（带 git 状态徐标），点开可对比 */
function OutputSection(props: {
  rows: readonly AsideOutputRow[]
  onOpenFile: (relative: string) => void
  onOpenReview: () => void
}) {
  return (
    <Section
      icon="lucide:package"
      iconClass="text-emerald-500"
      title={props.rows.length > 0 ? `产出（${props.rows.length}）` : '产出'}
      action={
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="打开审阅"
          title="打开审阅"
          className="size-6"
          onClick={props.onOpenReview}>
          <Icon
            icon="lucide:git-compare"
            className="size-3.5"
          />
        </Button>
      }>
      {props.rows.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {props.rows.map(function (row) {
            return (
              <li key={row.path}>
                <Button
                  type="button"
                  variant="ghost"
                  className="text-foreground h-auto w-full justify-start gap-2 px-1.5 py-1.5 text-[13px] leading-snug font-normal"
                  title={row.path}
                  onClick={function () {
                    props.onOpenFile(row.path)
                  }}>
                  <span
                    className={clsx(
                      'w-3.5 shrink-0 text-center font-mono text-xs font-semibold',
                      row.badge ? 'text-primary' : 'text-muted-foreground'
                    )}>
                    {row.badge ?? '·'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-start">{findBaseName(row.path)}</span>
                  <span className="text-muted-foreground max-w-[40%] truncate text-xs">
                    {row.path.includes('/') ? row.path.slice(0, row.path.lastIndexOf('/')) : ''}
                  </span>
                </Button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-muted-foreground text-xs">代理改写文件后会显示在这里</p>
      )}
    </Section>
  )
}

/** 来源分区：Elements Sources + 文件树入口 */
function SourcesSection(props: {
  names: readonly string[]
  onBrowse: () => void
  onOpenFile: (name: string) => void
}) {
  return (
    <Section
      icon="lucide:paperclip"
      iconClass="text-sky-500"
      title="来源"
      action={
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="从文件树添加"
          title="从文件树添加"
          className="size-6"
          onClick={props.onBrowse}>
          <Icon
            icon="lucide:plus"
            className="size-3.5"
          />
        </Button>
      }>
      {props.names.length > 0 ? (
        <Sources
          defaultOpen
          className="text-foreground mb-0">
          <SourcesTrigger
            count={props.names.length}
            className="text-muted-foreground hover:text-foreground">
            <p className="font-medium">{`已引用 ${props.names.length} 个来源`}</p>
            <Icon
              icon="lucide:chevron-down"
              className="size-3.5"
            />
          </SourcesTrigger>
          <SourcesContent className="mt-2 w-full">
            {props.names.map(function (name) {
              return (
                <Source
                  key={name}
                  href={`#${encodeURIComponent(name)}`}
                  title={name}
                  className="text-foreground hover:bg-muted/60 flex w-full items-center justify-start gap-2 rounded-md px-1.5 py-1.5 text-[13px] leading-snug no-underline"
                  onClick={function (event) {
                    event.preventDefault()
                    props.onOpenFile(name)
                  }}>
                  <Icon
                    icon="lucide:file"
                    className="text-muted-foreground size-3.5 shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate text-start">{name}</span>
                </Source>
              )
            })}
          </SourcesContent>
        </Sources>
      ) : (
        <p className="text-muted-foreground text-xs">暂无来源</p>
      )}
    </Section>
  )
}

/** 计划草稿：只给清单速览，调整请回对话、「开始执行」在「计划」页签 */
function PlanDraftBlock(props: { steps: readonly string[] }) {
  return (
    <TodoList
      items={props.steps.map(function (step) {
        return { content: step, status: 'pending' as const }
      })}
    />
  )
}

/** 已对话右栏：上下文分区 */
function AsideBusy(props: AsideBusyProps) {
  const { workspace, rootPath, folders } = useActiveWorkspace()
  const [probeState, updateProbe] = useState<ProbeR | null>(null)
  /** 没有工作区时一律按「无仓库」渲染：不在 effect 里同步清 state */
  const probe = rootPath ? probeState : null
  const providers = useProviderStore(function (state) {
    return state.providers
  })
  const activeProviderID = useProviderStore(function (state) {
    return state.activeProviderID
  })
  const activeProvider = providers.find(function (provider) {
    return provider.id === activeProviderID && provider.enabled
  })
  const approval = findApprovalPolicy(readApprovalMode())
  const agentModeKey = useSyncExternalStore(subscribeAgentMode, readAgentMode, readAgentMode)
  const agentMode = findAgentMode(agentModeKey)

  const messages = useAuiState(function (state) {
    return state.thread.messages
  })
  const composerAttachments = useAuiState(function (state) {
    return state.composer.attachments
  })

  const summary = useMemo(
    function () {
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i]
        if (message.role !== 'user') continue
        const text = message.content
          .filter(function (part) {
            return part.type === 'text'
          })
          .map(function (part) {
            return part.type === 'text' ? part.text : ''
          })
          .join('')
          .trim()
        if (text) return text.length > 80 ? `${text.slice(0, 80)}…` : text
      }
      return '进行中'
    },
    [messages]
  )

  const updatedLabel = useMemo(
    function () {
      const last = messages[messages.length - 1]
      const createdAt = last?.createdAt
      if (!createdAt) return null
      const date = createdAt instanceof Date ? createdAt : new Date(createdAt)
      if (Number.isNaN(date.getTime())) return null
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    },
    [messages]
  )

  const sourceNames = useMemo(
    function () {
      const names: string[] = []
      for (const attachment of composerAttachments) {
        if (attachment.name) names.push(attachment.name)
      }
      for (const message of messages) {
        if (message.role !== 'user') continue
        for (const part of message.content) {
          if (part.type === 'file' && part.filename) names.push(part.filename)
          if (part.type === 'image' && 'filename' in part && part.filename) {
            names.push(String(part.filename))
          }
        }
      }
      return [...new Set(names)].slice(0, 12)
    },
    [composerAttachments, messages]
  )

  const isRunning = useAuiState(function (state) {
    return state.thread.isRunning
  })
  const revision = useWorkspaceRevision()
  const mainThreadID = useAuiState(function (state) {
    return state.threads.mainThreadId
  })
  const usage = useSyncExternalStore(
    subscribeGooseUsage,
    function () {
      return findGooseUsage(mainThreadID)
    },
    function () {
      return findGooseUsage(mainThreadID)
    }
  )
  const toolCount = useMemo(
    function () {
      let count = 0
      for (const message of messages) {
        for (const part of message.content) {
          if (part.type === 'tool-call') count += 1
        }
      }
      return count
    },
    [messages]
  )
  // git status 只在「跑完一轮」后重查：运行中频繁查没意义，列表也会闪
  const [statusKey, updateStatusKey] = useState(0)
  const wasRunning = useRef(isRunning)
  useEffect(
    function () {
      if (wasRunning.current && !isRunning) {
        updateStatusKey(function (value) {
          return value + 1
        })
      }
      wasRunning.current = isRunning
    },
    [isRunning]
  )
  const status = useAsideReviewStatus(rootPath, statusKey, revision)

  const badgeByPath = useMemo(
    function () {
      const map = new Map<string, string | null>()
      const groups = groupEntries(status.entries)
      for (const entry of [...groups.staged, ...groups.changed, ...groups.untracked]) {
        if (map.has(entry.path)) continue
        map.set(entry.path, findStatusBadge(entry))
      }
      return map
    },
    [status.entries]
  )

  const outputs = useMemo(
    function () {
      return collectToolPaths(messages, rootPath)
        .map(function (hit) {
          return { path: hit.path, badge: badgeByPath.get(hit.path) ?? null }
        })
        .slice(0, 24)
    },
    [messages, rootPath, badgeByPath]
  )

  /** goose 没发 `plan` 事件时，从正文编号列表抽一份草稿，避免右侧空白 */
  const planDraft = useMemo(
    function () {
      if (props.plan && props.plan.entries.length > 0) return null
      return findPlanDraft(messages)
    },
    [messages, props.plan]
  )

  useEffect(
    function () {
      if (!rootPath) return
      let cancelled = false
      void invoke<ProbeR>(CHANNELS.WORKSPACE_GIT.PROBE, { params: { path: rootPath } })
        .then(function (result) {
          if (!cancelled) updateProbe(result)
        })
        .catch(function () {
          if (!cancelled) updateProbe(null)
        })
      return function () {
        cancelled = true
      }
    },
    [rootPath]
  )

  const plan = props.plan
  const extraFolders = folders.slice(1)

  /** 两份来源归一：保存与展示用同一串步骤 */
  const planSteps = useMemo(
    function () {
      if (plan && plan.entries.length > 0) {
        return plan.entries.map(function (entry) {
          return entry.content
        })
      }
      return planDraft?.steps ?? []
    },
    [plan, planDraft]
  )

  async function handleSavePlan() {
    if (!rootPath) {
      toast.error('先在左栏添加一个工作区')
      return
    }
    try {
      const relative = await savePlanToWorkspace(rootPath, {
        title: planDraft?.title || workspace?.title || '计划',
        overview: planDraft?.overview ?? '',
        steps: planSteps,
        body: planDraft?.body ?? ''
      })
      toast.success(`计划已保存到 ${relative}`)
    } catch (error) {
      console.warn('[agent/aside] 保存计划失败:', error)
      toast.error(error instanceof Error ? error.message : '保存计划失败')
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <SessionSection
        updatedLabel={updatedLabel}
        summary={summary}
        modelLabel={activeProvider?.model?.trim() || '未选模型'}
        approvalLabel={approval?.label ?? '询问审批'}
        modeLabel={agentMode.label}
        modeIcon={agentMode.icon}
        messageCount={messages.length}
        toolCount={toolCount}
        usageLabel={usage && usage.size > 0 ? formatGooseUsage(usage) : null}
        isRunning={isRunning}
      />

      <WorkspaceSection
        title={workspace?.title ?? '未选择工作区'}
        rootPath={rootPath}
        probe={probe}
        extraFolders={extraFolders}
        onBrowse={function () {
          props.onOpenFiles()
        }}
      />

      <Section
        icon="lucide:list-todo"
        iconClass="text-violet-500"
        title={
          plan && plan.total > 0
            ? `计划（${plan.done}/${plan.total}）`
            : planDraft
              ? `计划草稿（${planDraft.steps.length}）`
              : '计划'
        }
        action={
          planSteps.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="保存计划到工作区"
              title="保存到 .cogito/plans"
              className="size-6"
              onClick={function () {
                void handleSavePlan()
              }}>
              <Icon
                icon="lucide:save"
                className="size-3.5"
              />
            </Button>
          ) : undefined
        }>
        {plan && plan.entries.length > 0 ? (
          <PlanEntryList entries={plan.entries} />
        ) : planDraft ? (
          <PlanDraftBlock steps={planDraft.steps} />
        ) : (
          <p className="text-muted-foreground text-xs">
            {props.isPlanMode ? '发出需求后，模型产出的计划会显示在这里' : '暂无计划'}
          </p>
        )}
      </Section>

      <OutputSection
        rows={outputs}
        onOpenFile={function (relative) {
          props.onOpenReview(relative)
        }}
        onOpenReview={function () {
          props.onOpenReview()
        }}
      />

      <SourcesSection
        names={sourceNames}
        onBrowse={function () {
          props.onOpenFiles()
        }}
        onOpenFile={function (name) {
          props.onOpenFiles(name)
        }}
      />
    </div>
  )
}

export { AsideBusy }
