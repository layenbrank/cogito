/**
 * 诊断 section：goose `diagnostics/get` 的报告（系统信息 / 配置 / 日志 / 提示词 / 告警）。
 *
 * `diagnostics/get` 要 goose session 上下文，所以得有活跃会话；`full` 才带配置正文、日志与
 * 提示词（体积大），摘要就只有系统信息与扩展清单。报告原文原样保留，复制 / 导出都出全量 JSON。
 */
import { Button } from '@cogito/design/components/button'
import { Spinner } from '@cogito/design/components/spinner'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { save } from '@/shared/ipc/dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { findAcpHandle } from '@/features/agent/port/agentd-connection'
import {
  fetchDiagnostics,
  type DiagnosticsLevel,
  type DiagnosticsReport,
  type DiagnosticsTextFile
} from '@/features/agent/acp/goose-diagnostics'
import { findThreadAcpSessionID, readGooseStatus, waitGooseReady } from '@/features/agent/port/session'
import {
  findSessionMcpStatus,
  readSessionToolSurface,
  type SessionMcpStatus,
  type SessionToolSurface
} from '@/features/agent/acp/session-mcp'
import { GET_SECURITY_AUDIT, GET_SECURITY_COST } from '@/apis/security'
import { describeAudit } from '@/shared/ipc/audit'
import { describeCost } from '@/shared/ipc/cost'
import { useAgentStore } from '@/stores/agent'

const LEVELS: Array<{ value: DiagnosticsLevel; label: string; hint: string }> = [
  { value: 'summary', label: '生成摘要', hint: '系统信息 + 扩展清单' },
  { value: 'full', label: '生成完整报告', hint: '另含配置正文、日志与提示词' }
]

/** RSS 只用于基线展示，不参与判定，取整到 MB 就够 */
function formatRss(bytes: number | undefined): string {
  if (typeof bytes !== 'number') return '未知'
  return `${Math.round(bytes / 1024 / 1024)} MB`
}

function findFileLabel(file: DiagnosticsTextFile): string {
  const size = `${file.content.length} 字符`
  return `${file.path}（${size}${file.truncated ? '，已截断' : ''}）`
}

/** 完整报告才有的明细：日志/提示词份数、配置路径与逐份清单 */
function FullReportDetails(props: { report: DiagnosticsReport }) {
  const report = props.report
  const logFiles = [...report.logs.cli, ...report.logs.llm]
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">
          CLI 日志 {report.logs.cli.length} 份 / LLM 日志 {report.logs.llm.length} 份 / 提示词{' '}
          {report.prompts.length} 份
        </span>
        {report.config ? (
          <span className="truncate text-xs text-muted-foreground">
            配置：{report.config.configPath}
            {report.config.truncated ? '（已截断）' : ''}
          </span>
        ) : null}
        {logFiles.map(function (file) {
          return (
            <span
              key={file.path}
              className="truncate text-xs text-muted-foreground">
              {findFileLabel(file)}
            </span>
          )
        })}
      </div>
    </div>
  )
}

/**
 * 工具审计导出条（S6）。放在诊断 section 顶部：审计与 goose 会话无关，
 * 没有活跃会话时也要能导出（那种时候恰恰最需要看「它刚才都干了什么」）。
 */
function AuditExportBar(props: { busy: boolean; onExport: () => Promise<void> }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 px-4 py-3">
      <span className="text-muted-foreground text-xs">
        Agent 的本地工具调用（含被拒请求）每条都落一行审计，保留 7 天；参数只存摘要，不存原文
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={props.busy}
        title="导出最近 2000 条工具审计（JSON）"
        onClick={function () {
          void props.onExport()
        }}>
        {props.busy ? <Spinner /> : null}
        导出工具审计
      </Button>
    </div>
  )
}

/**
 * 成本账本导出条（S8）。同样与活跃会话无关 —— 昨天跑了多少 token、花了多少钱，
 * 恰恰是「现在没开会话」的时候最想看。未知模型记「未计价」，不显示成 0。
 */
function CostExportBar(props: { busy: boolean; onExport: () => Promise<void> }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 px-4 py-3">
      <span className="text-muted-foreground text-xs">
        每轮用量按内置价目表折成金额落账（保留 400 天）；账本只存 token 数与模型名，不存对话正文
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={props.busy}
        title="导出最近 5000 条成本账（JSON）"
        onClick={function () {
          void props.onExport()
        }}>
        {props.busy ? <Spinner /> : null}
        导出成本账
      </Button>
    </div>
  )
}

/**
 * 本会话工具面（Phase 0）：每个内置服务器「接入了没有 / 命令 / 几个工具」，
 * 外加 `tools/list` 的**原始**名字（可折叠）。
 *
 * 为什么放在诊断而不是只放扩展页：扩展页会告诉你「接没接入」，
 * 但排查「模型调错工具名 / 参数对不上」要看的是名字里到底带不带 `<server>__` 前缀、
 * 工具面是不是空的。这两个问题在这里一眼就能看出来。
 */
