import { NodeSelection, type Selection } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import type { Editor, JSONContent } from '@tiptap/react'
import { isNodeSelection, isTextSelection, posToDOMRect } from '@tiptap/react'
import { t } from '@/views/knowledge/locale.ts'

// TipTap Collaboration / AI：公开标识可走 VITE_；JWT 必须由服务端签发，禁止 VITE_*TOKEN 内联进包
/** 未配置或不是字符串都收敛成空串（`import.meta.env` 索引签名是 any） */
function readEnvText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export const TIPTAP_COLLAB_DOC_PREFIX = readEnvText(import.meta.env.VITE_TIPTAP_COLLAB_DOC_PREFIX)
export const TIPTAP_COLLAB_APP_ID = readEnvText(import.meta.env.VITE_TIPTAP_COLLAB_APP_ID)
export const TIPTAP_AI_APP_ID = readEnvText(import.meta.env.VITE_TIPTAP_AI_APP_ID)

/** 为 true 时从 `/api/collaboration` / `/api/ai` 取 JWT（勿用 VITE_ 放 token） */
export const USE_JWT_API_ENDPOINT =
  import.meta.env.VITE_USE_JWT_API_ENDPOINT === 'true' ||
  import.meta.env.VITE_USE_JWT_API_ENDPOINT === '1'

const NODE_TYPE_LABELS: Record<string, string> = {
  paragraph: t('EDITOR_TEXT'),
  heading: t('EDITOR_HEADING'),
  blockquote: t('EDITOR_BLOCKQUOTE'),
  listItem: t('EDITOR_LIST_ITEM'),
  codeBlock: t('EDITOR_CODE_BLOCK'),
  table: t('EDITOR_TABLE')
}
export type OverflowPosition = 'none' | 'top' | 'bottom' | 'both'

/**
 * Utility function to get URL parameters
 */
export const findUrlParam = (param: string): string | null => {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  return params.get(param)
}

/**
 * Returns a display name for the current node in the editor
 * @param editor The Tiptap editor instance
 * @returns The display name of the current node
 */
export const findNodeDisplayName = (editor: Editor | null): string => {
  if (!editor) return t('EDITOR_NODE')

  const { selection } = editor.state

  if (selection instanceof NodeSelection) {
    const nodeType = selection.node.type.name
    return NODE_TYPE_LABELS[nodeType] || nodeType.toLowerCase()
  }

  if (selection instanceof CellSelection) {
    return t('EDITOR_TABLE')
  }

  const { $anchor } = selection
  const nodeType = $anchor.parent.type.name
  return NODE_TYPE_LABELS[nodeType] || nodeType.toLowerCase()
}

/**
 * Removes empty paragraph nodes from content
 */
export const removeEmptyParagraphs = (content: JSONContent) => ({
  ...content,
  content: content.content?.filter(
    (node) =>
      node.type !== 'paragraph' ||
      node.content?.some((child) => child.text?.trim() || child.type !== 'text')
  )
})

/**
 * Determines how a target element overflows relative to a container element
 */
export function findElementOverflowPosition(
  targetElement: Element,
  containerElement: HTMLElement
): OverflowPosition {
  const targetBounds = targetElement.getBoundingClientRect()
  const containerBounds = containerElement.getBoundingClientRect()

  const isOverflowingTop = targetBounds.top < containerBounds.top
  const isOverflowingBottom = targetBounds.bottom > containerBounds.bottom

  if (isOverflowingTop && isOverflowingBottom) return 'both'
  if (isOverflowingTop) return 'top'
  if (isOverflowingBottom) return 'bottom'
  return 'none'
}

/**
 * Checks if the current selection is valid for a given editor
 */
export const isSelectionValid = (
  editor: Editor | null,
  selection?: Selection,
  excludedNodeTypes: string[] = ['imageUpload', 'horizontalRule']
): boolean => {
  if (!editor) return false
  if (!selection) selection = editor.state.selection

  const { state } = editor
  const { doc } = state
  const { empty, from, to } = selection

  const isEmptyTextBlock = !doc.textBetween(from, to).length && isTextSelection(selection)
  const isCodeBlock =
    selection.$from.parent.type.spec.code ||
    (isNodeSelection(selection) && selection.node.type.spec.code)
  const isExcludedNode =
    isNodeSelection(selection) && excludedNodeTypes.includes(selection.node.type.name)
  const isTableCell = selection instanceof CellSelection

  return !empty && !isEmptyTextBlock && !isCodeBlock && !isExcludedNode && !isTableCell
}

/**
 * Checks if the current text selection is valid for editing
 * - Not empty
 * - Not a code block
 * - Not a node selection
 */
export const isTextSelectionValid = (editor: Editor | null): boolean => {
  if (!editor) return false
  const { state } = editor
  const { selection } = state
  const isValid =
    isTextSelection(selection) &&
    !selection.empty &&
    !selection.$from.parent.type.spec.code &&
    !isNodeSelection(selection)

  return isValid
}

/**
 * Gets the bounding rect of the current selection in the editor.
 */
export const findSelectionBoundingRect = (editor: Editor): DOMRect | null => {
  const { state } = editor.view
  const { selection } = state
  const { ranges } = selection

  const from = Math.min(...ranges.map((range) => range.$from.pos))
  const to = Math.max(...ranges.map((range) => range.$to.pos))

  if (isNodeSelection(selection)) {
    const node = editor.view.nodeDOM(from) as HTMLElement
    if (node) {
      return node.getBoundingClientRect()
    }
  }

  return posToDOMRect(editor.view, from, to)
}

/**
 * Generates a deterministic avatar URL from a user name
 */
export const findAvatar = (name: string) => {
  if (!name) {
    return '/avatars/memoji_01.png'
  }

  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
    hash = hash & hash
  }

  const randomFraction = (Math.abs(hash) % 1000000) / 1000000
  const id = 1 + Math.floor(randomFraction * 20)
  const idString = id.toString().padStart(2, '0')
  return `/avatars/memoji_${idString}.png`
}

/**
 * Fetch collaboration JWT from the server-issued endpoint.
 * Never read JWT from `VITE_*` — those values are inlined into the client bundle.
 */
export async function fetchCollabToken() {
  if (!USE_JWT_API_ENDPOINT) {
    console.warn(
      '[tiptap] Set VITE_USE_JWT_API_ENDPOINT=true and implement POST /api/collaboration that returns { token }'
    )
    return null
  }
  try {
    const response = await fetch('/api/collaboration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
    if (!response.ok) {
      throw new Error(`Failed to fetch collaboration JWT: ${response.status}`)
    }
    const data = (await response.json()) as { token?: string }
    return data.token ?? null
  } catch (error) {
    console.error('Failed to fetch collaboration JWT:', error)
    return null
  }
}

/**
 * Fetch AI JWT from the server-issued endpoint.
 * Never read JWT from `VITE_*` — those values are inlined into the client bundle.
 */
export async function fetchAiToken() {
  if (!USE_JWT_API_ENDPOINT) {
    console.warn(
      '[tiptap] Set VITE_USE_JWT_API_ENDPOINT=true and implement POST /api/ai that returns { token }'
    )
    return null
  }
  try {
    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
    if (!response.ok) {
      throw new Error(`Failed to fetch AI JWT: ${response.status}`)
    }
    const data = (await response.json()) as { token?: string }
    return data.token ?? null
  } catch (error) {
    console.error('Failed to fetch AI JWT:', error)
    return null
  }
}
