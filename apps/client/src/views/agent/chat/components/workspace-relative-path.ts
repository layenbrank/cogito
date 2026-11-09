/**
 * 工作区路径的展示工具：右栏文件树 / 审阅 / 历史 / composer 共用。
 *
 * 这些面板里的路径都相对**某一个**根成立，所以「根叫什么」必须能看清 ——
 * 一个工作区可以挂多个文件夹，而 `apps/api` 与 `services/api` 的末段名是一样的。
 */
function normalizeSeparators(path: string) {
  return path.replace(/\\/g, '/')
}

function findParentRelative(relative: string) {
  const normalized = normalizeSeparators(relative)
  if (!normalized.includes('/')) return ''
  return normalized.slice(0, normalized.lastIndexOf('/'))
}

function findBaseName(path: string) {
  const normalized = normalizeSeparators(path)
  const slash = normalized.lastIndexOf('/')
  return slash < 0 ? normalized : normalized.slice(slash + 1)
}

/**
 * 文件夹的展示名：默认就是末段名，**重名时补上一级目录**，
 * 否则两个 `api` 并排出现，用户没法判断当前在哪个项目里。
 *
 * 返回 `path → label`，调用方按自己的顺序取用。
 */
function buildFolderLabels(paths: readonly string[]): Map<string, string> {
  const seen = new Map<string, number>()
  for (const path of paths) {
    const name = findBaseName(path).toLowerCase()
    seen.set(name, (seen.get(name) ?? 0) + 1)
  }

  const labels = new Map<string, string>()
  for (const path of paths) {
    const name = findBaseName(path)
    if ((seen.get(name.toLowerCase()) ?? 0) <= 1) {
      labels.set(path, name)
      continue
    }
    const parent = findBaseName(findParentRelative(path))
    labels.set(path, parent ? `${parent}/${name}` : name)
  }
  return labels
}

function findFolderLabel(labels: Map<string, string>, path: string) {
  return labels.get(path) ?? findBaseName(path)
}

/**
 * `@` 面板里按 Tab 时的补全路径：推进到**下一层目录**。
 *
 * - `apps/cli` + `apps/client/src/a.ts` → `apps/client/`（能接着往里打）
 * - 搜索命中中间片段时（`butt` → `apps/client/src/button.tsx`）补到那一层的末尾
 * - 已经是完整路径时返回 `null`，调用方改为把候选落成 chip
 *
 * 入参是**面板里显示的相对路径**（多根时带文件夹名），不是引用路径 ——
 * 绝对路径打进 `@` 搜索里是搜不出来的。
 */
function completePathSegment(
  displayPath: string,
  query: string,
  isDirectory: boolean
): string | null {
  const target = normalizeSeparators(displayPath)
  let typed = normalizeSeparators(query.trim())
  while (typed.startsWith('./')) typed = typed.slice(2)
  typed = typed.replace(/^\/+/, '')
  const lowerTarget = target.toLowerCase()
  const lowerTyped = typed.toLowerCase()
  if (typed.length === 0) return isDirectory ? `${target}/` : target
  if (lowerTarget === lowerTyped) return null
  if (isDirectory && `${lowerTarget}/` === lowerTyped) return null
  const hit = lowerTarget.indexOf(lowerTyped)
  const from = hit >= 0 ? hit + typed.length : 0
  const slash = target.indexOf('/', from)
  if (slash < 0) return isDirectory ? `${target}/` : target
  const next = target.slice(0, slash + 1)
  return next.toLowerCase() === lowerTyped ? null : next
}

export {
  buildFolderLabels,
  completePathSegment,
  findBaseName,
  findFolderLabel,
  findParentRelative,
  normalizeSeparators
}
