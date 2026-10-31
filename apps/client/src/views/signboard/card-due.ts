function formatDue(dueAt: number) {
  const date = new Date(dueAt)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${month}-${day}`
}

function dueTone(dueAt: number | null) {
  if (dueAt === null || dueAt === undefined) return null
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  if (dueAt < start.getTime()) return 'overdue'
  const end = start.getTime() + 24 * 60 * 60 * 1000
  if (dueAt < end) return 'today'
  return 'later'
}

export { dueTone, formatDue }
