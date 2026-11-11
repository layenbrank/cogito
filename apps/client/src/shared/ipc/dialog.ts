/**
 * 对话框门面（S1 / 1A）。
 *
 * 只做一件事：把 plugin-dialog 选中的路径顺手塞进运行期授权集，调用点写法完全不变
 * （`open as dialogOpen` 这类别名照旧可用，因为导出的签名与 plugin-dialog 一致）。
 *
 * 为什么要门面而不是逐个调用点加一行：选路点有 20+ 处，散落着改早晚会漏；
 * 而 `capabilities` 的静态 scope 已经收窄，漏一处就是一处「点了没反应」的线上问题。
 */
import { open as tauriOpen, save as tauriSave } from '@tauri-apps/plugin-dialog'
import type { OpenDialogOptions, SaveDialogOptions } from '@tauri-apps/plugin-dialog'

import { grantPaths } from './grants'

export { ask, confirm, message } from '@tauri-apps/plugin-dialog'

/** 选中结果可能是单路径、多路径或取消。 */
function collect(value: string | string[] | null): string[] {
  if (value === null) return []
  return Array.isArray(value) ? value : [value]
}

const openImpl = async (options?: OpenDialogOptions): Promise<string | string[] | null> => {
  const picked = await tauriOpen(options as never)
  if (picked === null) return null
  // 选目录时递归放行（否则只能列根目录）；选文件时只放行该文件。
  const directory = Boolean(options && 'directory' in options && options.directory)
  await grantPaths(collect(picked), directory)
  return picked
}

const saveImpl = async (options?: SaveDialogOptions): Promise<string | null> => {
  const target = await tauriSave(options as never)
  if (target === null || target === undefined) return null
  await grantPaths([target], false)
  return target
}

/** 与 plugin-dialog 的 `open` 同签名（含 overload 语义），调用点无需改类型。 */
export const open = openImpl as unknown as typeof tauriOpen

/** 与 plugin-dialog 的 `save` 同签名；保存目标当场放行，另存完立刻可写。 */
export const save = saveImpl as unknown as typeof tauriSave
