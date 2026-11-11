/**
 * Server panel（对齐 assistant-ui `elements/mcp-server-panel`）
 *
 * 「哪些服务器连上了、各自带了什么、哪个还在等我」的一张清单：每行收起时只有
 * 名称、工具数与一个状态圆点，展开才给传输形态与工具名。表头只数真正连上的
 * （`2 of 3 connected`），没连上的行不给「假装能用」的工具徽标。
 *
 * 纯受控展示：服务器快照、授权动作都由宿主给。展开状态按行自己管（默认全收起），
 * 所以可以同时展开多行 —— 元素页明确这样约定。`onAuthorize` 不给时，needs-auth 行
 * 只显示状态，不渲染点了没反应的按钮。
 *
 * 圆点四档来自 `mcp-config-state`：connected 绿、connecting 呼吸、needs-auth 琥珀、
 * failed 红；每档都配一条 `sr-only` 文案，读屏不靠颜色判断状态。
 */
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { useState, type ComponentProps } from 'react'

import type { McpServerStatus, McpServerView } from './mcp-config-state'
import { field, paper } from './elements/surfaces'
import { useAssistantLabels } from './labels'

/** 四档圆点的配色；connecting 走呼吸动画，减弱动效时静止 */
const MCP_STATUS_DOT_CLASS: Record<McpServerStatus, string> = {
  connected: 'bg-emerald-500',
  connecting: 'bg-foreground/25 animate-pulse motion-reduce:animate-none',
  'needs-auth': 'bg-amber-500',
  failed: 'bg-destructive'
}

interface McpServerPanelProps extends Omit<ComponentProps<'div'>, 'children' | 'onSelect'> {
  /** 服务器快照，顺序即渲染顺序 */
  servers: readonly McpServerView[]
  /** 待授权行的授权动作；不给就只显示状态 */
  onAuthorize?: (server: McpServerView) => void
  /** 初始展开的行（id）；不给全收起 */
  defaultOpenIds?: readonly string[]
  className?: string
}

function findStatusLabel(
  labels: ReturnType<typeof useAssistantLabels>,
  status: McpServerStatus
): string {
  switch (status) {
    case 'connected':
      return labels.mcpStatusConnected
    case 'connecting':
      return labels.mcpStatusConnecting
    case 'needs-auth':
      return labels.mcpStatusNeedsAuth
    case 'failed':
      return labels.mcpStatusFailed
  }
}

function McpServerPanel({
  servers,
  onAuthorize,
  defaultOpenIds,
  className,
  ...props
}: McpServerPanelProps) {
  const labels = useAssistantLabels()
  const [openIds, updateOpenIds] = useState<ReadonlySet<string>>(function () {
    return new Set(defaultOpenIds ?? [])
  })

  const connected = servers.filter(function (server) {
    return server.status === 'connected'
  }).length

  function toggle(id: string) {
    updateOpenIds(function (prev) {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div
      data-slot="mcp-server-panel"
      className={cn(paper, 'flex w-full max-w-sm flex-col gap-1 rounded-2xl p-3', className)}
      {...props}>
      <div
        data-slot="mcp-server-panel-header"
        className="flex items-baseline justify-between px-1 pb-1">
        <span className="text-sm font-medium">{labels.mcpServersTitle}</span>
        <span
          data-slot="mcp-server-panel-count"
          className="text-muted-foreground font-mono text-xs tracking-tight tabular-nums">
          {labels.mcpConnectedCount(connected, servers.length)}
        </span>
      </div>

      {servers.map(function (server) {
        const open = openIds.has(server.id)
        const tools = server.tools ?? []
        return (
          <div
            key={server.id}
            data-slot="mcp-server-row"
            data-server-id={server.id}
            data-state={server.status}
            className="flex flex-col">
            <button
              type="button"
              aria-expanded={open}
              data-slot="mcp-server-row-trigger"
              className="hover:bg-foreground/[0.04] flex items-center gap-2.5 rounded-xl px-1.5 py-2 text-start transition-colors motion-reduce:transition-none"
              onClick={function () {
                toggle(server.id)
              }}>
              <Icon
                icon="lucide:chevron-right"
                aria-hidden
                className={cn(
                  'text-muted-foreground size-3 shrink-0 transition-transform duration-200 motion-reduce:transition-none',
                  open && 'rotate-90'
                )}
              />
              <Icon
                icon="lucide:plug"
                aria-hidden
                className="text-muted-foreground size-3.5 shrink-0"
              />
              <span className="min-w-0 flex-1 truncate text-sm">{server.name}</span>
              <span className="text-muted-foreground shrink-0 font-mono text-xs tracking-tight">
                {labels.mcpToolCount(tools.length)}
              </span>
              <span
                aria-hidden
                className={cn(
                  'size-1.5 shrink-0 rounded-full forced-color-adjust-none',
                  MCP_STATUS_DOT_CLASS[server.status]
                )}
              />
              <span className="sr-only">{findStatusLabel(labels, server.status)}</span>
            </button>

            {open ? (
              <div
                data-slot="mcp-server-row-detail"
                className="animate-in fade-in slide-in-from-top-1 flex flex-col gap-1.5 px-1.5 ps-8 pb-2 duration-200 motion-reduce:animate-none">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground font-mono text-xs tracking-tight">
                    {server.transport}
                  </span>
                  <span
                    aria-hidden
                    className="text-muted-foreground font-mono text-xs tracking-tight">
                    ·
                  </span>
                  <span className="text-muted-foreground font-mono text-xs tracking-tight">
                    {findStatusLabel(labels, server.status)}
                  </span>
                  {server.status === 'needs-auth' && onAuthorize ? (
                    <button
                      type="button"
                      data-slot="mcp-server-row-authorize"
                      className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 transition-opacity duration-150 hover:opacity-80 motion-reduce:transition-none dark:text-amber-400"
                      onClick={function () {
                        onAuthorize(server)
                      }}>
                      {labels.mcpAuthorize}
                    </button>
                  ) : null}
                </div>

                {tools.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {tools.map(function (tool) {
                      return (
                        <span
                          key={tool}
                          data-slot="mcp-server-tool"
                          className={cn(
                            field,
                            'text-muted-foreground rounded-md px-1.5 py-0.5 font-mono text-xs tracking-tight'
                          )}>
                          {tool}
                        </span>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

export { McpServerPanel, MCP_STATUS_DOT_CLASS }
export type { McpServerPanelProps }