function ToolSurfaceBlock(props: { threadID: string }) {
  const [surface, updateSurface] = useState<SessionToolSurface | null>(null)
  const [statuses, updateStatuses] = useState<SessionMcpStatus[]>([])
  const [busy, updateBusy] = useState(true)
  const [expanded, updateExpanded] = useState(false)

  useEffect(
    function () {
      let cancelled = false
      async function load() {
        updateBusy(true)
        try {
          const [nextSurface, nextStatuses] = await Promise.all([
            readSessionToolSurface(props.threadID),
            findSessionMcpStatus(props.threadID)
          ])
          if (cancelled) return
          updateSurface(nextSurface)
          updateStatuses(nextStatuses)
        } catch (error) {
          console.warn('[settings/diagnostics] 读取工具面失败:', error)
        } finally {
          if (!cancelled) updateBusy(false)
        }
      }
      void load()
      return function () {
        cancelled = true
      }
    },
    [props.threadID]
  )

  const tools = surface?.tools ?? []
  return (
    <div className="border-border/60 flex flex-col gap-2 rounded-lg border px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium">本会话工具面</span>
        <span className="text-muted-foreground text-xs">
          {busy ? '读取中…' : `${tools.length} 个工具`}
        </span>
        {surface?.acpSessionID ? (
          <span
            className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-[11px]"
            title="与日志里的会话标识对应">
            {surface.acpSessionID}
          </span>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || tools.length === 0}
          onClick={function () {
            updateExpanded(function (value) {
              return !value
            })
          }}>
          {expanded ? '收起名字' : '展开名字'}
        </Button>
      </div>

      <ul className="flex flex-col gap-1">
        {statuses.map(function (status) {
          return (
            <li
              key={status.name}
              className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-2 text-xs">
              <span className="text-foreground">{status.label}</span>
              <span>{status.isMounted ? '已接入' : status.isEnabled ? '未接入' : '已关闭'}</span>
              <span>{status.tools.length} 个工具</span>
              {status.command ? <span className="min-w-0 truncate">{status.command}</span> : null}
            </li>
          )
        })}
      </ul>

      {expanded ? (
        <ul className="bg-muted/30 max-h-64 overflow-auto rounded-md p-2 font-mono text-xs">
          {tools.map(function (name) {
            return (
              <li
                key={name}
                className="truncate">
                {name}
              </li>
            )
          })}
        </ul>
      ) : null}

      {surface?.error ? (
        <p className="text-destructive text-xs">读取工具面失败：{surface.error}</p>
      ) : null}
    </div>
  )
}

function DiagnosticsSection() {
  const activeSessionID = useAgentStore(function (state) {
    return state.activeSessionID
  })
  const acpSessionID = activeSessionID ? findThreadAcpSessionID(activeSessionID) : null

  /**
   * 报告带着会话归属：切了会话就把旧报告当成「不属于当前会话」而不显示。
   * 以前它就是个裸 state，切完会话还能点「复制 / 导出」，拿到的是一份别的会话的诊断。
   */
  const [reportState, updateReportState] = useState<{
    sessionID: string
    report: DiagnosticsReport
  } | null>(null)
  const report = reportState && reportState.sessionID === acpSessionID ? reportState.report : null
  const [busyLevel, updateBusyLevel] = useState<DiagnosticsLevel | null>(null)
  const [auditBusy, updateAuditBusy] = useState(false)
  const [costBusy, updateCostBusy] = useState(false)
  // 就绪基线（S4）：模块级缓存，不参与渲染状态；切回本页时读到的就是最近一次
  const gooseStatus = readGooseStatus()

  async function generate(level: DiagnosticsLevel) {
    if (!acpSessionID) return
    updateBusyLevel(level)
    try {
      await waitGooseReady()
      const handle = await findAcpHandle()
      const next = await fetchDiagnostics(handle.connection, acpSessionID, level)
      updateReportState({ sessionID: acpSessionID, report: next })
      toast.success(level === 'full' ? '已生成完整报告' : '已生成摘要')
    } catch (error) {
      console.warn('[settings/diagnostics] 生成诊断失败:', error)
      toast.error(error instanceof Error ? error.message : '生成诊断失败')
    } finally {
      updateBusyLevel(null)
    }
  }

  async function copyReport() {
    if (!report) return
    try {
      await writeText(JSON.stringify(report, null, 2))
      toast.success('已复制诊断报告')
    } catch (error) {
      console.warn('[settings/diagnostics] 复制失败:', error)
      toast.error('复制失败')
    }
  }

  async function exportReport() {
    if (!report) return
    try {
      const target = await save({
        defaultPath: `cogito-diagnostics-${Date.now()}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (!target) return
      await writeTextFile(target, JSON.stringify(report, null, 2))
      toast.success('已导出诊断报告')
    } catch (error) {
      console.warn('[settings/diagnostics] 导出失败:', error)
      toast.error(error instanceof Error ? error.message : '导出失败')
    }
  }

  /** 工具审计（S6）：只导出、不查询 —— 落盘一份 JSON 交给用户自己保管 */
  async function exportAudit() {
    updateAuditBusy(true)
    try {
      const result = await GET_SECURITY_AUDIT()
      const target = await save({
        defaultPath: `cogito-tool-audit-${Date.now()}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (!target) return
      await writeTextFile(target, JSON.stringify(result, null, 2))
      toast.success(`已导出工具审计：${describeAudit(result)}`)
    } catch (error) {
      console.warn('[settings/diagnostics] 导出工具审计失败:', error)
      toast.error(error instanceof Error ? error.message : '导出工具审计失败')
    } finally {
      updateAuditBusy(false)
    }
  }

  /** 成本账本（S8）：同样只导出、不查询 */
  async function exportCost() {
    updateCostBusy(true)
    try {
      const result = await GET_SECURITY_COST()
      const target = await save({
        defaultPath: `cogito-run-cost-${Date.now()}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (!target) return
      await writeTextFile(target, JSON.stringify(result, null, 2))
      toast.success(`已导出成本账：${describeCost(result)}`)
    } catch (error) {
      console.warn('[settings/diagnostics] 导出成本账失败:', error)
      toast.error(error instanceof Error ? error.message : '导出成本账失败')
    } finally {
      updateCostBusy(false)
    }
  }

  if (!acpSessionID) {
    return (
      <div className="flex flex-col gap-4">
        <AuditExportBar busy={auditBusy} onExport={exportAudit} />
        <CostExportBar busy={costBusy} onExport={exportCost} />
        <p className="py-2 text-sm text-muted-foreground">打开一个会话后才能生成诊断报告。</p>
      </div>
    )
  }
  const systemRows = report
    ? [
        { label: 'goose', value: report.system.app_version },
        { label: '系统', value: `${report.system.os} ${report.system.os_version}` },
        { label: '架构', value: report.system.architecture },
        { label: '供应商', value: report.system.provider ?? '未设置' },
        { label: '模型', value: report.system.model ?? '未设置' },
        { label: '启用扩展', value: `${report.system.enabled_extensions.length} 个` }
      ]
    : []

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {LEVELS.map(function (level) {
          const busy = busyLevel === level.value
          return (
            <Button
              key={level.value}
              size="sm"
              variant="outline"
              disabled={busyLevel !== null}
              title={level.hint}
              onClick={function () {
                void generate(level.value)
              }}>
              {busy ? <Spinner /> : null}
              {level.label}
            </Button>
          )
        })}
        {report ? (
          <>
            <span className="mx-1 text-xs text-muted-foreground">
              {report.level === 'full' ? '完整报告' : '摘要'} · {report.generated_at}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={function () {
                void copyReport()
              }}>
              复制 JSON
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={function () {
                void exportReport()
              }}>
              导出文件
            </Button>
          </>
        ) : null}
      </div>

      {gooseStatus ? (
        <p className="text-xs text-muted-foreground">
          agentd 就绪基线：
          {gooseStatus.state === 'ready'
            ? `${gooseStatus.readyMs ?? '?'} ms · 端口 ${gooseStatus.port ?? '?'} · pid ${gooseStatus.pid ?? '?'} · 内层 goose ${gooseStatus.goose ?? '?'} · 重启 ${gooseStatus.restarts ?? 0} 次 · 宿主 ${formatRss(gooseStatus.rssBytes)}`
            : gooseStatus.state === 'failed'
              ? `启动失败：${gooseStatus.reason ?? '未知原因'}`
              : '启动中'}
        </p>
      ) : null}

      {activeSessionID ? <ToolSurfaceBlock threadID={activeSessionID} /> : null}

      <AuditExportBar busy={auditBusy} onExport={exportAudit} />

      <CostExportBar busy={costBusy} onExport={exportCost} />

      {!report ? (
        <p
          className="text-muted-foreground py-2 text-sm"
          title="报告不会自动上传；复制或导出后请自行检查敏感内容">
          选择粒度生成报告
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-lg border border-border/60 bg-muted/30 px-4 py-3 text-sm">
            {systemRows.map(function (row) {
              return (
                <div
                  key={row.label}
                  className="col-span-2 grid grid-cols-subgrid">
                  <dt className="text-muted-foreground">{row.label}</dt>
                  <dd className="min-w-0 truncate">{row.value}</dd>
                </div>
              )
            })}
          </dl>

          {report.system.enabled_extensions.length ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">扩展</span>
              <span className="text-sm">{report.system.enabled_extensions.join(' · ')}</span>
            </div>
          ) : null}

          {report.errors.length ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-destructive">报告里收集到的问题</span>
              <ul className="flex flex-col gap-1 text-sm text-destructive">
                {report.errors.map(function (entry) {
                  return (
                    <li key={`${entry.path ?? ''}:${entry.message}`}>
                      {entry.path ? `${entry.path}：` : ''}
                      {entry.message}
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : null}

          {report.level === 'full' ? <FullReportDetails report={report} /> : null}
        </>
      )}
    </div>
  )
}

export { DiagnosticsSection }
