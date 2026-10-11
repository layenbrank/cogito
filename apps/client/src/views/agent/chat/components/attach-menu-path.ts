function basename(path: string) {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts.filter(Boolean).pop() ?? path
}

function rootLabel(path: string) {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
  }
  return parts[parts.length - 1] ?? path
}

export { basename, rootLabel }
