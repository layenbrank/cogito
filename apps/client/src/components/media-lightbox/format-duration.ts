function pad2(value: number) {
  return String(value).padStart(2, '0')
}

function formatDuration(ms: number | undefined): string {
  if (!ms || ms < 0) return ''
  const total = Math.round(ms / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${pad2(seconds)}`
}

export { formatDuration }
