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

export { findParentRelative, findBaseName, normalizeSeparators }
