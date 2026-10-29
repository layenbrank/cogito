/**
 * 扩展 section：全局 MCP 扩展配置（`config/extensions/*`）+ 当前会话启停（`session/extensions/*`）。
 *
 * 全局配置写进 goose 的 config，**新会话**才带上；已开会话的扩展集合另外维护，所以这里两段
 * 并排：上面改配置，下面改当前会话。所有写操作都走同一条 ACP 通道，成功后按 goose 的返回
 * 重新拉取（不猜 goose 侧算出来的 key）。
 */
import type { ClientConnection } from '@agentclientprotocol/sdk'
import { Badge } from '@cogito/design/components/badge'
import { Button } from '@cogito/design/components/button'
import { Spinner } from '@cogito/design/components/spinner'
import { Switch } from '@cogito/design/components/switch'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { findAcpHandle } from '@/features/agent/acp/connection'
import {
  addSessionExtension,
  fetchConfigExtensions,
  fetchSessionExtensions,
  removeConfigExtension,
  removeSessionExtension,
  setConfigExtensionEnabled
} from '@/features/agent/acp/goose-extensions'
import { findThreadAcpSessionID, waitGooseReady } from '@/features/agent/acp/session'
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

function ExtensionsSection() {
  const activeSessionID = useAgentStore(function (state) {
    return state.activeSessionID
  })
  const acpSessionID = activeSessionID ? findThreadAcpSessionID(activeSessionID) : null

  const [entries, updateEntries] = useState<ExtensionEntry[]>([])
  const [warnings, updateWarnings] = useState<string[]>([])
  const [sessionEntries, updateSessionEntries] = useState<SessionExtensionEntry[]>([])
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
          if (!cancelled) updateSessionEntries(inSession)
        } catch (error) {
          console.warn('[settings/extensions] 加载扩展失败:', error)
          if (cancelled) return
          updateEntries([])
          updateWarnings([])
          updateSessionEntries([])
        } finally {
          if (!cancelled) updateLoading(false)
        }
      }
      void load()
      return function () {
        cancelled = true
      }
    },
    [acpSessionID, revision]
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
      return setConfigExtensionEnabled(connection, key, next)
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

  return (
    <div className="flex flex-col gap-6">
      {warnings.length ? (
        <ul className="flex flex-col gap-1 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {warnings.map(function (warning) {
            return <li key={warning}>{warning}</li>
          })}
        </ul>
      ) : null}

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <span
            className="text-muted-foreground cursor-help text-xs underline decoration-dotted decoration-muted-foreground/40 underline-offset-2"
            title="全局配置对新会话生效；已开会话请在下面单独加入">
            全局扩展
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={function () {
              updateAdding(true)
            }}>
            添加扩展
          </Button>
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
          <p className="text-muted-foreground py-2 text-sm">暂无扩展</p>
        ) : (
          <ul className="flex flex-col">
            {entries.map(function (entry) {
              const key = findExtensionKey(entry)
              const busy = busyKey === key
              const inSession = sessionKeysSet.has(key)
              return (
                <li
                  key={key}
                  className="flex items-start justify-between gap-4 border-b border-border/60 py-3 last:border-b-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {findExtensionName(entry.extension)}
                      </span>
                      <Badge variant="secondary">{EXTENSION_TYPE_LABELS[entry.extension.type]}</Badge>
                      {inSession ? <Badge variant="outline">会话中</Badge> : null}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {describeExtension(entry.extension)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {acpSessionID && !inSession ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={function () {
                          void addToSession(entry)
                        }}>
                        加入会话
                      </Button>
                    ) : null}
                    <Switch
                      size="sm"
                      checked={entry.enabled}
                      disabled={busy}
                      onCheckedChange={function () {
                        void toggleEnabled(entry)
                      }}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
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

      <div className="flex flex-col gap-3">
        <span className="text-xs text-muted-foreground">当前会话</span>
        {!acpSessionID ? (
          <p className="py-2 text-sm text-muted-foreground">
            打开一个会话后才能查看和调整会话内扩展。
          </p>
        ) : sessionEntries.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">当前会话没有加载任何扩展。</p>
        ) : (
          <ul className="flex flex-col">
            {sessionEntries.map(function (entry) {
              return (
                <li
                  key={entry.extensionKey}
                  className="flex items-start justify-between gap-4 border-b border-border/60 py-3 last:border-b-0">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {findExtensionName(entry.extension)}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {describeExtension(entry.extension)}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
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
  )
}

export { ExtensionsSection }
