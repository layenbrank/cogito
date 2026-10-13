import { Icon } from '@iconify/react/offline'
import { useAui, useAuiState } from '@assistant-ui/react'
import { Badge } from '@i-thinking/design/components/badge'
import { Button } from '@i-thinking/design/components/button'
import { open as dialogOpen } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { clsx } from 'clsx'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { attachWorkspacePaths } from '@/features/agent/attachment.ts'
import { readApprovalMode, findApprovalPolicy } from '@/features/agent/approval.ts'
import type { PlanSnapshot } from '@/features/agent/plan'
import { useActiveWorkspace } from '@/features/agent/workspace/active.ts'
import { CHANNELS } from '@/shared/ipc/channels'
import { useProviderStore } from '@/stores/provider'

interface AsideBusyProps {
  plan: PlanSnapshot | null
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

function Section(props: {
  icon: string
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

/** 已对话右栏：上下文分区骨架 */
function AsideBusy(props: AsideBusyProps) {
  const aui = useAui()
  const { workspace, primaryPath, folders } = useActiveWorkspace()
  const [probe, updateProbe] = useState<ProbeR | null>(null)
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

  useEffect(
    function () {
      if (!primaryPath) {
        updateProbe(null)
        return
      }
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

  function handleAddSource() {
    void dialogOpen({ multiple: true })
      .then(function (paths) {
        const list = Array.isArray(paths) ? paths : paths ? [paths] : null
        return attachWorkspacePaths(aui, list, primaryPath)
      })
      .then(function (result) {
        if (result.isMissingWorkspace) {
          toast.error('先在左栏添加一个工作区')
          return
        }
        if (result.attached > 0) toast.success(`已引用 ${result.attached} 项`)
        if (result.skipped.length > 0) {
          toast.warning(`${result.skipped.join('、')} 不在当前工作区内，已跳过`)
        }
      })
      .catch(function (error: unknown) {
        toast.error(error instanceof Error ? error.message : '选择文件失败')
      })
  }

  const plan = props.plan
  const extraFolders = folders.filter(function (folder) {
    return !folder.isPrimary
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <Section
        icon="lucide:message-square"
        title={updatedLabel ? `更新于 ${updatedLabel}` : '会话'}>
        <p className="text-muted-foreground text-xs leading-relaxed">{summary}</p>
        <div className="text-muted-foreground flex flex-wrap gap-2 text-xs">
          <span className="bg-muted inline-flex items-center gap-1 rounded-md px-1.5 py-0.5">
            <Icon
              icon="lucide:box"
              className="size-3"
            />
            {activeProvider?.model?.trim() || '未选模型'}
          </span>
          <span className="bg-muted inline-flex items-center gap-1 rounded-md px-1.5 py-0.5">
            <Icon
              icon="lucide:circle-check"
              className="size-3"
            />
            {approval?.label ?? '询问审批'}
          </span>
        </div>
      </Section>

      <Section
        icon="lucide:folder"
        title="工作区">
        <p
          className="text-foreground truncate text-xs font-medium"
          title={primaryPath ?? undefined}>
          {workspace?.title ?? '未选择工作区'}
        </p>
        {primaryPath ? (
          <p
            className="text-muted-foreground truncate text-xs"
            title={primaryPath}>
            {truncatePath(primaryPath)}
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
          {probe?.isRepo && probe.branch ? (
            <span className="inline-flex items-center gap-1">
              <Icon
                icon="lucide:git-branch"
                className="size-3"
              />
              {probe.branch}
            </span>
          ) : null}
        </div>
        {extraFolders.length > 0 ? (
          <ul className="text-muted-foreground mt-1 space-y-0.5 text-xs">
            {extraFolders.slice(0, 4).map(function (folder) {
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

      <Section
        icon="lucide:list-todo"
        title={plan && plan.total > 0 ? `计划（${plan.done}/${plan.total}）` : '计划'}>
        {plan && plan.entries.length > 0 ? (
          <ol className="flex flex-col gap-1.5">
            {plan.entries.map(function (entry, index) {
              const status = statusOf(entry.status)
              return (
                <li
                  key={`${status}-${index}`}
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
        ) : (
          <p className="text-muted-foreground text-xs">代理规划出执行步骤后会显示在这里</p>
        )}
      </Section>

      <Section
        icon="lucide:package"
        title="产出">
        <p className="text-muted-foreground text-xs">暂无产出</p>
      </Section>

      <Section
        icon="lucide:paperclip"
        title="来源"
        action={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="添加来源"
            className="size-6"
            onClick={handleAddSource}>
            <Icon
              icon="lucide:plus"
              className="size-3.5"
            />
          </Button>
        }>
        {sourceNames.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {sourceNames.map(function (name) {
              return (
                <li
                  key={name}
                  className="text-foreground flex items-center gap-1.5 truncate text-xs">
                  <Icon
                    icon="lucide:file"
                    className="text-muted-foreground size-3.5 shrink-0"
                  />
                  <span className="truncate">{name}</span>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground text-xs">暂无来源，点 + 添加文件</p>
        )}
      </Section>
    </div>
  )
}

export { AsideBusy }
