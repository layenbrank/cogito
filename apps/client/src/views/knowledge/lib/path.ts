const MARKDOWN_EXTS = ['.md', '.markdown', '.mdx']
/** 可进 TipTap 编辑的纯文本（对齐 llm_wiki 源目录不只 md） */
const EDITABLE_NOTE_EXTS = [...MARKDOWN_EXTS, '.txt']

function normalizeSeparators(path: string): string {
  return path.replace(/\\/g, '/')
}

function findFileName(path: string): string {
  const normalized = normalizeSeparators(path)
  const segments = normalized.split('/')
  return segments[segments.length - 1] || path
}

function findParentDir(path: string): string {
  const useWin = isWindowsAbsolute(path)
  const normalized = normalizeSeparators(path)
  const index = normalized.lastIndexOf('/')
  if (index <= 0) {
    return useWin ? path.replace(/\//g, '\\') : normalized
  }
  const parent = normalized.slice(0, index)
  return useWin ? parent.replace(/\//g, '\\') : parent
}

function isMarkdownName(name: string): boolean {
  const lower = name.toLowerCase()
  return MARKDOWN_EXTS.some(function (ext) {
    return lower.endsWith(ext)
  })
}

/** 笔记编辑器可直接打开；PDF / 图片等走系统应用 */
function isEditableNoteName(name: string): boolean {
  const lower = name.toLowerCase()
  return EDITABLE_NOTE_EXTS.some(function (ext) {
    return lower.endsWith(ext)
  })
}

function isSamePath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return (
    normalizeSeparators(a).replace(/\/+$/, '').toLowerCase() ===
    normalizeSeparators(b).replace(/\/+$/, '').toLowerCase()
  )
}

/** 校验 candidate 是否落在 root 之下（防路径穿越） */
function isPathInsideRoot(root: string, candidate: string): boolean {
  const rootNorm = normalizeSeparators(root).replace(/\/+$/, '').toLowerCase()
  const candNorm = normalizeSeparators(candidate).replace(/\/+$/, '').toLowerCase()
  if (candNorm === rootNorm) return true
  return candNorm.startsWith(`${rootNorm}/`)
}

/** Windows 盘符 / UNC；带 `\\?\` 前缀时必须全程反斜杠，否则 mkdir 报 os error 123 */
function isWindowsAbsolute(path: string): boolean {
  return (
    /^[a-zA-Z]:[\\/]/.test(path) ||
    path.startsWith('\\\\') ||
    path.startsWith('//?/') ||
    path.startsWith('\\\\?\\')
  )
}

/**
 * 拼接绝对路径。Windows 盘符路径用 `\`，避免 `C:\\foo/bar` 混用斜杠。
 * 比较路径请继续用 `normalizeSeparators`。
 */
function joinPath(base: string, relative: string): string {
  const useWin = isWindowsAbsolute(base)
  const sep = useWin ? '\\' : '/'
  const baseNorm = base.replace(/[\\/]+$/, '')
  const relNorm = relative.replace(/^[\\/]+/, '').replace(/[\\/]+/g, sep)
  if (!relNorm) return useWin ? baseNorm.replace(/\//g, '\\') : normalizeSeparators(baseNorm)
  const baseNative = useWin ? baseNorm.replace(/\//g, '\\') : normalizeSeparators(baseNorm)
  return `${baseNative}${sep}${relNorm}`
}

export {
  MARKDOWN_EXTS,
  EDITABLE_NOTE_EXTS,
  normalizeSeparators,
  findFileName,
  findParentDir,
  isMarkdownName,
  isEditableNoteName,
  isSamePath,
  isPathInsideRoot,
  joinPath
}
