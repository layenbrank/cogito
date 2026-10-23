import { open as dialogOpen } from '@tauri-apps/plugin-dialog'

import type { PathKind } from './param-ref.ts'

/** 本机选文件或目录；取消返回 null */
async function pickLocalPath(kind: PathKind): Promise<string | null> {
  const selected = await dialogOpen({
    multiple: false,
    directory: kind === 'directory',
    title: kind === 'directory' ? '选择目录' : '选择文件'
  })
  if (selected === null || selected === undefined) return null
  if (typeof selected === 'string') return selected
  if (Array.isArray(selected)) {
    const first = selected[0]
    return typeof first === 'string' ? first : null
  }
  return null
}

export { pickLocalPath }
