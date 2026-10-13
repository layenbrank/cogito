/**
 * 工作区路径判定（渲染侧，纯函数）。
 *
 * 系统对话框可能挑到工作区外；Agent 读文件只认根内相对路径，先在此判定归属。
 */

const SLASH = '/'

function normalizeSlashes(value: string) {
  return value.replace(/\\/g, SLASH).replace(/\/+$/, '')
}

function toBaseName(value: string) {
  const parts = normalizeSlashes(value).split(SLASH)
  return parts.filter(Boolean).pop() ?? value
}

/**
 * 绝对路径 → 工作区内相对路径；不在工作区内返回 `null`。
 * 等于根自身时返回 `.`（调用方通常应跳过）。
 */
function findWorkspaceRelative(absolutePath: string, rootPath: string) {
  const target = normalizeSlashes(absolutePath)
  const root = normalizeSlashes(rootPath)
  if (!target || !root) return null

  const targetKey = target.toLowerCase()
  const rootKey = root.toLowerCase()
  if (targetKey === rootKey) return '.'
  if (!targetKey.startsWith(`${rootKey}${SLASH}`)) return null

  return target.slice(root.length + 1)
}

interface WorkspacePicks {
  relatives: string[]
  skipped: string[]
}

function resolveWorkspacePicks(paths: readonly string[], rootPath: string): WorkspacePicks {
  const relatives: string[] = []
  const skipped: string[] = []

  for (const path of paths) {
    const relative = findWorkspaceRelative(path, rootPath)
    if (!relative || relative === '.') {
      skipped.push(toBaseName(path))
      continue
    }
    if (!relatives.includes(relative)) relatives.push(relative)
  }

  return { relatives, skipped }
}

export { findWorkspaceRelative, resolveWorkspacePicks, toBaseName }
export type { WorkspacePicks }
