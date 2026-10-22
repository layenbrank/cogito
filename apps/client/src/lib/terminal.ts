/**
 * 嵌入式交互终端 IPC：terminal:* 命令 + Channel 字节流。
 *
 * 输出走 Tauri 2 的 `Channel` 原始字节（Rust 侧 `InvokeResponseBody::Raw`），
 * 前端收到 `ArrayBuffer` → `Uint8Array` 喂给 xterm；禁止反复 `invoke` 轮询读。
 */
import { Channel, invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'

interface TerminalCreated {
  id: string
  pid: number | null
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

/** 创建 PTY 会话；`id` 由前端生成，Rust 以其作为会话键。
 *
 * `onmessage` 在 `Channel` 构造时即绑定：Rust 侧同步 spawn 读线程，
 * 首批输出（如 shell banner）可能在 `invoke` 返回前到达，晚绑会丢首包。
 */
async function create(
  cwd: string,
  id: string,
  onmessage: (data: ArrayBuffer) => void
): Promise<TerminalCreatedWithChannel> {
  const channel = new Channel<ArrayBuffer>(onmessage)
  const created = await invoke<TerminalCreated>(CHANNELS.TERMINAL.CREATE, { cwd, id, channel })
  return { id: created.id, pid: created.pid, channel }
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

/** 读取系统默认终端字体（Windows Terminal 默认 profile / conhost 注册表）。 */
function font(): Promise<TerminalFont> {
  return invoke<TerminalFont>(CHANNELS.TERMINAL.FONT)
}

const Terminal = {
  create,
  write,
  resize,
  kill,
  list,
  font
}

export { Terminal }
export type { TerminalCreated, TerminalFont, TerminalInfo, TerminalCreatedWithChannel }
