/**
 * 任务执行的目录边界：判断一次工具调用会不会落到任务目录之外。
 *
 * 为什么必须有这一层：会话 cwd 只决定**相对路径**从哪儿展开，goose 的文件/命令工具
 * 仍然接受绝对路径。自动批准档下，模型顺手读写 `~` 或同一工作区的另一个项目，
 * 界面上完全看不出来 —— 用户看到的只是「任务跑完了，但把我的别的目录改了」，
 * 顺带还烧掉一轮 token。这里把「越界」在审批那一刻拦下来，模型立刻收到拒绝，
 * 而不是先改完再说。
 *
 * 纯逻辑、无副作用，单测直接调（`workspace-guard.test.ts`）。
 */

/** 认哪些键是路径：命中才当作候选，避免把 content / command 里的普通文本当路径 */
const PATH_KEY = /(path|file|dir|folder|cwd)/i
const MAX_DEPTH = 4

/** 绝对路径：Windows 盘符 / UNC / POSIX */
function isAbsolutePath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('/') || path.startsWith('\\\\')
}

/** 拆成路径段并抹掉 `.` / `..`：比较前统一成同一形态 */
function toSegments(path: string): string[] {
  const unified = path.replace(/\\/g, '/')
  const segments: string[] = []
  for (const part of unified.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      segments.pop()
      continue
    }
    segments.push(part)
  }
  return segments
}

/** 比较用的键：统一分隔符 + 小写（Windows 大小写不敏感；POSIX 上宁可比得宽也不算漏） */
function toKey(path: string): string {
  return toSegments(path)
    .map(function (part) {
      return part.toLowerCase()
    })
    .join('/')
}

/** 相对路径按 root 展开；空串原样返回 */
function resolvePath(root: string, path: string): string {
  const trimmed = path.trim()
  if (!trimmed) return ''
  if (isAbsolutePath(trimmed)) return trimmed
  return `${root.replace(/[\\/]+$/, '')}/${trimmed}`
}

/** 两个路径是不是同一个（大小写 / 分隔符 / 尾斜杠都不计较） */
function isSamePath(left: string, right: string): boolean {
  return toKey(left) === toKey(right)
}

/** target 是否在 root 之内（root 本身算在内） */
function isWithin(root: string, target: string): boolean {
  const rootKey = toKey(root)
  if (!rootKey) return true
  const targetKey = toKey(target)
  return targetKey === rootKey || targetKey.startsWith(`${rootKey}/`)
}

interface ToolLocations {
  path?: string | null
}

/**
 * 从一次工具调用的入参里挑出「路径类」字符串。
 *
 * 只看键名像路径的字段（path / file / dir / cwd …）：goose 各工具的参数名不完全统一，
 * 用键名匹配比按工具名枚举稳。**不解析 shell 命令串**：命令里的重定向、脚本变量都
 * 无法可靠静态判断，宁可少拦一次，也不要拦错一条正常命令（拦错的代价是任务白跑）。
 */
function collectPaths(value: unknown, key: string, depth: number, found: string[]): void {
  if (depth > MAX_DEPTH) return
  if (typeof value === 'string') {
    if (!PATH_KEY.test(key)) return
    const trimmed = value.trim()
    if (!trimmed) return
    // URL / 协议地址不是本地路径，别当越界
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return
    // 看起来不像路径的（纯标识符）跳过：避免把 "utf-8" 这类值当路径
    if (!isAbsolutePath(trimmed) && !/[\\/]/.test(trimmed) && !trimmed.startsWith('~')) return
    found.push(trimmed)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPaths(item, key, depth + 1, found)
    return
  }
  if (value && typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) {
      collectPaths(childValue, childKey, depth + 1, found)
    }
  }
}

/**
 * 这次工具调用有没有越出 root。
 *
 * 返回越界的原始路径（去重）；空数组 = 放行。
 * 判断不了的（`~` 开头的家目录写法、带变量的模板路径）一律算越界：任务目录是明确给的，
 * 说不清在哪的路径就不该在无人值守的任务里动。
 */
function findOutsidePaths(
  root: string | null | undefined,
  input: unknown,
  locations?: readonly ToolLocations[] | null
): string[] {
  const base = root?.trim()
  if (!base) return []

  const candidates: string[] = []
  collectPaths(input, '', 0, candidates)
  for (const location of locations ?? []) {
    const path = location?.path?.trim()
    if (path) candidates.push(path)
  }

  const seen = new Set<string>()
  const outside: string[] = []
  for (const candidate of candidates) {
    if (candidate.startsWith('~')) {
      if (!seen.has(candidate)) {
        seen.add(candidate)
        outside.push(candidate)
      }
      continue
    }
    if (isWithin(base, resolvePath(base, candidate))) continue
    if (seen.has(candidate)) continue
    seen.add(candidate)
    outside.push(candidate)
  }
  return outside
}

export { findOutsidePaths, isSamePath, isWithin, resolvePath }
