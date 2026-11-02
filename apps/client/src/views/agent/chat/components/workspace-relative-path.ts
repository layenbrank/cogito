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

export { buildFolderLabels, findBaseName, findFolderLabel, findParentRelative, normalizeSeparators }
