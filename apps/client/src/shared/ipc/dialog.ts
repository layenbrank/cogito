/**
 * 对话框门面（S1 / 1A）。
 *
 * 只做一件事：把 plugin-dialog 选中的路径顺手塞进运行期授权集，调用点写法完全不变
 * （`open as dialogOpen` 这类别名照旧可用，因为导出的签名与 plugin-dialog 一致）。
 *
 * 为什么要门面而不是逐个调用点加一行：选路点有 20+ 处，散落着改早晚会漏；
 * 而 `capabilities` 的静态 scope 已经收窄，漏一处就是一处「点了没反应」的线上问题。
 */
import type { OpenDialogOptions, SaveDialogOptions } from '@tauri-apps/plugin-dialog'
import { open as tauriOpen, save as tauriSave } from '@tauri-apps/plugin-dialog'

import { grantPaths } from './grants'

export { ask, confirm, message } from '@tauri-apps/plugin-dialog'

/** 选路结果：取消 / 单文件 / 多文件三种形态 */
type PickedPath = string | string[] | null

/** 选中结果归成路径数组：取消为空，多选展开，单选包一层 */
function collect(value: PickedPath): string[] {
  if (value === null) return []
  return Array.isArray(value) ? value : [value]
}

/**
 * `plugin-dialog` 的 `open` 是泛型签名（返回值跟着 `directory` / `multiple` 收窄），
 * 实现体内部只能按「宽并集」处理；`options` 直接传即可，泛型会推断成
 * `OpenDialogReturn<OpenDialogOptions>`（= 宽并集），不需要断言。
 */
const openImpl = async (options?: OpenDialogOptions): Promise<PickedPath> => {
  const picked = await tauriOpen(options)
  if (picked === null) return null
  // 选目录时递归放行（否则只能列根目录）；选文件时只放行该文件。
  await grantPaths(collect(picked), options?.directory === true)
  return picked
}

const saveImpl = async (options?: SaveDialogOptions): Promise<string | null> => {
  const target = await tauriSave(options)
  if (target === null || target === undefined) return null
  await grantPaths([target], false)
  return target
}

/**
 * 对外仍是 `plugin-dialog` 的原始签名（含 overload / 泛型收窄），调用点无需改类型。
 * 这一次断言只说「实现体覆盖了全部重载」，不是「类型对不上凑合一下」：
 * 两者参数一致、返回值是各分支的并集，所以是安全的方向。
 * `save` 没有泛型，直接标注成插件签名即可，不需要断言。
 */
export const open = openImpl as unknown as typeof tauriOpen

/** 与 plugin-dialog 的 `save` 同签名；保存目标当场放行，另存完立刻可写。 */
export const save: typeof tauriSave = saveImpl
