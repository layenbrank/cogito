import { Icon } from '@iconify/react/offline'
import { useAuiState } from '@assistant-ui/react'
import { Badge } from '@cogito/design/components/badge'
import { Button } from '@cogito/design/components/button'
import { invoke } from '@tauri-apps/api/core'
import { clsx } from 'clsx'
import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { collectToolPaths } from '@/features/agent/tool-paths.ts'
import { readApprovalMode, findApprovalPolicy } from '@/features/agent/approval.ts'
import type { PlanSnapshot } from '@/features/agent/plan'
import { useActiveWorkspace } from '@/features/agent/workspace/active.ts'
import { CHANNELS } from '@/shared/ipc/channels'
import { useProviderStore } from '@/stores/provider'

interface AsideBusyProps {
  plan: PlanSnapshot | null
  onOpenFiles: (relative?: string | null) => void
  onOpenReview: (relative?: string | null) => void
}

interface ProbeR {
  isRepo: boolean
  branch: string | null
}

const STATUS_LABEL = {
  pending: '待办',
  in_progress: '进行中',
  completed: '完成'
} as const

function statusOf(status: string | undefined): keyof typeof STATUS_LABEL {
  if (status === 'in_progress' || status === 'completed') return status
  return 'pending'
}

function truncatePath(path: string, max = 42) {
  if (path.length <= max) return path
  return `…${path.slice(-(max - 1))}`
}

function findBaseName(relative: string) {
  const slash = relative.lastIndexOf('/')
  return slash < 0 ? relative : relative.slice(slash + 1)
}

function Section(props: { icon: string; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-border/70 flex flex-col gap-2 border-b px-3 py-3 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs font-medium">
          <Icon
            icon={props.icon}
            className="size-3.5 shrink-0"
          />
          <span className="truncate">{props.title}</span>
        </div>
        {props.action}
      </div>
      {props.children}
    </section>
  )
}

