/**
 * MCP config dialog（对齐 assistant-ui `elements/mcp-config`）
 *
 * 一个弹窗装完 MCP 的全部开关：应用预置的**连接器**一节、用户自己加的**自定义
 * 服务器**一节，加上「Add server」入口与就地展开的添加表单。每张服务器卡给头像、
 * 名称、状态徽标与动作，连不上时补一条错误横幅 —— 这些事实全由宿主给，组件只负
 * 责画与转发动作。
 *
 * 元素本体是收费产物，结构 / 状态 / 无障碍按官网渲染出的 DOM 与 `.md` 契约自写：
 * - 动作按状态出现：Connect 只在「还没连上」（needs-auth / failed），Disconnect 只在
 *   「连着或正在连」（connected / connecting）；两者不会同时出现在一张卡上；
 * - 有 `authorizationUrl` 就渲染 Authorize 链接（新标签页打开），没有就不假造入口；
 * - 每张卡带一个 `role="status"` 的视觉隐藏区，只播报**挂载之后**的状态变化与新错误，
 *   打开时的初始状态不吵读屏；
 * - `failed` 的卡额外加失败色边框，这一档不靠徽标小字提示。
 *
 * 与 `mcp-server-panel` 的分工：那个是「一眼看清谁连上了、带了哪些工具」的清单；本元素
 * 是「配置」——连接、断开、授权、移除、添加。两者共用 `mcp-config-state` 的状态折叠。
 */
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'

import {
  canConnect,
  canDisconnect,
  isMcpServerFailed,
  type McpServerStatus,
  type McpServerView
} from './mcp-config-state'
import { field, ghostButton, paper } from './elements/surfaces'
import { useAssistantLabels } from './labels'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger
} from '../components/dialog'

/** 卡片上的状态徽标配色（比面板的圆点更显性，文字必须同时在场） */
const MCP_STATUS_BADGE_CLASS: Record<McpServerStatus, string> = {
  connected: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 forced-colors:border',
  connecting: 'bg-foreground/[0.06] text-muted-foreground forced-colors:border',
  'needs-auth': 'bg-amber-500/15 text-amber-700 dark:text-amber-400 forced-colors:border',
  failed: 'bg-destructive/10 text-destructive forced-colors:border'
}

const CARD_ACTION_CLASS = cn(ghostButton, 'h-7 px-2.5 text-xs font-medium whitespace-nowrap')

