/**
 * 启动配置：全部来自环境变量（由 Tauri 注入）。
 *
 * 约定（与 ADR `agent-orchestration-langgraph.md` 的 D8/D9 一致）：
 * - `AGENTD_PORT`：默认 0（内核分配），**端口与 pid 通过 stdout 握手行回报**，
 *   Rust 侧不做「先探测空闲端口再传进来」，避免 TOCTOU。
 * - `AGENTD_TOKEN`：必须有，且长度下限；缺失就**拒绝启动**（fail-closed）。
 *   `/health` 不需要它，其余端点全部要。
 */

const MIN_TOKEN_LENGTH = 16

interface AgentdConfig {
  port: number
  token: string
  /** `agentd.db` 的绝对路径（聊天历史不在这里，只有 run/checkpoint 元数据） */
  dbPath: string
  /** goose 的配置根（`<appData>/goose`）；未配置时表示「暂不托管 goose」 */
  goosePathRoot: string | null
  /** goose 二进制路径；空表示用 PATH 里的 `goose` */
  gooseBinary: string | null
  version: string
  /** 双实例隔离（dev 与正式包同跑）标记，只影响日志前缀 */
  isolated: boolean
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 0
  const value = Number(raw.trim())
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new Error(`AGENTD_PORT 非法：${raw}`)
  }
  return value
}

function readRequired(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim()
  if (!value) throw new Error(`缺少必需的环境变量 ${key}`)
  return value
}

function readConfig(env: NodeJS.ProcessEnv = process.env): AgentdConfig {
  const token = readRequired(env, 'AGENTD_TOKEN')
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new Error(`AGENTD_TOKEN 过短（至少 ${MIN_TOKEN_LENGTH} 个字符）`)
  }

  return {
    port: parsePort(env.AGENTD_PORT),
    token,
    dbPath: readRequired(env, 'AGENTD_DB'),
    goosePathRoot: env.AGENTD_GOOSE_PATH_ROOT?.trim() || null,
    gooseBinary: env.AGENTD_GOOSE_BINARY?.trim() || null,
    version: env.AGENTD_VERSION?.trim() || '0.0.0-dev',
    isolated: env.AGENTD_ISOLATED === '1'
  }
}

export { MIN_TOKEN_LENGTH, parsePort, readConfig }
export type { AgentdConfig }
