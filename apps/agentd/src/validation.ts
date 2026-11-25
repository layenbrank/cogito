/**
 * agentd 的输入校验（信任边界）。
 *
 * 这里的规则不是「让请求更容易通过」，而是把「bearer 泄漏 = 本机任意命令执行」收窄成
 * 「bearer 泄漏 = 只能在声明过的工作区里跑声明过的工具」。因此全部 **fail-closed**：
 * 认不出的形状、不存在的目录、非绝对路径的 MCP 可执行文件，一律拒绝。
 *
 * 纯函数优先：目录/文件存在性需要 `fs`，但判定逻辑与错误码都在这里集中，
 * 便于单测与后续在 agentd 之外复用（例如扩展到 Web 端）。
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

/** 会话 id 上限：再长就只可能是拼错或恶意输入，没必要让它进 SQLite 主键 */
const MAX_THREAD_ID_LENGTH = 200
const MAX_CWD_LENGTH = 4096
const MAX_MCP_SERVERS = 16
const MAX_MCP_ARGS = 64
const MAX_MCP_ENV = 64
const MAX_STRING_LENGTH = 8192

/** `session/set_config_option` 允许的 configId：只放前端真正会写的那几个 */
const ALLOWED_SESSION_CONFIG_IDS: ReadonlySet<string> = new Set(['mode', 'thinking_effort'])

interface ValidationFailure {
  ok: false
  code: string
  message: string
}

type ValidationResult<T> = { ok: true; value: T } | ValidationFailure

interface McpServerInput {
  name: string
  command: string
  args: string[]
  env: Array<{ name: string; value: string }>
}

interface McpValidationOptions {
  /** 显式允许的命令白名单（非空时优先于内置名单） */
  allowedCommands?: readonly string[]
  /** 允许裸命令（依赖 PATH）。默认 false：避免 `bash -c ...` 这类注入面 */
  allowBareCommand?: boolean
  /** 允许任意绝对路径（用户自装 MCP）。默认 false：只认 `corex-mcp` / `cogito-mcp` */
  allowArbitraryCommand?: boolean
}

/** 产品自带的两个 MCP server（可带 triple 后缀 / `.exe`） */
const PRODUCT_MCP_COMMAND = /^(?:corex-mcp|cogito-mcp)(?:[-.].*)?$/i

function fail(code: string, message: string): ValidationFailure {
  return { ok: false, code, message }
}

function hasControlChars(value: string): boolean {
  // eslint-disable-next-line no-control-regex -- 就是要匹配控制字符
  return /[\u0000-\u001f\u007f]/.test(value)
}

/**
 * 会话 id：允许常见的 UUID / `thread-…` / `local_session` 形态，
 * 拒绝空白、路径分隔符与控制字符（它们会让日志与 SQLite 主键难以排查）。
 */
function validateThreadID(raw: unknown): ValidationResult<string> {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) return fail('thread_id_required', '缺少 thread_id')
  if (value.length > MAX_THREAD_ID_LENGTH) {
    return fail('thread_id_too_long', `thread_id 超过 ${MAX_THREAD_ID_LENGTH} 个字符`)
  }
  if (hasControlChars(value) || /[\s/\\]/.test(value)) {
    return fail('thread_id_invalid', 'thread_id 含空白、路径分隔符或控制字符')
  }
  return { ok: true, value }
}

function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