interface McpServerCardProps extends Omit<ComponentProps<'div'>, 'children'> {
  server: McpServerView
  /** 连接器没有「移除」：那是应用预置的，删了下次还会回来 */
  kind?: 'connector' | 'custom'
  /** 该卡的动作用中（防止连点） */
  pending?: boolean
  onConnect?: (server: McpServerView) => void
  onDisconnect?: (server: McpServerView) => void
  onRemove?: (server: McpServerView) => void
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

function McpServerCard({
  server,
  kind = 'custom',
  pending = false,
  onConnect,
  onDisconnect,
  onRemove,
  className,
  ...props
}: McpServerCardProps) {
  const labels = useAssistantLabels()
  const failed = isMcpServerFailed(server)
  const statusLabel = findStatusLabel(labels, server.status)

  // 只播报挂载之后的状态变化：打开弹窗时的现状不该被再念一遍
  const [announcement, updateAnnouncement] = useState('')
  const previous = useRef({ status: server.status, error: server.error ?? null })

  useEffect(
    function () {
      const last = previous.current
      previous.current = { status: server.status, error: server.error ?? null }
      if (last.status === server.status && last.error === (server.error ?? null)) return
      updateAnnouncement(
        server.error && failed
          ? `${server.name}: ${statusLabel} — ${server.error}`
          : `${server.name}: ${statusLabel}`
      )
    },
    [failed, server.error, server.name, server.status, statusLabel]
  )

  return (
    <div
      data-slot="mcp-server-card"
      data-server-id={server.id}
      data-kind={kind}
      data-state={server.status}
      data-has-error={server.error ? '' : undefined}
      className={cn(
        'flex flex-col gap-2 rounded-xl border px-3 py-2.5',
        failed ? 'border-destructive/40' : 'border-border/60',
        className
      )}
      {...props}>
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="bg-foreground/[0.05] text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-lg">
          <Icon
            icon="lucide:plug"
            className="size-3.5"
          />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">{server.name}</span>
        <span
          data-slot="mcp-server-card-status"
          className={cn(
            'shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium',
            MCP_STATUS_BADGE_CLASS[server.status]
          )}>
          {statusLabel}
        </span>
      </div>

      {server.error ? (
        <p
          data-slot="mcp-server-card-error"
          className="border-destructive/20 bg-destructive/5 text-destructive rounded-lg border px-2.5 py-1.5 text-xs leading-relaxed break-words">
          {server.error}
        </p>
      ) : null}

      <div
        data-slot="mcp-server-card-actions"
        className="flex flex-wrap items-center justify-end gap-1">
        {canConnect(server.status) && onConnect ? (
          <button
            type="button"
            data-slot="mcp-server-card-connect"
            disabled={pending}
            className={CARD_ACTION_CLASS}
            onClick={function () {
              onConnect(server)
            }}>
            {labels.mcpConnect}
          </button>
        ) : null}
        {server.authorizationUrl ? (
          <a
            data-slot="mcp-server-card-authorize"
            href={server.authorizationUrl}
            target="_blank"
            rel="noreferrer"
            className={CARD_ACTION_CLASS}>
            {labels.mcpAuthorize}
          </a>
        ) : null}
        {canDisconnect(server.status) && onDisconnect ? (
          <button
            type="button"
            data-slot="mcp-server-card-disconnect"
            disabled={pending}
            className={CARD_ACTION_CLASS}
            onClick={function () {
              onDisconnect(server)
            }}>
            {labels.mcpDisconnect}
          </button>
        ) : null}
        {kind === 'custom' && onRemove ? (
          <button
            type="button"
            data-slot="mcp-server-card-remove"
            disabled={pending}
            className={CARD_ACTION_CLASS}
            onClick={function () {
              onRemove(server)
            }}>
            {labels.mcpRemove}
          </button>
        ) : null}
      </div>

      <span
        data-slot="mcp-server-card-announcement"
        role="status"
        aria-live="polite"
        className="sr-only">
        {announcement}
      </span>
    </div>
  )
}

interface McpConfigBodyProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** 应用预置的连接器（不能移除，只能连接 / 断开） */
  connectors: readonly McpServerView[]
  /** 用户自己加的服务器 */
  servers: readonly McpServerView[]
  onConnect?: (server: McpServerView) => void
  onDisconnect?: (server: McpServerView) => void
  onRemove?: (server: McpServerView) => void
  /** 有了表单就点开就地展开；没有就交给宿主（跳设置页 / 另开弹窗） */
  onAddServer?: () => void
  /** 返回添加表单节点；`close` 收起这段内联表单 */
  renderAddForm?: (close: () => void) => ReactNode
  /** 该卡动作用中 */
  pendingId?: string | null
  /** 标题 / 说明的替换节点：弹窗里换成 base-ui 的 Title，把标题接进 aria */
  title?: ReactNode
  description?: ReactNode
  className?: string
}

