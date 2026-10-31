function findParentRelative(relative: string) {
  if (!relative.includes('/')) return ''
  return relative.slice(0, relative.lastIndexOf('/'))
}

function findBaseName(relative: string) {
  const slash = relative.lastIndexOf('/')
  return slash < 0 ? relative : relative.slice(slash + 1)
}

export { findParentRelative, findBaseName }
