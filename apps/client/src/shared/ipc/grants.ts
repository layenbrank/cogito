/**
 * 授权集（S1 / 1A）的前端入口。
 *
 * 背景：`capabilities` 里的 `fs:scope` / `assetProtocol.scope` 在 1B 收成了「应用自己的
 * 几个目录」，用户在对话框里挑的任意位置（工作区根、素材文件夹、另存目标）必须
 * 在**当场**追加到运行期 scope，否则第一次读写就被拦。
 *
 * 两个约定：
 * 1. 这里吞掉异常 —— 授权失败不该让「另存 / 打开」整条链断掉，只打 warn，
 *    真正的失败会在后续读写时以可读错误暴露；
 * 2. 去重 + 只传存在的路径由 Rust 侧负责（`security/grants.rs`），前端不重复判断。
 */
import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from './channels'

/**
 * 放行一批路径（文件或目录）。
 *
 * @param paths 用户刚选的绝对路径
 * @param recursive 目录是否递归放行；选「文件夹」时传 true，选单个文件传 false
 */
export async function grantPaths(paths: Array<string | null | undefined>, recursive = true): Promise<number> {
  const list = paths.filter((path): path is string => Boolean(path && path.trim()))
  if (list.length === 0) return 0
  try {
    return await invoke<number>(CHANNELS.SECURITY.GRANT_PATHS, { paths: list, recursive })
  } catch (error) {
    console.warn('[security] 放行路径失败', error)
    return 0
  }
}

/** 重建授权集（设置 → 诊断用：工作区/素材改动后手动刷新）。 */
export async function rebuildGrants(): Promise<{ grantedDirs: number; grantedFiles: number; errors: string[] }> {
  return invoke(CHANNELS.SECURITY.REBUILD)
}
