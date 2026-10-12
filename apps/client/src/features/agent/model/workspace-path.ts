/**
 * 工作区路径规范化：去 Windows `\\?\`、折叠 `.` / `..`、统一斜杠
 */
function stripWinLongPrefix(path: string) {
  const next = path.replace(/\\/g, '/')
  // \\?\UNC\server\share → //server/share
  if (next.startsWith('//?/UNC/')) return `//${next.slice('//?/UNC/'.length)}`
  // \\?\C:\foo → C:/foo
  if (next.startsWith('//?/')) return next.slice(4)
  return next
}

function normalizePath(path: string) {
  const replaced = stripWinLongPrefix(path)
  const driveMatch = replaced.match(/^([a-zA-Z]:)(\/.*)?$/i)
  if (driveMatch) {
    const drive = driveMatch[1]
    const rest = driveMatch[2] || '/'
    const stack: string[] = []
    rest.split('/').forEach(function (segment) {
      if (!segment || segment === '.') return
      if (segment === '..') {
        stack.pop()
        return
      }
      stack.push(segment)
    })
    const body = stack.join('/')
    return body ? `${drive}/${body}` : `${drive}/`
  }

  const isAbsolute = replaced.startsWith('/')
  const stack: string[] = []
  replaced.split('/').forEach(function (segment) {
    if (!segment || segment === '.') return
    if (segment === '..') {
      if (stack.length) stack.pop()
      else if (!isAbsolute) stack.push('..')
      return
    }
    stack.push(segment)
  })
  const body = stack.join('/')
  if (isAbsolute) return body ? `/${body}` : '/'
  return body.replace(/\/+$/, '')
}

function findIsPathUnderRoots(path: string, roots: string[]) {
  const target = normalizePath(path).toLowerCase()
  return roots.some(function (root) {
    const base = normalizePath(root).toLowerCase()
    return target === base || target.startsWith(`${base}/`)
  })
}

/** 供 convertFileSrc / 缩略图预览使用的路径 */
function findAssetPath(path: string) {
  return normalizePath(path)
}

export { findAssetPath, findIsPathUnderRoots, normalizePath }
