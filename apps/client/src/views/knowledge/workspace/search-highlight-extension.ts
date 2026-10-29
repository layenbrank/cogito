/**
 * 文档内查找高亮：全部命中 + 当前项（ProseMirror Decoration）。
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Editor } from '@tiptap/react'

interface SearchHighlightMeta {
  query: string
  isMatchCase: boolean
  isWholeWord: boolean
  isRegex: boolean
  activeFrom: number
  activeTo: number
}

interface SearchHighlightPluginState {
  meta: SearchHighlightMeta | null
  decorations: DecorationSet
}

const SEARCH_HIGHLIGHT_KEY = new PluginKey<SearchHighlightPluginState>('searchHighlight')

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildFinder(meta: SearchHighlightMeta): RegExp | null {
  const raw = meta.query
  if (!raw) return null
  try {
    const source = meta.isRegex ? raw : escapeRegExp(raw)
    const wrapped = meta.isWholeWord ? `\\b(?:${source})\\b` : source
    return new RegExp(wrapped, meta.isMatchCase ? 'g' : 'gi')
  } catch (error) {
    console.warn('[markdown] 高亮正则无效', error)
    return null
  }
}

function buildDecorations(
  doc: ProseMirrorNode,
  meta: SearchHighlightMeta
): DecorationSet {
  const pattern = buildFinder(meta)
  if (!pattern) return DecorationSet.empty

  const decorations: Decoration[] = []
  doc.descendants(function (node, pos) {
    if (!node.isText || !node.text) return true
    pattern.lastIndex = 0
    let match = pattern.exec(node.text)
    while (match) {
      const from = pos + match.index
      const to = from + match[0].length
      if (to > from) {
        const isCurrent = from === meta.activeFrom && to === meta.activeTo
        decorations.push(
          Decoration.inline(from, to, {
            class: isCurrent ? 'md-search-hit md-search-hit-current' : 'md-search-hit'
          })
        )
      }
      if (!pattern.global) break
      if (match[0].length === 0) pattern.lastIndex += 1
      match = pattern.exec(node.text)
    }
    return true
  })
  return DecorationSet.create(doc, decorations)
}

const SearchHighlight = Extension.create({
  name: 'searchHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchHighlightPluginState>({
        key: SEARCH_HIGHLIGHT_KEY,
        state: {
          init() {
            return { meta: null, decorations: DecorationSet.empty }
          },
          apply(tr, value) {
            const incoming = tr.getMeta(SEARCH_HIGHLIGHT_KEY) as
              | SearchHighlightMeta
              | null
              | undefined
            if (incoming === null) {
              return { meta: null, decorations: DecorationSet.empty }
            }
            if (incoming) {
              return {
                meta: incoming,
                decorations: buildDecorations(tr.doc, incoming)
              }
            }
            if (tr.docChanged && value.meta) {
              return {
                meta: value.meta,
                decorations: buildDecorations(tr.doc, value.meta)
              }
            }
            if (tr.docChanged) {
              return {
                meta: value.meta,
                decorations: value.decorations.map(tr.mapping, tr.doc)
              }
            }
            return value
          }
        },
        props: {
          decorations(state) {
            return SEARCH_HIGHLIGHT_KEY.getState(state)?.decorations ?? null
          }
        }
      })
    ]
  }
})

function writeSearchHighlight(
  editor: Editor,
  meta: SearchHighlightMeta | null
): void {
  const { tr } = editor.state
  tr.setMeta(SEARCH_HIGHLIGHT_KEY, meta)
  // 避免进入历史栈 / 触发 onUpdate 脏标记噪音：仅装饰
  tr.setMeta('addToHistory', false)
  editor.view.dispatch(tr)
}

function clearSearchHighlight(editor: Editor): void {
  writeSearchHighlight(editor, null)
}

export type { SearchHighlightMeta }
export { SearchHighlight, SEARCH_HIGHLIGHT_KEY, writeSearchHighlight, clearSearchHighlight }
