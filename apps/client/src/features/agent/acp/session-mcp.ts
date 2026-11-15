/**
 * 内置 MCP 服务器的**会话级**状态：设置页「内置服务器」与诊断页「本会话工具面」共用。
 *
 * 为什么需要单独一层：`corex` / `local` 这两个 server 是随会话用 ACP 的 `mcpServers`
 * 挂上去的，**不是** goose 扩展 —— 设置页那两段读的是 `config/extensions/*` 与
 * `session/extensions/*`，永远看不到它们。用户看到的就是「明明能用工具，扩展页里却没有」。
 *
 * 数据来源两处，缺一不可：
 * - `findSessionMcpServers(threadID)`：本次会话**实际注入**了哪些（含启动命令）；
 * - `tools/list`：真的挂上了没有（注入了也可能起不来），顺便按 server 归类工具名。
 */
import { findServerOf } from '@/features/agent/agent-tools'
import { findAcpHandle } from '@/features/agent/acp/connection'
import { fetchSessionTools } from '@/features/agent/acp/goose-providers'
import {
  findSessionMcpServers,
  findThreadAcpSessionID,
  readBuiltinMcpSwitches,
  type AcpMcpServer
} from '@/features/agent/port/session'

type SessionMcpName = 'local' | 'corex'

interface BuiltinMcpEntry {
  name: SessionMcpName
  label: string
  hint: string
}

/** 与 `session.ts` 的注入名单一一对应；顺序即展示顺序（本地工具最常用，放前面） */
const BUILTIN_SERVERS: readonly BuiltinMcpEntry[] = [
  {
    name: 'local',
    label: '本地工具',
    hint: '读写工作区与知识库、操作内嵌浏览器、在右栏终端里执行命令'
  },
  {
    name: 'corex',
    label: 'corex 工具',
    hint: '列出动作与指令、试跑动作、校验指令'
  }
]

interface SessionMcpStatus extends BuiltinMcpEntry {
  /** 设置里是否启用（false = 用户自己关的，不是故障） */
  isEnabled: boolean
  /** 会话的 `mcpServers` 里有没有它（注入了不等于起得来，工具数才是「真的能用」） */
  isMounted: boolean
  /** 启动命令；未注入时为空串 */
  command: string
  /** 本会话 `tools/list` 里归属它的工具名，**原样**（含 goose 的 `<server>__` 前缀） */
  tools: readonly string[]
}

interface SessionToolSurface {
  acpSessionID: string | null
  /** `tools/list` 的原始名字，不排序不过滤 —— 排查前缀规则要看它 */
  tools: readonly string[]
  /** 拉工具面失败的原因；成功为 null */
  error: string | null
}

/** 读本会话 `tools/list` 的原始名字（未开会话 / 连接不在时返回空数组） */
async function findSessionToolNames(threadID: string): Promise<readonly string[]> {
  return (await readSessionToolSurface(threadID)).tools
}

/** 诊断页要的那份：原始名字 + 失败原因，不做归类 */
async function readSessionToolSurface(threadID: string): Promise<SessionToolSurface> {
  const acpSessionID = findThreadAcpSessionID(threadID)
  if (!acpSessionID) return { acpSessionID: null, tools: [], error: null }
  try {
    const handle = await findAcpHandle()
    const tools = await fetchSessionTools(handle.connection, acpSessionID)
    return {
      acpSessionID,
      tools: tools.map(function (tool) {
        return tool.name
      }),
      error: null
    }
  } catch (error) {
    console.warn('[agent/session-mcp] 读取工具面失败:', error)
    return {
      acpSessionID,
      tools: [],
      error: error instanceof Error ? error.message : '读取工具面失败'
    }
  }
}

/** 设置页要的那份：每个内置 server 一行（已挂 / 未挂、为什么、工具数、命令） */
async function findSessionMcpStatus(threadID: string): Promise<SessionMcpStatus[]> {
  let servers: AcpMcpServer[] = []
  try {
    servers = await findSessionMcpServers(threadID)
  } catch (error) {
    // 注入清单本身取不到（桥未就绪等）：按「一个都没挂」展示，不要整页报错
    console.warn('[agent/session-mcp] 读取注入名单失败:', error)
  }
  const switches = readBuiltinMcpSwitches()
  const names = await findSessionToolNames(threadID)
  return BUILTIN_SERVERS.map(function (entry) {
    const injected = servers.find(function (server) {
      return server.name === entry.name
    })
    return {
      ...entry,
      isEnabled: switches[entry.name],
      isMounted: injected !== undefined,
      command: injected?.command ?? '',
      tools: names.filter(function (toolName) {
        return findServerOf(toolName) === entry.name
      })
    }
  })
}

export { findSessionMcpStatus, readSessionToolSurface }
export type { SessionMcpName, SessionMcpStatus, SessionToolSurface }
