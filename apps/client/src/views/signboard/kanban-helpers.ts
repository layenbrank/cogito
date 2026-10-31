import type { SignboardEntry } from '@/stores/signboard'

function parseSemantic(column: { title: string; index: number; role: string | null }) {
  if (column.role === 'todo' || column.role === 'doing' || column.role === 'done') {
    return column.role
  }
  const title = column.title
  if (title.includes('完成') || title.toLowerCase().includes('done')) return 'done' as const
  if (title.includes('进行') || title.toLowerCase().includes('doing')) return 'doing' as const
  if (column.index === 0 || title.includes('待办')) return 'todo' as const
  return 'other' as const
}

function findEntriesInColumn(entries: SignboardEntry[], columnID: string) {
  return entries
    .filter(function (card) {
      return card.columnID === columnID && card.archivedAt === null
    })
    .slice()
    .sort(function (a, b) {
      return a.index - b.index
    })
}

function findCardColumnID(entries: SignboardEntry[], cardID: string) {
  const card = entries.find(function (row) {
    return row.id === cardID
  })
  return card?.columnID ?? null
}

export { findCardColumnID, findEntriesInColumn, parseSemantic }
