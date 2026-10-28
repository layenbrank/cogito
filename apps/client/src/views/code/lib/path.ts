function normalizeSeparators(path: string): string {
  return path.replace(/\\/g, '/')
}

function findFileName(path: string): string {
  const normalized = normalizeSeparators(path)
  const segments = normalized.split('/')
  return segments[segments.length - 1] || path
}

function findParentDir(path: string): string {
  const normalized = normalizeSeparators(path)
  const index = normalized.lastIndexOf('/')
  if (index <= 0) return normalized
  return normalized.slice(0, index)
}

function findExtension(path: string): string {
  const name = findFileName(path)
  const index = name.lastIndexOf('.')
  if (index <= 0) return ''
  return name.slice(index + 1).toLowerCase()
}

/** 校验 candidate 是否落在 root 之下（防路径穿越） */
function isPathInsideRoot(root: string, candidate: string): boolean {
  const rootNorm = normalizeSeparators(root).replace(/\/+$/, '').toLowerCase()
  const candNorm = normalizeSeparators(candidate).replace(/\/+$/, '').toLowerCase()
  if (candNorm === rootNorm) return true
  return candNorm.startsWith(`${rootNorm}/`)
}

function joinPath(base: string, relative: string): string {
  const baseNorm = normalizeSeparators(base).replace(/\/+$/, '')
  const relNorm = normalizeSeparators(relative).replace(/^\/+/, '')
  if (!relNorm) return baseNorm
  return `${baseNorm}/${relNorm}`
}

/** 同一路径比较：Windows 下大小写不敏感，分隔符也要归一 */
function isSamePath(a: string, b: string): boolean {
  return normalizeSeparators(a).toLowerCase() === normalizeSeparators(b).toLowerCase()
}

/** 将绝对路径转为相对 workspace root 的路径；不在 root 下则返回文件名 */
function findRelativePath(root: string, absolute: string): string {
  const rootNorm = normalizeSeparators(root).replace(/\/+$/, '')
  const absNorm = normalizeSeparators(absolute)
  const rootLower = rootNorm.toLowerCase()
  const absLower = absNorm.toLowerCase()
  if (absLower === rootLower) return ''
  if (absLower.startsWith(`${rootLower}/`)) {
    return absNorm.slice(rootNorm.length + 1)
  }
  return findFileName(absolute)
}

/** 面包屑分段（相对路径） */
function findPathSegments(relativeOrAbsolute: string): string[] {
  return normalizeSeparators(relativeOrAbsolute)
    .split('/')
    .filter(Boolean)
}

/**
 * 文件/目录重命名后，把旧路径映射到新路径。
 * 不相关（既不相同也不在目录下）时返回 null。
 */
function relocatePath(
  path: string,
  fromPath: string,
  toPath: string
): string | null {
  if (isSamePath(path, fromPath)) return toPath
  if (!isPathInsideRoot(fromPath, path)) return null
  const fromNorm = normalizeSeparators(fromPath).replace(/\/+$/, '')
  const pathNorm = normalizeSeparators(path)
  const suffix = pathNorm.slice(fromNorm.length)
  return `${normalizeSeparators(toPath).replace(/\/+$/, '')}${suffix}`
}

export {
  normalizeSeparators,
  findFileName,
  findParentDir,
  findExtension,
  isPathInsideRoot,
  isSamePath,
  joinPath,
  findRelativePath,
  findPathSegments,
  relocatePath
}
