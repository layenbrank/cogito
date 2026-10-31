/**
 * 输入区 `+` → 扩展：直接列出 goose 的扩展并就地开关。
 *
 * 写的是全局配置（`config/extensions/*`），对新会话生效；
 * 已开会话的启停仍按 goose 的语义在设置页里调（`session/extensions/*`）。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Switch } from '@cogito/design/components/switch'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { findAcpHandle } from '@/features/agent/acp/connection'
import {
  fetchConfigExtensions,
  fetchSessionExtensions,
  writeConfigExtensionEnabled
} from '@/features/agent/acp/goose-extensions'
import { findThreadAcpSessionID, waitGooseReady } from '@/features/agent/acp/session'
import {
  EXTENSION_TYPE_LABELS,
  findExtensionKey,
  findExtensionName,
  type ExtensionEntry
} from '@/features/agent/model/extension'
import { useAgentStore } from '@/stores/agent'

function ExtensionsPane(props: { active: boolean; onManage: () => void }) {
  const [entries, updateEntries] = useState<ExtensionEntry[]>([])
  /** 当前会话已加载的 extensionKey；用于区分「仅配置」与「本次可用」 */
  const [sessionKeys, updateSessionKeys] = useState<ReadonlySet<string>>(new Set())
  const [isLoading, updateLoading] = useState(false)
  const [busyKey, updateBusyKey] = useState<string | null>(null)
  const [revision, updateRevision] = useState(0)

  const activeSessionID = useAgentStore(function (state) {
    return state.activeSessionID
  })
  const acpSessionID = activeSessionID ? findThreadAcpSessionID(activeSessionID) : null

  useEffect(
    function () {
      if (!props.active) return
      let cancelled = false
      async function load() {
        try {
          updateLoading(true)
          await waitGooseReady()
          const handle = await findAcpHandle()
          const snapshot = await fetchConfigExtensions(handle.connection)
          const inSession = acpSessionID
            ? await fetchSessionExtensions(handle.connection, acpSessionID)
            : []
          if (cancelled) return
          updateEntries(snapshot.extensions)
          updateSessionKeys(
            new Set(
              inSession.map(function (item) {
                return item.extensionKey
              })
            )
          )
        } catch (error) {
          console.warn('[composer-extensions] 读取扩展失败:', error)
          if (cancelled) return
          updateEntries([])
          updateSessionKeys(new Set())
        } finally {
          if (!cancelled) updateLoading(false)
        }
      }
      void load()
      return function () {
        cancelled = true
      }
    },
    [props.active, acpSessionID, revision]
  )

  async function toggle(entry: ExtensionEntry) {
    const key = findExtensionKey(entry)
    const next = !entry.enabled
    updateBusyKey(key)
    // 乐观切换，失败回滚
    updateEntries(function (prev) {
      return prev.map(function (item) {
        return item === entry ? { ...item, enabled: next } : item
      })
    })
    try {
      await waitGooseReady()
      const handle = await findAcpHandle()
      await writeConfigExtensionEnabled(handle.connection, key, next)
      toast.success(`${next ? '已启用' : '已停用'}「${findExtensionName(entry.extension)}」（新会话生效）`)
    } catch (error) {
      console.warn('[composer-extensions] 切换扩展失败:', error)
      toast.error(error instanceof Error ? error.message : '切换扩展失败')
      updateRevision(function (value) {
        return value + 1
      })
    } finally {
      updateBusyKey(null)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {isLoading ? (
          <p className="text-muted-foreground flex items-center gap-1.5 p-2.5 text-xs">
            <Icon
              icon="lucide:loader-circle"
              className="size-3.5 animate-spin"
            />
            读取中…
          </p>
        ) : null}

        {!isLoading && entries.length === 0 ? (
          <p className="text-muted-foreground p-2.5 text-xs">
            还没有扩展，到「设置 · 扩展」添加 MCP 服务或内置扩展
          </p>
        ) : null}

        {entries.map(function (entry) {
          const key = findExtensionKey(entry)
          const isInSession = sessionKeys.has(key)
          return (
            <div
              key={key}
              className="hover:bg-muted/50 flex items-center gap-2 rounded-md px-2 py-1.5">
              <Icon
                icon="lucide:puzzle"
                className="text-muted-foreground size-3.5 shrink-0"
              />
              <span className="min-w-0 flex-1">
                <span className="text-foreground flex items-center gap-1.5 truncate text-xs font-medium">
                  {findExtensionName(entry.extension)}
                  {isInSession ? (
                    <span className="bg-primary/10 text-primary shrink-0 rounded px-1 py-0.5 text-xs font-normal">
                      本次已加载
                    </span>
                  ) : null}
                </span>
                <span className="text-muted-foreground block text-xs">
                  {EXTENSION_TYPE_LABELS[entry.extension.type] ?? entry.extension.type}
                </span>
              </span>
              <Switch
                size="sm"
                aria-label={`${findExtensionName(entry.extension)} 启用`}
                checked={entry.enabled}
                disabled={busyKey === key}
                onCheckedChange={function () {
                  void toggle(entry)
                }}
              />
            </div>
          )
        })}
      </div>

      <div className="border-border/60 flex shrink-0 items-center justify-between gap-2 border-t px-2.5 py-1.5">
        <span className="text-muted-foreground text-xs">
          {acpSessionID ? '开关写全局配置；本次会话已在运行' : '开关写入全局配置，新会话生效'}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground h-6 gap-1 px-1.5 text-xs"
          onClick={props.onManage}>
          <Icon
            icon="lucide:plus"
            className="size-3.5"
          />
          添加 MCP
        </Button>
      </div>
    </div>
  )
}

export { ExtensionsPane }
