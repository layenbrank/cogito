/**
 * 嵌入式交互终端 IPC：terminal:* 命令 + Channel 字节流。
 *
 * 实时输出走 Tauri 2 的 `Channel` 原始字节（Rust 侧 `InvokeResponseBody::Raw`）；
 * attach / create 的历史回放走 invoke 返回值 `replay`（Channel 同步推大块 Raw 在 WebView2 上不可靠）。
 */
import { Channel, invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'

interface TerminalCreated {
  id: string
  pid: number | null
  /** serde `Vec<u8>` → number[]；空缓冲时字段可缺省 */
  replay?: number[]
}

interface TerminalInfo {
  id: string
  cwd: string
  pid: number | null
}

interface TerminalFont {
  family: string | null
  size: number | null
  /** Windows Terminal font.weight（normal / bold / 数值字符串）；旧后端可能缺省 */
  weight?: string | null
  /**
   * 字体文件绝对路径。WebView2 枚举不到用户 Nerd Font，
   * 前端用 plugin-fs 读成 Blob → FontFace（勿经 IPC 传数 MB base64）。
   */
  filePath?: string | null
}

interface TerminalCreatedWithChannel extends TerminalCreated {
  channel: Channel<ArrayBuffer>
}

/** Channel / IPC 字节统一成可喂给 xterm 的 `Uint8Array`（独立拷贝，避免 SharedBuffer 偏移）。 */
function parseTerminalBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data.slice()
  if (data instanceof ArrayBuffer) return new Uint8Array(data).slice()
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice()
  }
  if (Array.isArray(data)) return Uint8Array.from(data)
  return new Uint8Array()
}

function writeReplay(replay: number[] | undefined, onmessage: (data: Uint8Array) => void) {
  if (!replay || replay.length === 0) return
  onmessage(Uint8Array.from(replay))
}

/** 创建 PTY 会话；`id` 由前端生成，Rust 以其作为会话键。
 *
 * `onmessage` 在 `Channel` 构造时即绑定：Rust 侧同步 spawn 读线程，
 * 首批实时输出可能在 `invoke` 返回前到达，晚绑会丢首包。
 * 历史缓冲则随返回值 `replay` 写入，不依赖 Channel Raw。
 */
async function create(
  cwd: string,
  id: string,
  onmessage: (data: Uint8Array) => void
): Promise<TerminalCreatedWithChannel> {
  const channel = new Channel<ArrayBuffer>(function (data) {
    onmessage(parseTerminalBytes(data))
  })
  const created = await invoke<TerminalCreated>(CHANNELS.TERMINAL.CREATE, { cwd, id, channel })
  writeReplay(created.replay, onmessage)
  return { id: created.id, pid: created.pid, replay: created.replay, channel }
}

/**
 * 接上一个已存在的会话（agent 先建、面板后挂）。
 *
 * 历史输出经 `replay` 回放，实时流走 Channel；与 `create` 的区别是**不会重建会话**。
 */
async function attach(
  id: string,
  onmessage: (data: Uint8Array) => void
): Promise<TerminalCreatedWithChannel> {
  const channel = new Channel<ArrayBuffer>(function (data) {
    onmessage(parseTerminalBytes(data))
  })
  const attached = await invoke<TerminalCreated>(CHANNELS.TERMINAL.ATTACH, { id, channel })
  writeReplay(attached.replay, onmessage)
  return { id: attached.id, pid: attached.pid, replay: attached.replay, channel }
}

/** 写入用户输入（UTF-8 字节）。 */
function write(id: string, data: Uint8Array): Promise<void> {
  return invoke(CHANNELS.TERMINAL.WRITE, { id, data: Array.from(data) })
}

/** 同步 PTY 尺寸（rows/cols 以 xterm 为准）。 */
function resize(id: string, rows: number, cols: number): Promise<void> {
  return invoke(CHANNELS.TERMINAL.RESIZE, {
    id,
    rows,
    cols,
    pixelWidth: 0,
    pixelHeight: 0
  })
}

/** 终止会话；已不存在时视为成功（卸载 / 重复 kill 幂等）。 */
async function kill(id: string): Promise<void> {
  try {
    await invoke(CHANNELS.TERMINAL.KILL, { id })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('不存在')) return
    throw error
  }
}

/** 列出存活会话（诊断 / 恢复用）。 */
function list(): Promise<TerminalInfo[]> {
  return invoke<TerminalInfo[]>(CHANNELS.TERMINAL.LIST)
}

/** 把 cwd 规范成与 Hub 一致的 `agent:<canonical>`（跳转 / 匹配用）。 */
function resolveAgentId(cwd: string): Promise<string> {
  return invoke<string>(CHANNELS.TERMINAL.RESOLVE_AGENT_ID, { cwd })
}

/** 读取系统默认终端字体（Windows Terminal 默认 profile / conhost 注册表）。 */
function font(): Promise<TerminalFont> {
  return invoke<TerminalFont>(CHANNELS.TERMINAL.FONT)
}

const Terminal = {
  create,
  attach,
  write,
  resize,
  kill,
  list,
  resolveAgentId,
  font
}

export { Terminal, parseTerminalBytes }
export type { TerminalCreated, TerminalFont, TerminalInfo, TerminalCreatedWithChannel }