function isInside(child: string, root: string): boolean {
  const relative = path.relative(root, child)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/**
 * cwd：必须是**已存在的绝对目录**。
 *
 * `roots` 非空时还必须落在其中一个根内；根目录本身也要能解析，否则视为配置失效
 * （fail-closed），不能因为「配错了根」就默默允许任意路径。
 */
async function validateCwd(raw: unknown, roots: readonly string[]): Promise<ValidationResult<string>> {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) return fail('cwd_required', '缺少 cwd')
  if (value.length > MAX_CWD_LENGTH) return fail('cwd_too_long', 'cwd 过长')
  if (hasControlChars(value)) return fail('cwd_invalid', 'cwd 含控制字符')
  if (!path.isAbsolute(value)) return fail('cwd_not_absolute', 'cwd 必须是绝对路径')

  let real: string
  try {
    real = await fs.realpath(value)
  } catch {
    return fail('cwd_not_found', `cwd 不存在：${value}`)
  }
  try {
    const stat = await fs.stat(real)
    if (!stat.isDirectory()) return fail('cwd_not_directory', `cwd 不是目录：${value}`)
  } catch {
    return fail('cwd_not_found', `cwd 不可访问：${value}`)
  }

  if (roots.length === 0) return { ok: true, value }

  const resolvedRoots: string[] = []
  for (const root of roots) {
    try {
      resolvedRoots.push(await fs.realpath(root))
    } catch {
      // 配错的根不参与判定；全部失效时下面会 fail-closed
    }
  }
  if (resolvedRoots.length === 0) {
    return fail('cwd_root_unavailable', 'AGENTD_ALLOWED_ROOTS 没有任何可用目录')
  }
  if (!resolvedRoots.some(function (root) { return isInside(real, root) })) {
    return fail('cwd_not_allowed', `cwd 不在允许的工作区根内：${value}`)
  }
  return { ok: true, value }
}

function readMcpEnv(raw: unknown): ValidationResult<Array<{ name: string; value: string }>> {
  if (raw === undefined || raw === null) return { ok: true, value: [] }
  if (!Array.isArray(raw)) return fail('mcp_env_invalid', 'MCP env 必须是数组')
  if (raw.length > MAX_MCP_ENV) return fail('mcp_env_too_many', `MCP env 超过 ${MAX_MCP_ENV} 项`)
  const value: Array<{ name: string; value: string }> = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) {
      return fail('mcp_env_invalid', 'MCP env 项必须是 { name, value }')
    }
    const item = entry as { name?: unknown; value?: unknown }
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      return fail('mcp_env_name_invalid', `MCP env 名非法：${name}`)
    }
    if (typeof item.value !== 'string' || item.value.length > MAX_STRING_LENGTH) {
      return fail('mcp_env_value_invalid', `MCP env 值非法：${name}`)
    }
    if (hasControlChars(item.value)) {
      return fail('mcp_env_value_invalid', `MCP env 值含控制字符：${name}`)
    }
    value.push({ name, value: item.value })
  }
  return { ok: true, value }
}

function readMcpArgs(raw: unknown): ValidationResult<string[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] }
  if (!Array.isArray(raw)) return fail('mcp_args_invalid', 'MCP args 必须是数组')
  if (raw.length > MAX_MCP_ARGS) return fail('mcp_args_too_many', `MCP args 超过 ${MAX_MCP_ARGS} 项`)
  const value: string[] = []
  for (const entry of raw) {
    if (typeof entry !== 'string' || entry.length > MAX_STRING_LENGTH) {
      return fail('mcp_args_invalid', 'MCP args 每项必须是不超过上限的字符串')
    }
    if (hasControlChars(entry)) return fail('mcp_args_invalid', 'MCP args 含控制字符')
    value.push(entry)
  }
  return { ok: true, value }
}

/**
 * MCP server 条目：形状与 `AcpMcpServer` 对齐（`{ name, command, args, env }`）。
 *
 * 关键约束是 **`command` 必须是已存在的绝对路径**：goose 会直接 spawn 它，
 * 允许裸命令等于把 `/goose/sessions` 变成「用 PATH 执行任意程序」的入口。
 * 需要临时放宽时用 `AGENTD_MCP_ALLOW_BARE_COMMAND=1`。
 */
