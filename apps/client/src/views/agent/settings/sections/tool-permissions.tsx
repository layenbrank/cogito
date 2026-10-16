/**
 * 权限 section：工具权限 3 档（总是允许 / 每次询问 / 从不允许）。
 *
 * goose 的 `tools/list` 需要 goose session 上下文枚举工具（工具来自会话加载的扩展），
 * 而权限本身是全局的（`tools/permissions/set` 落 permission.yaml）——所以这里用「当前活跃
 * 会话」的 ACP session 来枚举工具；没有活跃会话时提示先打开一个会话。
 */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@i-thinking/design/components/select'
import { Spinner } from '@i-thinking/design/components/spinner'
import { useEffect, useState } from 'react'

import { findAcpHandle } from '@/features/agent/acp/connection'
import {
  fetchSessionTools,
  setToolPermissions,
  type SessionTool,
  type ToolPermissionLevel
} from '@/features/agent/acp/goose-providers'
import { findThreadAcpSessionID, waitGooseReady } from '@/features/agent/acp/session'
import { useAgentStore } from '@/stores/agent'

const PERMISSION_OPTIONS: Array<{ value: ToolPermissionLevel; label: string }> = [
  { value: 'always_allow', label: '总是允许' },
  { value: 'ask_before', label: '每次询问' },
  { value: 'never_allow', label: '从不允许' }
]

function ToolPermissionsSection() {
  const activeSessionID = useAgentStore(function (state) {
    return state.activeSessionID
  })
  const acpSessionID = activeSessionID ? findThreadAcpSessionID(activeSessionID) : null

  const [tools, updateTools] = useState<SessionTool[]>([])
  const [loading, updateLoading] = useState(false)

  useEffect(
    function () {
      if (!acpSessionID) return
      let cancelled = false
      async function load() {
        try {
          updateLoading(true)
          await waitGooseReady()
          const handle = await findAcpHandle()
          const list = await fetchSessionTools(handle.connection, acpSessionID as string)
          if (!cancelled) updateTools(list)
        } catch (error) {
          console.warn('[settings/tool-permissions] 枚举工具失败:', error)
          if (!cancelled) updateTools([])
        } finally {
          if (!cancelled) updateLoading(false)
        }
      }
      void load()
      return function () {
        cancelled = true
      }
    },
    [acpSessionID]
  )

  async function changePermission(toolName: string, permission: ToolPermissionLevel) {
    const former = tools
    updateTools(function (prev) {
      return prev.map(function (tool) {
        return tool.name === toolName ? { ...tool, permission } : tool
      })
    })
    try {
      await waitGooseReady()
      const handle = await findAcpHandle()
      await setToolPermissions(handle.connection, [{ toolName, permission }])
    } catch (error) {
      updateTools(former)
      console.warn('[settings/tool-permissions] 设置权限失败:', error)
    }
  }

  if (!acpSessionID) {
    return (
      <p className="py-2 text-sm text-muted-foreground">打开一个会话后才能查看和设置工具权限。</p>
    )
  }
  if (loading && tools.length === 0) {
    return (
      <div className="flex justify-center py-6">
        <Spinner className="size-5" />
      </div>
    )
  }
  if (tools.length === 0) {
    return <p className="py-2 text-sm text-muted-foreground">当前会话没有可配置权限的工具。</p>
  }

  return (
    <ul className="flex flex-col">
      {tools.map(function (tool) {
        return (
          <li
            key={tool.name}
            className="flex items-center justify-between gap-4 border-b border-border/60 py-3 last:border-b-0">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{tool.name}</div>
              {tool.description ? (
                <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                  {tool.description}
                </div>
              ) : null}
            </div>
            <Select
              value={tool.permission ?? 'ask_before'}
              onValueChange={function (value) {
                void changePermission(tool.name, value as ToolPermissionLevel)
              }}>
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERMISSION_OPTIONS.map(function (option) {
                  return (
                    <SelectItem
                      key={option.value}
                      value={option.value}>
                      {option.label}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </li>
        )
      })}
    </ul>
  )
}

export { ToolPermissionsSection }
