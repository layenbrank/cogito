/**
 * 工作区路径判定（渲染侧，纯函数）。
 *
 * 一个工作区可以挂多个文件夹（frontend / backend / docs…），它们是**平级根**，
 * 谁也不是谁的子目录。所以这里有两套口径：
 *
 * - **相对路径**：只对某个根成立，用于审阅 / 文件树 / 文件预览这类「单根 UI」；
 * - **引用路径**：交给 agent 的路径。会话 cwd 只等于**主文件夹**，因此主文件夹内给
 *   相对路径，其余文件夹给绝对路径，否则 agent 会拿着 `src/x.ts` 去主文件夹里找。
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

/** 绝对路径（POSIX `/…` 或 Windows `C:/…`） */
function isAbsolutePath(value: string) {
  const normalized = normalizeSlashes(value)
  return normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)
}

/** 这条绝对路径属于哪个工作区文件夹（最长前缀命中；文件夹自身也算） */
function findOwningRoot(absolutePath: string, roots: readonly string[]): string | null {
  const target = normalizeSlashes(absolutePath).toLowerCase()
  if (!target) return null
  let best: string | null = null
  let bestLength = -1
  for (const path of roots) {
    const root = normalizeSlashes(path).toLowerCase()
    if (!root) continue
    if (target !== root && !target.startsWith(`${root}${SLASH}`)) continue
    if (root.length > bestLength) {
      best = path
      bestLength = root.length
    }
  }
  return best
}

/** 拼工作区内的绝对路径（统一 `/`，不处理 `..`） */
function joinWorkspacePath(rootPath: string, relative: string) {
  const root = normalizeSlashes(rootPath)
  const rest = normalizeSlashes(relative).replace(/^\/+/, '')
  if (!rest) return root
  return `${root}/${rest}`
}

/**
 * 交给 agent 的引用路径。
 *
 * cwd 只等于工作区**主文件夹**：主文件夹内的路径压成相对（可读、也和既有约定一致），
 * 其他文件夹一律给绝对路径 —— 相对路径在那儿解析不了。根自身（`.`）也走绝对路径。
 */
function toAgentPath(absolutePath: string, agentRoot: string | null) {
  const normalized = normalizeSlashes(absolutePath)
  if (!normalized) return normalized
  if (agentRoot) {
    const relative = findWorkspaceRelative(normalized, agentRoot)
    if (relative && relative !== '.') return relative
  }
  return normalized
}

/**
 * `@api/src` 这类查询里挑出工作区文件夹前缀：命中就只搜这个文件夹。
 * 返回剩下的查询串（可能为空，表示「列出该文件夹顶层」）。
 *
 * `roots` 由调用方按「当前文件夹优先」排好序：两个文件夹同名时先命中正在看的那个。
 */
function splitFolderScope(
  roots: readonly string[],
  query: string
): { root: string; query: string } | null {
  if (!query) return null
  const slash = query.indexOf(SLASH)
  const head = (slash < 0 ? query : query.slice(0, slash)).toLowerCase()
  if (!head) return null
  const hit = roots.find(function (path) {
    return toBaseName(path).toLowerCase() === head
  })
  if (!hit) return null
  return { root: hit, query: slash < 0 ? '' : query.slice(slash + 1) }
}

/**
 * 「文件夹 + 文件夹内相对路径」→ 交给 agent 的引用路径。
 * 文件树 / 审阅 / 历史里的路径都只相对某个根成立，不能直接当引用路径用。
 */
function toAgentReference(rootPath: string, relative: string, agentRoot: string | null) {
  return toAgentPath(joinWorkspacePath(rootPath, relative), agentRoot)
}

interface WorkspacePicks {
  /** 交给 agent 的引用路径（主文件夹内相对，其他文件夹绝对） */
  references: string[]
  /** 不在工作区任何文件夹内的项（按名提示） */
  skipped: string[]
}

/**
 * 系统对话框挑出来的路径 → 引用路径。
 *
 * 以前只认一个根，挂在同一个工作区里的其他文件夹会被当成「不在工作区内」直接跳过。
 */
function resolveWorkspacePicks(
  paths: readonly string[],
  roots: readonly string[],
  agentRoot: string | null
): WorkspacePicks {
  const references: string[] = []
  const skipped: string[] = []
  const seen = new Set<string>()

  for (const path of paths) {
    if (!findOwningRoot(path, roots)) {
      skipped.push(toBaseName(path))
      continue
    }
    const reference = toAgentPath(path, agentRoot)
    if (seen.has(reference)) continue
    seen.add(reference)
    references.push(reference)
  }

  return { references, skipped }
}

export {
  findOwningRoot,
  findWorkspaceRelative,
  isAbsolutePath,
  joinWorkspacePath,
  resolveWorkspacePicks,
  splitFolderScope,
  toAgentPath,
  toAgentReference,
  toBaseName
}
export type { WorkspacePicks }