async function validateMcpServers(
  raw: unknown,
  options: McpValidationOptions = {}
): Promise<ValidationResult<McpServerInput[]>> {
  if (raw === undefined || raw === null) return { ok: true, value: [] }
  if (!Array.isArray(raw)) return fail('mcp_servers_invalid', 'mcpServers 必须是数组')
  if (raw.length > MAX_MCP_SERVERS) {
    return fail('mcp_servers_too_many', `mcpServers 超过 ${MAX_MCP_SERVERS} 个`)
  }

  const allowed = (options.allowedCommands ?? []).map(function (item) {
    return path.resolve(item)
  })
  const seen = new Set<string>()
  const servers: McpServerInput[] = []

  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) {
      return fail('mcp_server_invalid', 'MCP server 必须是对象')
    }
    const item = entry as { name?: unknown; command?: unknown; args?: unknown; env?: unknown }
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    if (!name || name.length > 64 || hasControlChars(name)) {
      return fail('mcp_server_name_invalid', 'MCP server 的 name 非法')
    }
    if (seen.has(name)) return fail('mcp_server_duplicate', `MCP server 重名：${name}`)
    seen.add(name)

    const command = typeof item.command === 'string' ? item.command.trim() : ''
    if (!command || command.length > MAX_CWD_LENGTH || hasControlChars(command)) {
      return fail('mcp_command_invalid', `MCP server ${name} 的 command 非法`)
    }
    if (!path.isAbsolute(command)) {
      if (options.allowBareCommand !== true) {
        return fail(
          'mcp_command_not_absolute',
          `MCP server ${name} 的 command 必须是绝对路径（可用 AGENTD_MCP_ALLOW_BARE_COMMAND=1 放宽）`
        )
      }
    } else {
      let real = ''
      try {
        real = await fs.realpath(command)
        const stat = await fs.stat(real)
        if (!stat.isFile()) return fail('mcp_command_invalid', `MCP command 不是文件：${command}`)
      } catch {
        return fail('mcp_command_not_found', `MCP command 不存在：${command}`)
      }
      if (allowed.length > 0) {
        if (!allowed.some(function (root) { return samePath(real, root) })) {
          return fail('mcp_command_not_allowed', `MCP command 不在白名单内：${name}`)
        }
      } else if (
        options.allowArbitraryCommand !== true &&
        !PRODUCT_MCP_COMMAND.test(path.basename(real))
      ) {
        // 只校验「绝对路径且存在」还不够：`C:\Windows\System32\cmd.exe` 也满足。
        // 默认只放行产品自带的 MCP，避免 bearer 泄漏直接变成任意程序执行。
        return fail(
          'mcp_command_not_allowed',
          `MCP command 只允许 corex-mcp / cogito-mcp（可用 AGENTD_MCP_ALLOW_ARBITRARY=1 放宽）：${name}`
        )
      }
    }

    const args = readMcpArgs(item.args)
    if (!args.ok) return args
    const env = readMcpEnv(item.env)
    if (!env.ok) return env
    servers.push({ name, command, args: args.value, env: env.value })
  }
  return { ok: true, value: servers }
}

function isAllowedSessionConfigID(raw: unknown): boolean {
  return typeof raw === 'string' && ALLOWED_SESSION_CONFIG_IDS.has(raw)
}

/** `?after=` 只接受非负十进制整数；非法值不能退化成「全量补发」 */
function parseAfterQuery(raw: unknown): ValidationResult<number | undefined> {
  if (raw === undefined) return { ok: true, value: undefined }
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    return fail('after_invalid', 'after 必须是非负整数')
  }
  const value = Number(raw)
  if (!Number.isSafeInteger(value)) return fail('after_invalid', 'after 超出安全整数范围')
  return { ok: true, value }
}

/** `?epoch=`：进程标识，只用于区分重启前后的 seq；限制长度与字符集 */
function validateEpoch(raw: unknown): ValidationResult<string | undefined> {
  if (raw === undefined) return { ok: true, value: undefined }
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 64) {
    return fail('epoch_invalid', 'epoch 必须是 1–64 个字符')
  }
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) {
    return fail('epoch_invalid', 'epoch 只允许字母、数字、下划线与连字符')
  }
  return { ok: true, value: raw }
}

export {
  ALLOWED_SESSION_CONFIG_IDS,
  MAX_THREAD_ID_LENGTH,
  isAllowedSessionConfigID,
  parseAfterQuery,
  validateCwd,
  validateEpoch,
  validateMcpServers,
  validateThreadID
}
export type { McpServerInput, McpValidationOptions, ValidationFailure, ValidationResult }
