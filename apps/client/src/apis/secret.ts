/**
 * 密钥（`secret:*`）接口：OS Keyring 的读 / 写 / 删。
 *
 * 只负责「按 service + account 存取一段字符串」；怎么分层（JWT、provider key）、
 * 什么时候广播给其它窗口，属于 `features/persist/secrets.ts`。
 */
import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'

function GET_SECRET(service: string, account: string): Promise<string | null> {
  return invoke<string | null>(CHANNELS.SECRET.FIND, { service, account })
}

function PUT_SECRET(service: string, account: string, secret: string): Promise<void> {
  return invoke(CHANNELS.SECRET.WRITE, { service, account, secret })
}

function DELETE_SECRET(service: string, account: string): Promise<void> {
  return invoke(CHANNELS.SECRET.REMOVE, { service, account })
}

export { DELETE_SECRET, GET_SECRET, PUT_SECRET }
