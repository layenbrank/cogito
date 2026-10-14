import type { Editor, JSONContent } from '@tiptap/react'

interface OutlineItem {
  id: string
  level: number
  text: string
  pos: number
}

function findHeadingText(node: JSONContent): string {
  if (!node.content) return ''
  return node.content
    .map(function (child) {
      if (child.type === 'text') return child.text ?? ''
      return findHeadingText(child)
    })
    .join('')
}

function findOutlineFromEditor(editor: Editor | null): OutlineItem[] {
  if (!editor) return []
  const items: OutlineItem[] = []
  editor.state.doc.descendants(function (node, pos) {
    if (node.type.name !== 'heading') return true
    const level = Number(node.attrs.level ?? 1)
    const text = node.textContent.trim()
    if (!text) return true
    items.push({
      id: `h-${pos}`,
      level,
      text,
      pos
    })
    return true
  })
  return items
}

function findOutlineFromMarkdown(source: string): OutlineItem[] {
  const items: OutlineItem[] = []
  const lines = source.split(/\r?\n/)
  let offset = 0
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    const matched = /^(#{1,6})\s+(.+)$/.exec(line)
    if (matched) {
      items.push({
        id: `md-${i}`,
        level: matched[1]?.length ?? 1,
        text: (matched[2] ?? '').trim(),
        pos: offset
      })
    }
    offset += line.length + 1
  }
  return items
}

export type { OutlineItem }
export { findOutlineFromEditor, findOutlineFromMarkdown }
