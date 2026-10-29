/**
 * goose 扩展（MCP / 内置 / 平台）的线格式与表单互转。
 *
 * 线格式对齐 goose 的 ACP 自定义请求（`_goose/unstable/{config,session}/extensions/*`）：
 * `type` 判别联合，MCP 的 `server` 再按 `type: http | stdio` 分派，请求头与环境变量都是
 * `{ name, value }` 列表（`http` 即 streamable HTTP；goose 已不再支持 `sse`）。
 * ACP 调用在 `features/agent/acp/goose-extensions.ts`，这里只放形状与纯转换，便于单测。
 */

/** 请求头 / 环境变量条目（goose 的 `HttpHeader`，stdio 的 `env` 同形） */
interface ExtensionPair {
  name: string
  value: string
}

interface ExtensionHttpServer {
  type: 'http'
  name: string
  url: string
  headers: ExtensionPair[]
}

interface ExtensionStdioServer {
  type: 'stdio'
  name: string
  command: string
  args: string[]
  env: ExtensionPair[]
}

type ExtensionServer = ExtensionHttpServer | ExtensionStdioServer

/**
 * MCP 扩展。
 *
 * 只声明展示与提交用得到的字段；从 `config/extensions/list` 拿到后要**原样**回传给
 * `session/extensions/add`，所以 goose 侧多出来的字段（`timeout`/`socket`/`scopes`/
 * `available_tools`…）在运行时随对象一起保留，不要重建对象。
 */
interface ExtensionMcp {
  type: 'mcp'
  server: ExtensionServer
  description: string | null
  envKeys?: string[]
}

/** 内置 / 平台扩展：没有 transport，由 goose 自带 */
interface ExtensionBundled {
  type: 'builtin' | 'platform'
  name: string
  description?: string | null
  display_name?: string | null
  bundled?: boolean | null
}

type GooseExtension = ExtensionMcp | ExtensionBundled

/** `config/extensions/list` 条目（全局配置，对新会话生效） */
interface ExtensionEntry {
  extension: GooseExtension
  enabled: boolean
  configKey?: string | null
}

/** `session/extensions/list` 条目（当前会话已启用） */
interface SessionExtensionEntry {
  extension: GooseExtension
  extensionKey: string
}

/** 添加表单草稿：字段与输入框一一对应，`kind` 决定读哪几个 */
interface ExtensionDraft {
  kind: ExtensionServer['type']
  name: string
  description: string
  url: string
  headers: string
  command: string
  args: string
  env: string
}

const EXTENSION_TYPE_LABELS: Record<GooseExtension['type'], string> = {
  builtin: '内置',
  platform: '平台',
  mcp: 'MCP'
}

/** 表单初始值：每次新建取新对象，避免共享可变草稿 */
function makeExtensionDraft(): ExtensionDraft {
  return {
    kind: 'http',
    name: '',
    description: '',
    url: '',
    headers: '',
    command: '',
    args: '',
    env: ''
  }
}

/** 全局配置里的键；goose 老版本可能不给 `configKey`，退回扩展名 */
function findExtensionKey(entry: ExtensionEntry): string {
  return entry.configKey?.trim() || findExtensionName(entry.extension)
}

/** 一句话描述：MCP 显示端点（stdio 显示命令行），内置 / 平台显示类型 */
function describeExtension(extension: GooseExtension): string {
  if (extension.type !== 'mcp') return EXTENSION_TYPE_LABELS[extension.type]
  const server = extension.server
  if (server.type === 'http') return server.url
  return [server.command, ...server.args].join(' ')
}

/** 展示名：MCP 用 `server.name`，内置 / 平台用 `display_name`（没给就退回扩展名） */
function findExtensionName(extension: GooseExtension): string {
  if (extension.type === 'mcp') return extension.server.name
  return extension.display_name?.trim() || extension.name
}

/** 多行文本 → 列表：跳过空行与 `#` 注释 */
function parseLines(text: string): string[] {
  return text
    .split('\n')
    .map(function (line) {
      return line.trim()
    })
    .filter(function (line) {
      return line !== '' && !line.startsWith('#')
    })
}

/** 多行文本 → 键值对：只按**第一个**分隔符拆，值里再出现分隔符不拆 */
function parsePairs(text: string, separator: ':' | '='): ExtensionPair[] {
  return parseLines(text).map(function (line) {
    const index = line.indexOf(separator)
    if (index < 0) throw new Error(`缺少「${separator}」分隔符：${line}`)
    return { name: line.slice(0, index).trim(), value: line.slice(index + 1).trim() }
  })
}

/** 草稿 → 线格式；字段缺失直接抛错，由调用方提示（不静默填默认值） */
function buildExtension(draft: ExtensionDraft): GooseExtension {
  const name = draft.name.trim()
  if (!name) throw new Error('请填写扩展名称')
  const description = draft.description.trim() || null

  if (draft.kind === 'http') {
    const url = draft.url.trim()
    if (!url) throw new Error('请填写 MCP 服务地址')
    return {
      type: 'mcp',
      server: { type: 'http', name, url, headers: parsePairs(draft.headers, ':') },
      description
    }
  }

  const command = draft.command.trim()
  if (!command) throw new Error('请填写启动命令')
  return {
    type: 'mcp',
    server: {
      type: 'stdio',
      name,
      command,
      args: parseLines(draft.args),
      env: parsePairs(draft.env, '=')
    },
    description
  }
}

export type {
  ExtensionBundled,
  ExtensionDraft,
  ExtensionEntry,
  ExtensionMcp,
  ExtensionPair,
  ExtensionServer,
  GooseExtension,
  SessionExtensionEntry
}
export {
  EXTENSION_TYPE_LABELS,
  buildExtension,
  makeExtensionDraft,
  describeExtension,
  findExtensionKey,
  findExtensionName,
  parseLines,
  parsePairs
}
