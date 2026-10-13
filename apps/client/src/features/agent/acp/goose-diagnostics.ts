/**
 * Goose 诊断 ACP：`_goose/unstable/diagnostics/get`。
 *
 * 报告是 goose 侧的 `DiagnosticsReport` 序列化结果：`system` / `extensions` 顶层字段用
 * snake_case（该结构没有 `rename_all`），其余嵌套结构用 camelCase。这里只声明 UI 要渲染的
 * 字段，原始 JSON 原样保留（复制 / 导出时带上全量，不需要重建对象）。
 */
import type { ClientConnection } from '@agentclientprotocol/sdk'

const GOOSE_DIAGNOSTICS_GET = '_goose/unstable/diagnostics/get'

type DiagnosticsLevel = 'summary' | 'full'

interface DiagnosticsSystem {
  app_version: string
  os: string
  os_version: string
  architecture: string
  provider: string | null
  model: string | null
  enabled_extensions: string[]
}

interface DiagnosticsTextFile {
  path: string
  content: string
  truncated: boolean
}

interface DiagnosticsError {
  path: string | null
  message: string
}

interface DiagnosticsConfig {
  configPath: string
  configYaml: string | null
  truncated: boolean
}

interface DiagnosticsReport {
  schema_version: number
  generated_at: string
  level: DiagnosticsLevel
  system: DiagnosticsSystem
  config?: DiagnosticsConfig | null
  extensions: { enabled: string[] }
  logs: { cli: DiagnosticsTextFile[]; llm: DiagnosticsTextFile[] }
  prompts: Array<{ name: string; content: string }>
  errors: DiagnosticsError[]
}

/** 生成诊断报告（`full` 才带配置 / 日志 / 提示词正文，体积大得多） */
async function fetchDiagnostics(
  connection: ClientConnection,
  sessionId: string,
  level: DiagnosticsLevel = 'summary'
): Promise<DiagnosticsReport> {
  const response = await connection.agent.request<{ report: DiagnosticsReport }>(
    GOOSE_DIAGNOSTICS_GET,
    { sessionId, level }
  )
  return response.report
}

export type {
  DiagnosticsConfig,
  DiagnosticsError,
  DiagnosticsLevel,
  DiagnosticsReport,
  DiagnosticsSystem,
  DiagnosticsTextFile
}
export { fetchDiagnostics }
