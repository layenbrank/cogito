/**
 * 权限 section：工具权限 3 档（总是允许 / 每次询问 / 从不允许）+ 手动偏好一览与重置。
 *
 * goose 的 `tools/list` 需要 goose session 上下文枚举工具（工具来自会话加载的扩展），
 * 而权限本身是全局的（`tools/permissions/set` 落 permission.yaml）——所以工具列表用
 * 「当前活跃会话」的 ACP session 来枚举；没有活跃会话时提示先打开一个会话。
 *
 * ## 为什么还要有「手动偏好」这一块
 *
 * `permission.yaml` 的 `user` 段是 goose 判定权限时的**第一优先级**：命中后直接
 * Allow / Deny，不再发 `session/request_permission` —— cogito 的审批卡连出现的机会
 * 都没有。而工具列表只能列出**当前会话挂载**的工具，于是：
 *
 * - 早期版本留下的 `cogito__app_*`（server 已改名叫 `local`）看不见也改不掉；
 * - 带 `*` 的条目（goose 是精确匹配，不支持通配）看着像生效、其实全废；
 * - `never_allow` 命中的工具是**静默拒绝**，界面只看到工具失败。
 *
 * 所以这里把 `user` 段原文列出来、标出失效条目，并提供「重置」——备份后删掉整个
 * 文件让 goose 按空表重建（逐条改写风险太大：写坏格式会让 goose 启动直接 panic）。
 */
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@cogito/design/components/alert-dialog'
import { Badge } from '@cogito/design/components/badge'
import { Button } from '@cogito/design/components/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { Spinner } from '@cogito/design/components/spinner'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { findAcpHandle } from '@/features/agent/port/agentd-connection'
import { findHardDenyLevel } from '@/features/agent/approval'
import {
  fetchSessionTools,
  writeToolPermissions,
  type SessionTool,
  type ToolPermissionLevel
} from '@/features/agent/acp/goose-providers'
import { findThreadAcpSessionID, waitGooseReady } from '@/features/agent/port/session'
import { findToolRisk, RISK_META } from '@/features/agent/tool-risk'
import {
  classifyEntry,
  listUserEntries,
  readGoosePermissions,
  resetGoosePermissions,
  type GoosePermissions
} from '@/shared/ipc/goose-permissions'
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
  const [permissions, updatePermissions] = useState<GoosePermissions | null>(null)
  const [permissionsError, updatePermissionsError] = useState<string | null>(null)
  const [pendingReset, updatePendingReset] = useState(false)
  const [resetting, updateResetting] = useState(false)
  /** 重置后 goose 会重启，工具面得重新枚举一次 */
  const [reloadToken, updateReloadToken] = useState(0)

  // 手动偏好是全局文件，没有活跃会话也要能看、能重置
  useEffect(
    function () {
      let cancelled = false
      async function load() {
        try {
          const snapshot = await readGoosePermissions()
          if (!cancelled) {
            updatePermissions(snapshot)
            updatePermissionsError(null)
          }
        } catch (error) {
          console.warn('[settings/tool-permissions] 读取审批偏好失败:', error)
          if (!cancelled) {
            updatePermissionsError(error instanceof Error ? error.message : String(error))
          }
        }
      }
      void load()
      return function () {
        cancelled = true
      }
    },
    [reloadToken]
  )

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
    [acpSessionID, reloadToken]
  )

  const toolNames = useMemo(
    function () {
      return new Set(
        tools.map(function (tool) {
          return tool.name
        })
      )
    },
    [tools]
  )

  const entries = permissions ? listUserEntries(permissions) : []
  /** 工具面还没枚举出来时不能判「失效」，否则会把正常的条目标成过期 */
  const canClassify = toolNames.size > 0

  async function changePermission(toolName: string, permission: ToolPermissionLevel) {
    // 只记住这一条的旧值：拿整张表的快照回滚，会把期间改过的其它工具一起打回去
    const former =
      tools.find(function (tool) {
        return tool.name === toolName
      })?.permission ?? null
    updateTools(function (prev) {
      return prev.map(function (tool) {
        return tool.name === toolName ? { ...tool, permission } : tool
      })
    })
    try {
      await waitGooseReady()
      const handle = await findAcpHandle()
      await writeToolPermissions(handle.connection, [{ toolName, permission }])
      // 这一条刚写进 permission.yaml 的 user 段，概要要跟上
      updateReloadToken(function (value) {
        return value + 1
      })
    } catch (error) {
      if (former !== null) {
        updateTools(function (prev) {
          return prev.map(function (tool) {
            return tool.name === toolName ? { ...tool, permission: former } : tool
          })
        })
      }
      console.warn('[settings/tool-permissions] 设置权限失败:', error)
    }
  }

  async function handleReset() {
    updatePendingReset(false)
    updateResetting(true)
    try {
      const backup = await resetGoosePermissions()
      if (backup) {
        toast.success('已重置手动审批偏好（goose 已重启）')
        console.info('[settings/tool-permissions] 审批偏好的备份:', backup)
      } else {
        toast.success('本来就没有手动偏好')
      }
      // goose 重启后会话工具面要重新枚举
      updateTools([])
      updateReloadToken(function (value) {
        return value + 1
      })
    } catch (error) {
      console.warn('[settings/tool-permissions] 重置审批偏好失败:', error)
      toast.error(error instanceof Error ? error.message : '重置失败')
    } finally {
      updateResetting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-sm font-medium">手动偏好</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              记录在 <code className="font-mono">permission.yaml</code> 的{' '}
              <code className="font-mono">user</code> 段，判定时优先于下面的工具列表：命中的工具不会弹审批，也不会被拦截。
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={resetting || permissions === null}
            onClick={function () {
              updatePendingReset(true)
            }}>
            {resetting ? '重置中…' : '重置'}
          </Button>
        </div>
        {permissionsError ? (
          <p className="text-xs text-destructive">读取失败：{permissionsError}</p>
        ) : permissions === null ? (
          <div className="flex justify-center py-4">
            <Spinner className="size-4" />
          </div>
        ) : permissions.unreadable ? (
          <p className="text-xs text-destructive">
            {permissions.path} 无法解析 —— 建议重置（goose 会在文件缺失时按空表重建）。
          </p>
        ) : entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            没有手动偏好，审批行为完全由下面的工具列表与当前档位决定。
          </p>
        ) : (
          <ul className="flex flex-col">
            {entries.map(function (entry) {
              const kind = canClassify ? classifyEntry(entry.name, toolNames) : 'live'
              // 这条不是用户点的，是 cogito 写进去的安全策略（goose 没有别的下发通道）
              const hardDenied = findHardDenyLevel(entry.name) !== null
              return (
                <li
                  key={`${entry.level}:${entry.name}`}
                  className="flex items-center justify-between gap-3 border-b border-border/60 py-2 last:border-b-0">
                  <span className="truncate font-mono text-xs">{entry.name}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    {hardDenied ? (
                      <span
                        className="text-xs text-muted-foreground"
                        title="cogito 写入的安全策略（不是你的选择）：goose 只有 user 段能下发 never_allow，重置后会在下个会话自动重写">
                        安全策略
                      </span>
                    ) : null}
                    {kind === 'glob' ? (
                      <span
                        className="text-xs text-destructive"
                        title="goose 的权限匹配是精确字符串，不支持通配符，这条永远不会命中">
                        通配符不生效
                      </span>
                    ) : kind === 'stale' ? (
                      <span
                        className="text-xs text-muted-foreground"
                        title="当前会话没有这个工具（可能已改名或未挂载）">
                        当前未挂载
                      </span>
                    ) : null}
                    <Badge
                      variant={entry.level === 'neverAllow' ? 'destructive' : 'outline'}
                      title={entry.bucket.hint}>
                      {entry.bucket.label}
                    </Badge>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">工具列表</h3>
        {!acpSessionID ? (
          <p className="py-2 text-sm text-muted-foreground">打开一个会话后才能查看和设置工具权限。</p>
        ) : loading && tools.length === 0 ? (
          <div className="flex justify-center py-6">
            <Spinner className="size-5" />
          </div>
        ) : tools.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">当前会话没有可配置权限的工具。</p>
        ) : (
          <ul className="flex flex-col">
            {tools.map(function (tool) {
              const meta = RISK_META[findToolRisk(tool.name)]
              // 硬禁用是**安全策略**，不是偏好：黑盒 shell 会绕开右栏终端，goose 内置写
              // 工具会绕开工作区写闸门（.git 拒绝 / .env 二次确认 / 写前快照）。
              // 在 UI 上留一个下拉让用户把它改成「总是允许」，等于让用户自己拆门。
              const hardDenied = findHardDenyLevel(tool.name) !== null
              return (
                <li
                  key={tool.name}
                  className="flex items-center justify-between gap-4 border-b border-border/60 py-3 last:border-b-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{tool.name}</span>
                      <Badge
                        variant={meta.variant}
                        title={meta.hint}>
                        {meta.label}
                      </Badge>
                    </div>
                    {tool.description ? (
                      <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {tool.description}
                      </div>
                    ) : null}
                  </div>
                  {hardDenied ? (
                    <span
                      className="shrink-0 text-xs text-muted-foreground"
                      title="黑盒 shell 会绕开右栏终端，内置写工具会绕开工作区写闸门（.git 拒绝 / .env 二次确认 / 写前快照）。这是策略而不是偏好，不可改。">
                      设计禁用
                    </span>
                  ) : (
                    <Select
                      items={PERMISSION_OPTIONS.map(function (option) {
                        return { value: option.value, label: option.label }
                      })}
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
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <AlertDialog
        open={pendingReset}
        onOpenChange={function (open) {
          if (!open) updatePendingReset(false)
        }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重置手动审批偏好？</AlertDialogTitle>
            <AlertDialogDescription>
              会备份并删除 permission.yaml，内层 goose 随即重启。所有「总是允许 / 从不允许」的选择都会失效（含智能审批的判定缓存），下轮重新判定。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={function () {
                void handleReset()
              }}>
              重置
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export { ToolPermissionsSection }
