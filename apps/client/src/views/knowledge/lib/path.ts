const MARKDOWN_EXTS = ['.md', '.markdown', '.mdx']

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

function isMarkdownName(name: string): boolean {
  const lower = name.toLowerCase()
  return MARKDOWN_EXTS.some(function (ext) {
    return lower.endsWith(ext)
  })
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

export {
  MARKDOWN_EXTS,
  normalizeSeparators,
  findFileName,
  findParentDir,
  isMarkdownName,
  isPathInsideRoot,
  joinPath
}
