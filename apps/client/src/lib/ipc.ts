/**
 * corex-daemon IPC 传输层（对齐 crates/ipc Response）
 * 领域 API 见 morph-ipc / engine-ipc
 */
import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'

type IpcResponse = {
  id: number
  ok: boolean
  path?: string
  data?: unknown
  ms: number
  error?: string
}

async function ipcInvoke(module: string, args: unknown, action?: string): Promise<IpcResponse> {
  return invoke<IpcResponse>(CHANNELS.IPC.INVOKE, { module, args, action })
}

function parseData<T>(resp: IpcResponse): T {
  if (!resp.ok) throw new Error(resp.error ?? `IPC ${resp.id} failed`)

  if (resp.data === undefined || resp.data === null) {
    throw new Error('IPC 响应缺少 data')
  }
  return resp.data as T
}

function parsePath(resp: IpcResponse): string {
  if (!resp.ok) throw new Error(resp.error ?? `IPC ${resp.id} failed`)

  if (typeof resp.path === 'string' && resp.path.length > 0) {
    return resp.path
  }

  // Value::File 经 daemon 序列化为字符串；Tauri 层也会填 path，此处双保险
  if (typeof resp.data === 'string' && resp.data.length > 0) {
    return resp.data
  }

  if (
    resp.data &&
    typeof resp.data === 'object' &&
    !Array.isArray(resp.data) &&
    typeof (resp.data as { path?: unknown }).path === 'string'
  ) {
    return (resp.data as { path: string }).path
  }

  throw new Error('IPC 响应缺少 path')
}

export { ipcInvoke, parseData, parsePath }
export type { IpcResponse }
