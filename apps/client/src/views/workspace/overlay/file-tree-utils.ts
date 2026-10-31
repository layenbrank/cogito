function isSameTreeKey(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()
}

function rowPadLeft(depth: number): number {
  return 8 + depth * 12
}

export { isSameTreeKey, rowPadLeft }
