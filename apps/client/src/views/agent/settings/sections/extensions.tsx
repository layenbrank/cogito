/**
 * 扩展 section：全局 MCP 扩展配置（`config/extensions/*`）+ 当前会话启停（`session/extensions/*`）。
 *
 * 全局配置写进 goose 的 config，**新会话**才带上；已开会话的扩展集合另外维护，所以这里两段
 * 并排：上面改配置，下面改当前会话。所有写操作都走同一条 ACP 通道，成功后按 goose 的返回
 * 重新拉取（不猜 goose 侧算出来的 key）。
 *
 * 最上面还有一段「内置服务器」：`local` / `corex` 是随会话用 ACP `mcpServers` 挂上去的，
 * **不是** goose 扩展，所以下面两段永远看不到它们 —— 不给这卡，用户看到的就是
 * 「工具能用，扩展页里却没有」，只能去查错地方。内置服务器只读，不给删除 / 停用。
 */
import type { ClientConnection } from '@agentclientprotocol/sdk'
import { Icon } from '@iconify/react/offline'
import { Badge } from '@cogito/design/components/badge'
import { Button } from '@cogito/design/components/button'
import { Spinner } from '@cogito/design/components/spinner'
import { Switch } from '@cogito/design/components/switch'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { findAcpHandle } from '@/features/agent/port/agentd-connection'
import {
  addSessionExtension,
  fetchConfigExtensions,
  fetchSessionExtensions,
  removeConfigExtension,
  removeSessionExtension,
  writeConfigExtensionEnabled
} from '@/features/agent/acp/goose-extensions'
import { findThreadAcpSessionID, waitGooseReady } from '@/features/agent/port/session'
import { findSessionMcpStatus, type SessionMcpStatus } from '@/features/agent/acp/session-mcp'
import {
  describeExtension,
  EXTENSION_TYPE_LABELS,
  findExtensionKey,
  findExtensionName,
  type ExtensionEntry,
  type SessionExtensionEntry
} from '@/features/agent/model/extension'
import { useAgentStore } from '@/stores/agent'
import { ExtensionForm } from './extension-form'

type ActionOutcome = { ok: true } | { ok: false }

/**
 * 内置服务器那一行的小字：工具数 / 命令路径 / 没接入的原因。
 *
 * 三种「没接入」必须分开说，否则用户只会得到一个笼统的「未接入」：
 * 自己关掉的（设置）、挂上了但起不来（工具数为 0）、本会话压根没注入。
 */
function findBuiltinStatusNote(status: SessionMcpStatus): string {
  if (!status.isEnabled) return '已在设置中关闭，本会话不会接入它'
  if (!status.isMounted) return '本会话没有接入；新开一个会话，或到诊断页查看原因'
  if (status.tools.length === 0) return '已接入，但还没读到它的工具；到诊断页查看工具面'
  const command = status.command ? ` · ${status.command}` : ''
  return `${status.tools.length} 个工具可用${command}`
}

