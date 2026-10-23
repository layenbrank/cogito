/**
 * 诊断 section：goose `diagnostics/get` 的报告（系统信息 / 配置 / 日志 / 提示词 / 告警）。
 *
 * `diagnostics/get` 要 goose session 上下文，所以得有活跃会话；`full` 才带配置正文、日志与
 * 提示词（体积大），摘要就只有系统信息与扩展清单。报告原文原样保留，复制 / 导出都出全量 JSON。
 */
import { Button } from '@cogito/design/components/button'
import { Spinner } from '@cogito/design/components/spinner'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import { useState } from 'react'
import { toast } from 'sonner'

import { findAcpHandle } from '@/features/agent/acp/connection'
import {
  fetchDiagnostics,
  type DiagnosticsLevel,
  type DiagnosticsReport,
  type DiagnosticsTextFile
} from '@/features/agent/acp/goose-diagnostics'
import { findThreadAcpSessionID, waitGooseReady } from '@/features/agent/acp/session'
import { useAgentStore } from '@/stores/agent'

const LEVELS: Array<{ value: DiagnosticsLevel; label: string; hint: string }> = [
  { value: 'summary', label: '生成摘要', hint: '系统信息 + 扩展清单' },
  { value: 'full', label: '生成完整报告', hint: '另含配置正文、日志与提示词' }
]

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

function DiagnosticsSection() {
  const activeSessionID = useAgentStore(function (state) {
    return state.activeSessionID
  })
  const acpSessionID = activeSessionID ? findThreadAcpSessionID(activeSessionID) : null

  const [report, updateReport] = useState<DiagnosticsReport | null>(null)
  const [busyLevel, updateBusyLevel] = useState<DiagnosticsLevel | null>(null)

  async function generate(level: DiagnosticsLevel) {
    if (!acpSessionID) return
    updateBusyLevel(level)
    try {
      await waitGooseReady()
      const handle = await findAcpHandle()
      const next = await fetchDiagnostics(handle.connection, acpSessionID, level)
      updateReport(next)
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

  if (!acpSessionID) {
    return <p className="py-2 text-sm text-muted-foreground">打开一个会话后才能生成诊断报告。</p>
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

      {!report ? (
        <p className="py-2 text-sm text-muted-foreground">
          选择一种粒度生成报告；报告不会自动上传，复制或导出后请自行检查敏感内容。
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