function McpConfigBody({
  connectors,
  servers,
  onConnect,
  onDisconnect,
  onRemove,
  onAddServer,
  renderAddForm,
  pendingId,
  title,
  description,
  className,
  ...props
}: McpConfigBodyProps) {
  const labels = useAssistantLabels()
  const [adding, updateAdding] = useState(false)

  function closeAddForm() {
    updateAdding(false)
  }

  return (
    <div
      data-slot="mcp-config-body"
      className={cn('flex flex-col', className)}
      {...props}>
      <div data-slot="mcp-config-heading">
        {title ?? <h4 className="text-sm font-semibold">{labels.mcpConfigTitle}</h4>}
        {description ?? (
          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
            {labels.mcpConfigDescription}
          </p>
        )}
      </div>

      <div className="mt-5 flex flex-col gap-4">
        <section
          data-slot="mcp-config-connectors"
          className="flex flex-col">
          <p className="text-xs font-medium">{labels.mcpConnectors}</p>
          {connectors.length === 0 ? (
            <div
              data-slot="mcp-config-connectors-empty"
              className="text-muted-foreground mt-2 flex items-center gap-2 rounded-lg border border-dashed px-3 py-3 text-xs">
              <Icon
                icon="lucide:plug"
                aria-hidden
                className="size-3.5"
              />
              {labels.mcpNoConnectors}
            </div>
          ) : (
            <div className="mt-2 flex flex-col gap-2">
              {connectors.map(function (connector) {
                return (
                  <McpServerCard
                    key={connector.id}
                    server={connector}
                    kind="connector"
                    pending={pendingId === connector.id}
                    onConnect={onConnect}
                    onDisconnect={onDisconnect}
                  />
                )
              })}
            </div>
          )}
        </section>

        <section
          data-slot="mcp-config-servers"
          className="border-border/60 flex flex-col border-t pt-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs font-medium">{labels.mcpCustomServers}</p>
            {renderAddForm || onAddServer ? (
              <button
                type="button"
                data-slot="mcp-config-add-server"
                aria-expanded={renderAddForm ? adding : undefined}
                className="hover:bg-accent inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors motion-reduce:transition-none"
                onClick={function () {
                  if (!renderAddForm) {
                    onAddServer?.()
                    return
                  }
                  updateAdding(function (prev) {
                    return !prev
                  })
                }}>
                <Icon
                  icon="lucide:plus"
                  aria-hidden
                  className="size-3.5"
                />
                {labels.mcpAddServer}
              </button>
            ) : null}
          </div>

          {servers.length > 0 ? (
            <div className="mt-2 flex flex-col gap-2">
              {servers.map(function (server) {
                return (
                  <McpServerCard
                    key={server.id}
                    server={server}
                    pending={pendingId === server.id}
                    onConnect={onConnect}
                    onDisconnect={onDisconnect}
                    onRemove={onRemove}
                  />
                )
              })}
            </div>
          ) : null}

          {renderAddForm && adding ? (
            <div
              data-slot="mcp-config-add-form"
              className={cn(field, 'mt-3 rounded-xl p-3')}>
              {renderAddForm(closeAddForm)}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}

interface McpConfigDialogProps extends Omit<McpConfigBodyProps, 'title' | 'description'> {
  /** 自定义触发器；不给就渲染元素页那个描边按钮（plug + 「MCP servers」） */
  children?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** 弹窗宽度等外壳样式 */
  contentClassName?: string
}

function McpConfigDialog({
  children,
  open,
  onOpenChange,
  contentClassName,
  ...body
}: McpConfigDialogProps) {
  const labels = useAssistantLabels()

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}>
      <DialogTrigger
        data-slot="mcp-config-trigger"
        className="hover:bg-accent inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors motion-reduce:transition-none">
        {children ?? (
          <>
            <Icon
              icon="lucide:plug"
              aria-hidden
              className="size-3.5"
            />
            {labels.mcpConfigTitle}
          </>
        )}
      </DialogTrigger>
      <DialogContent
        data-slot="mcp-config-dialog"
        className={cn('max-w-lg', contentClassName)}>
        <McpConfigBody
          {...body}
          title={
            <DialogTitle className="text-sm font-semibold">{labels.mcpConfigTitle}</DialogTitle>
          }
          description={
            <DialogDescription className="text-muted-foreground mt-1 text-xs leading-relaxed">
              {labels.mcpConfigDescription}
            </DialogDescription>
          }
        />
      </DialogContent>
    </Dialog>
  )
}

/** 内嵌到设置页的同一套内容（元素页之外最常见的用法：不带弹窗外壳） */
function McpConfigCard(props: McpConfigBodyProps) {
  return (
    <div
      data-slot="mcp-config-card"
      className={cn(paper, 'w-full max-w-lg rounded-2xl border p-5 shadow-sm')}>
      <McpConfigBody {...props} />
    </div>
  )
}

export { McpConfigBody, McpConfigCard, McpConfigDialog, McpServerCard }
export type { McpConfigBodyProps, McpConfigDialogProps, McpServerCardProps }