/** 计划条目：状态徐标 + 完成态删除线 */
function PlanEntryList(props: { entries: NonNullable<AsideBusyProps['plan']>['entries'] }) {
  return (
    <ol className="flex flex-col gap-1.5">
      {props.entries.map(function (entry) {
        const status = statusOf(entry.status)
        return (
          <li
            key={`${status}-${entry.content}`}
            className="flex items-start gap-2">
            <Badge
              variant={
                status === 'completed'
                  ? 'secondary'
                  : status === 'in_progress'
                    ? 'default'
                    : 'outline'
              }
              className="mt-0.5 shrink-0">
              {STATUS_LABEL[status]}
            </Badge>
            <span
              className={clsx(
                'text-xs leading-snug',
                status === 'completed' && 'text-muted-foreground line-through'
              )}>
              {entry.content}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/** 会话分区：最后一条用户消息的摘要 + 模型/审批徐标 */
function SessionSection(props: {
  updatedLabel: string | null
  summary: string
  modelLabel: string
  approvalLabel: string
}) {
  return (
    <Section
      icon="lucide:message-square"
      title={props.updatedLabel ? `更新于 ${props.updatedLabel}` : '会话'}>
      <p className="text-muted-foreground text-xs leading-relaxed">{props.summary}</p>
      <div className="text-muted-foreground flex flex-wrap gap-2 text-xs">
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
      </div>
    </Section>
  )
}

/** 工作区分区：主路径、git 分支与附加目录 */
function WorkspaceSection(props: {
  title: string
  primaryPath: string | null
  probe: ProbeR | null
  extraFolders: ReadonlyArray<{ id: string; path: string }>
  onBrowse: () => void
}) {
  const branch = props.probe?.isRepo ? props.probe.branch : null
  return (
    <Section
      icon="lucide:folder"
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
        title={props.primaryPath ?? undefined}>
        {props.title}
      </p>
      {props.primaryPath ? (
        <p
          className="text-muted-foreground truncate text-xs"
          title={props.primaryPath}>
          {truncatePath(props.primaryPath)}
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

/** 产出分区：本会话改过的文件，点开可预览 / 对比 */
function OutputSection(props: {
  paths: readonly string[]
  onOpenFile: (relative: string) => void
  onOpenReview: () => void
}) {
  return (
    <Section
      icon="lucide:package"
      title={props.paths.length > 0 ? `产出（${props.paths.length}）` : '产出'}
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
      {props.paths.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {props.paths.map(function (path) {
            return (
              <li key={path}>
                <Button
                  type="button"
                  variant="ghost"
                  className="text-foreground h-auto w-full justify-start gap-1.5 px-1.5 py-1 text-xs font-normal"
                  title={path}
                  onClick={function () {
                    props.onOpenFile(path)
                  }}>
                  <Icon
                    icon="lucide:file-pen-line"
                    className="text-muted-foreground size-3.5 shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate text-start">{findBaseName(path)}</span>
                  <span className="text-muted-foreground max-w-[40%] truncate text-[10px]">
                    {path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''}
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

/** 来源分区：已引用的文件名列表 + 文件树入口 */
function SourcesSection(props: {
  names: readonly string[]
  onBrowse: () => void
  onOpenFile: (name: string) => void
}) {
  return (
    <Section
      icon="lucide:paperclip"
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
        <ul className="flex flex-col gap-0.5">
          {props.names.map(function (name) {
            return (
              <li key={name}>
                <Button
                  type="button"
                  variant="ghost"
                  className="text-foreground h-auto w-full justify-start gap-1.5 px-1.5 py-1 text-xs font-normal"
                  title={name}
                  onClick={function () {
                    props.onOpenFile(name)
                  }}>
                  <Icon
                    icon="lucide:file"
                    className="text-muted-foreground size-3.5 shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate text-start">{name}</span>
                </Button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-muted-foreground text-xs">暂无来源，点 + 打开文件树</p>
      )}
    </Section>
  )
}

/** 已对话右栏：上下文分区 */
function AsideBusy(props: AsideBusyProps) {
  const { workspace, primaryPath, folders } = useActiveWorkspace()
  const [probeState, updateProbe] = useState<ProbeR | null>(null)
  /** 没有工作区时一律按「无仓库」渲染：不在 effect 里同步清 state */
  const probe = primaryPath ? probeState : null
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

  const outputPaths = useMemo(
    function () {
      return collectToolPaths(messages, primaryPath)
        .map(function (hit) {
          return hit.path
        })
        .slice(0, 24)
    },
    [messages, primaryPath]
  )

  useEffect(
    function () {
      if (!primaryPath) return
      let cancelled = false
      void invoke<ProbeR>(CHANNELS.WORKSPACE_GIT.PROBE, { params: { path: primaryPath } })
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
    [primaryPath]
  )

  const plan = props.plan
  const extraFolders = folders.filter(function (folder) {
    return !folder.isPrimary
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <SessionSection
        updatedLabel={updatedLabel}
        summary={summary}
        modelLabel={activeProvider?.model?.trim() || '未选模型'}
        approvalLabel={approval?.label ?? '询问审批'}
      />

      <WorkspaceSection
        title={workspace?.title ?? '未选择工作区'}
        primaryPath={primaryPath}
        probe={probe}
        extraFolders={extraFolders}
        onBrowse={function () {
          props.onOpenFiles()
        }}
      />

      <Section
        icon="lucide:list-todo"
        title={plan && plan.total > 0 ? `计划（${plan.done}/${plan.total}）` : '计划'}>
        {plan && plan.entries.length > 0 ? (
          <PlanEntryList entries={plan.entries} />
        ) : (
          <p className="text-muted-foreground text-xs">代理规划出执行步骤后会显示在这里</p>
        )}
      </Section>

      <OutputSection
        paths={outputPaths}
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