function ExtensionsSection() {
  const activeSessionID = useAgentStore(function (state) {
    return state.activeSessionID
  })
  const acpSessionID = activeSessionID ? findThreadAcpSessionID(activeSessionID) : null

  const [entries, updateEntries] = useState<ExtensionEntry[]>([])
  const [warnings, updateWarnings] = useState<string[]>([])
  const [sessionEntries, updateSessionEntries] = useState<SessionExtensionEntry[]>([])
  const [builtinStatuses, updateBuiltinStatuses] = useState<SessionMcpStatus[]>([])
  const [loading, updateLoading] = useState(false)
  const [busyKey, updateBusyKey] = useState<string | null>(null)
  const [isAdding, updateAdding] = useState(false)
  const [revision, updateRevision] = useState(0)

  useEffect(
    function () {
      let cancelled = false
      async function load() {
        try {
          updateLoading(true)
          await waitGooseReady()
          const handle = await findAcpHandle()
          const snapshot = await fetchConfigExtensions(handle.connection)
          if (cancelled) return
          updateEntries(snapshot.extensions)
          updateWarnings(snapshot.warnings)

          const inSession = acpSessionID
            ? await fetchSessionExtensions(handle.connection, acpSessionID)
            : []
          if (cancelled) return
          updateSessionEntries(inSession)
          // 内置服务器：只要知道会话就查（没接上会话也要能看到「本会话未挂上」）
          if (activeSessionID) {
            const statuses = await findSessionMcpStatus(activeSessionID)
            if (!cancelled) updateBuiltinStatuses(statuses)
          } else if (!cancelled) {
            updateBuiltinStatuses([])
          }
        } catch (error) {
          console.warn('[settings/extensions] 加载扩展失败:', error)
          if (cancelled) return
          updateEntries([])
          updateWarnings([])
          updateSessionEntries([])
          updateBuiltinStatuses([])
        } finally {
          if (!cancelled) updateLoading(false)
        }
      }
      void load()
      return function () {
        cancelled = true
      }
    },
    [acpSessionID, activeSessionID, revision]
  )

  /** 所有写操作的公共路径：等 goose 就绪 → 拿连接 → 执行 → 报错兜底 */
  async function runExtensionAction(
    key: string,
    task: (connection: ClientConnection) => Promise<unknown>
  ): Promise<ActionOutcome> {
    updateBusyKey(key)
    try {
      await waitGooseReady()
      const handle = await findAcpHandle()
      await task(handle.connection)
      return { ok: true }
    } catch (error) {
      console.warn('[settings/extensions] 扩展操作失败:', error)
      toast.error(error instanceof Error ? error.message : '扩展操作失败')
      return { ok: false }
    } finally {
      updateBusyKey(null)
    }
  }

  async function toggleEnabled(entry: ExtensionEntry) {
    const key = findExtensionKey(entry)
    const next = !entry.enabled
    const former = entries
    // 乐观切换，失败再回滚；成功后按 goose 的返回重新拉取
    updateEntries(function (prev) {
      return prev.map(function (item) {
        return item === entry ? { ...item, enabled: next } : item
      })
    })
    const outcome = await runExtensionAction(key, function (connection) {
      return writeConfigExtensionEnabled(connection, key, next)
    })
    if (!outcome.ok) {
      updateEntries(former)
      return
    }
    updateRevision(function (value) {
      return value + 1
    })
  }

  async function removeEntry(entry: ExtensionEntry) {
    const key = findExtensionKey(entry)
    const outcome = await runExtensionAction(key, function (connection) {
      return removeConfigExtension(connection, key)
    })
    if (!outcome.ok) return
    toast.success(`${findExtensionName(entry.extension)} 已移除`)
    updateRevision(function (value) {
      return value + 1
    })
  }

  async function addToSession(entry: ExtensionEntry) {
    if (!acpSessionID) return
    const key = findExtensionKey(entry)
    const outcome = await runExtensionAction(key, function (connection) {
      // 原样回传：goose 只接受已存好的密钥，重建对象会丢掉 `envKeys` 之外的字段
      return addSessionExtension(connection, acpSessionID, entry.extension)
    })
    if (!outcome.ok) return
    updateRevision(function (value) {
      return value + 1
    })
  }

  async function removeFromSession(entry: SessionExtensionEntry) {
    if (!acpSessionID) return
    const outcome = await runExtensionAction(entry.extensionKey, function (connection) {
      return removeSessionExtension(connection, acpSessionID, entry.extensionKey)
    })
    if (!outcome.ok) return
    updateRevision(function (value) {
      return value + 1
    })
  }

  const sessionKeys = sessionEntries.map(function (item) {
    return item.extensionKey
  })
  const sessionKeysSet = new Set(sessionKeys)

  /**
   * 卡片语言对齐 assistant-ui `elements/mcp-config`：
   * 一张 `rounded-2xl border p-5 shadow-sm` 的卡，上面「已接入本会话」（Connectors），
   * 下面用一条 `border-t` 切出「自定义服务器」并放 Add server 按钮，
   * 每个服务器一行 `rounded-xl border` 小卡（图标块 + 名称 + 状态 + 动作）。
   * 数据仍然是本仓的扩展快照（全局配置 / 会话内），只有外壳换成元素页那套。
   */
  return (
    <div className="bg-background flex w-full max-w-lg flex-col rounded-2xl border p-5 shadow-sm">
      <div data-slot="mcp-config-heading">
        <h4 className="text-sm font-semibold">MCP 服务器</h4>
        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
          把服务器接上，助手就能用它们的工具。全局配置对新会话生效；当前会话要用的，加进来才算。
        </p>
      </div>

      <div className="mt-5 flex flex-col gap-4">
      {warnings.length ? (
        <ul className="mt-4 flex flex-col gap-1 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {warnings.map(function (warning) {
            return <li key={warning}>{warning}</li>
          })}
        </ul>
      ) : null}

      <div
        data-slot="mcp-config-builtin"
        className="flex flex-col">
        <p
          className="text-xs font-medium"
          title="随应用安装，不能删除或停用">
          内置服务器
        </p>
        {builtinStatuses.length === 0 ? (
          <div className="text-muted-foreground mt-2 flex items-center gap-2 rounded-lg border border-dashed px-3 py-3 text-xs">
            <Icon
              icon="lucide:plug"
              aria-hidden
              className="size-3.5"
            />
            打开一个会话后，这里显示它们在本会话的接入情况
          </div>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {builtinStatuses.map(function (status) {
              return (
                <li
                  key={status.name}
                  data-slot="mcp-server-card"
                  data-state={status.isMounted ? 'connected' : 'needs-auth'}
                  className="border-border/60 flex flex-col gap-2 rounded-xl border px-3 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <span
                      aria-hidden
                      className="bg-foreground/5 text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-lg">
                      <Icon
                        icon={status.name === 'local' ? 'lucide:hard-drive' : 'lucide:boxes'}
                        className="size-3.5"
                      />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">{status.label}</span>
                    <Badge variant="outline">内置</Badge>
                    <Badge variant={status.isMounted ? 'secondary' : 'outline'}>
                      {status.isMounted ? '已接入本会话' : '未接入'}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground truncate text-xs leading-relaxed">
                    {status.hint}
                  </p>
                  <p className="text-muted-foreground truncate text-xs leading-relaxed">
                    {findBuiltinStatusNote(status)}
                  </p>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div
        data-slot="mcp-config-servers"
        className="flex flex-col">
        <div className="flex items-center justify-between gap-4">
          <p
            className="text-xs font-medium"
            title="全局配置对新会话生效；当前会话要用的在下面加入">
            自定义服务器
          </p>
          <button
            type="button"
            data-slot="mcp-config-add-server"
            className="hover:bg-accent inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors motion-reduce:transition-none"
            onClick={function () {
              updateAdding(true)
            }}>
            <Icon
              icon="lucide:plus"
              aria-hidden
              className="size-3.5"
            />
            添加服务器
          </button>
        </div>

        {isAdding ? (
          <ExtensionForm
            onSaved={function () {
              updateAdding(false)
              updateRevision(function (value) {
                return value + 1
              })
            }}
            onCancel={function () {
              updateAdding(false)
            }}
          />
        ) : null}

        {loading && entries.length === 0 ? (
          <div className="flex justify-center py-6">
            <Spinner className="size-5" />
          </div>
        ) : entries.length === 0 ? (
          <div className="text-muted-foreground mt-2 flex items-center gap-2 rounded-lg border border-dashed px-3 py-3 text-xs">
            <Icon
              icon="lucide:plug"
              aria-hidden
              className="size-3.5"
            />
            还没有配置任何服务器
          </div>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {entries.map(function (entry) {
              const key = findExtensionKey(entry)
              const busy = busyKey === key
              const inSession = sessionKeysSet.has(key)
              return (
                <li
                  key={key}
                  data-slot="mcp-server-card"
                  data-state={entry.enabled ? 'connected' : 'needs-auth'}
                  className="border-border/60 flex flex-col gap-2 rounded-xl border px-3 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <span
                      aria-hidden
                      className="bg-foreground/5 text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-lg">
                      <Icon
                        icon="lucide:plug"
                        className="size-3.5"
                      />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {findExtensionName(entry.extension)}
                    </span>
                    <Badge variant="secondary">{EXTENSION_TYPE_LABELS[entry.extension.type]}</Badge>
                    {inSession ? <Badge variant="outline">会话中</Badge> : null}
                    <Switch
                      size="sm"
                      aria-label={`启用 ${findExtensionName(entry.extension)}`}
                      checked={entry.enabled}
                      disabled={busy}
                      onCheckedChange={function () {
                        void toggleEnabled(entry)
                      }}
                    />
                  </div>
                  <p className="text-muted-foreground truncate text-xs leading-relaxed">
                    {describeExtension(entry.extension)}
                  </p>
                  <div className="flex flex-wrap items-center justify-end gap-1">
                    {acpSessionID && !inSession ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2.5 text-xs font-medium"
                        disabled={busy}
                        onClick={function () {
                          void addToSession(entry)
                        }}>
                        加入会话
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2.5 text-xs font-medium"
                      disabled={busy}
                      onClick={function () {
                        void removeEntry(entry)
                      }}>
                      移除
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div
        data-slot="mcp-config-connectors"
        className="border-border/60 flex flex-col border-t pt-4">
        <p className="text-xs font-medium">已接入本会话</p>
        {!acpSessionID ? (
          <div className="text-muted-foreground mt-2 flex items-center gap-2 rounded-lg border border-dashed px-3 py-3 text-xs">
            <Icon
              icon="lucide:plug"
              aria-hidden
              className="size-3.5"
            />
            打开一个会话后，才能把服务器接进来
          </div>
        ) : sessionEntries.length === 0 ? (
          <div className="text-muted-foreground mt-2 flex items-center gap-2 rounded-lg border border-dashed px-3 py-3 text-xs">
            <Icon
              icon="lucide:plug"
              aria-hidden
              className="size-3.5"
            />
            本会话还没有接入任何服务器
          </div>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {sessionEntries.map(function (entry) {
              return (
                <li
                  key={entry.extensionKey}
                  data-slot="mcp-server-card"
                  data-state="connected"
                  className="border-border/60 flex items-center gap-2.5 rounded-xl border px-3 py-2.5">
                  <span
                    aria-hidden
                    className="bg-foreground/5 text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-lg">
                    <Icon
                      icon="lucide:plug"
                      className="size-3.5"
                    />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {findExtensionName(entry.extension)}
                  </span>
                  <span
                    aria-hidden
                    className="size-1.5 shrink-0 rounded-full bg-emerald-500 forced-color-adjust-none"
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2.5 text-xs font-medium"
                    disabled={busyKey === entry.extensionKey}
                    onClick={function () {
                      void removeFromSession(entry)
                    }}>
                    移出会话
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      </div>
    </div>
  )
}

export { ExtensionsSection }
