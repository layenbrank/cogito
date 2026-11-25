/**
 * `[[` 自动补全：输入双中括号弹出当前空间的页面列表，回车插入 wikilink。
 *
 * 用 `@tiptap/suggestion` 的受管挂载（`props.mount`）做定位，弹层本身是 React root —
 * 不用 `ReactRenderer` 是因为它要求组件改成 forwardRef + imperative handle，
 * 这里只需要「重画一次列表」，`root.render` 更直白。
 *
 * 键盘交互（↑↓ / Enter / Esc）在 `onKeyDown` 里处理：suggestion 插件已经把这些键从编辑器
 * 拦下，交给弹层后不会再落进正文。
 */
import { Extension, type Editor } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import {
  Suggestion,
  type SuggestionKeyDownProps,
  type SuggestionProps
} from '@tiptap/suggestion'
import { createRoot, type Root } from 'react-dom/client'

import { useSpacesStore } from '@/stores/spaces'
import {
  WikiLinkSuggestList,
  type WikiLinkCandidate
} from '@/views/knowledge/workspace/wikilink-suggest-list.tsx'

const WIKILINK_SUGGEST_KEY = new PluginKey('wikilinkSuggest')

/** 插入的马克属性与 `wikilink-extension` 的 parseHTML 对齐 */
function toInsertable(title: string) {
  return {
    type: 'text',
    text: title,
    marks: [{ type: 'wikilink', attrs: { title, alias: null } }]
  }
}

function findCandidates(query: string): WikiLinkCandidate[] {
  const normalized = query.trim().toLowerCase()
  const seen = new Set<string>()
  const titles: string[] = []
  for (const doc of useSpacesStore.getState().docs) {
    const title = doc.title.trim()
    if (!title) continue
    const key = title.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    titles.push(title)
  }
  const matched = normalized
    ? titles.filter(function (title) {
        return title.toLowerCase().includes(normalized)
      })
    : titles
  return matched
    .sort(function (left, right) {
      return left.localeCompare(right)
    })
    .slice(0, 8)
    .map(function (title) {
      return { title }
    })
}

const WikilinkSuggest = Extension.create({
  name: 'wikilinkSuggest',

  addProseMirrorPlugins() {
    const editor: Editor = this.editor
    let root: Root | null = null
    let unmount: (() => void) | null = null
    let items: WikiLinkCandidate[] = []
    let query = ''
    let selectedIndex = 0
    let selected: ((candidate: WikiLinkCandidate) => void) | null = null

    function paint() {
      if (!root) return
      root.render(
        <WikiLinkSuggestList
          query={query}
          items={items}
          selectedIndex={selectedIndex}
          onSelect={function (candidate) {
            selected?.(candidate)
          }}
        />
      )
    }

    function apply(props: SuggestionProps<WikiLinkCandidate, WikiLinkCandidate>) {
      items = props.items
      query = props.query
      if (selectedIndex >= items.length) selectedIndex = 0
      selected = function (candidate) {
        props.command(candidate)
      }
    }

    return [
      Suggestion<WikiLinkCandidate, WikiLinkCandidate>({
        editor,
        pluginKey: WIKILINK_SUGGEST_KEY,
        char: '[[',
        // `[[` 常紧贴中文或标点出现，默认「只允许空格前缀」会漏触发
        allowedPrefixes: null,
        allowSpaces: true,
        decorationClass: 'wikilink-suggest-hit',
        items(props) {
          return findCandidates(props.query)
        },
        command(props) {
          props.editor
            .chain()
            .focus()
            .deleteRange(props.range)
            .insertContent(toInsertable(props.props.title))
            .insertContent(' ')
            .run()
        },
        render() {
          return {
            onStart(props: SuggestionProps<WikiLinkCandidate, WikiLinkCandidate>) {
              apply(props)
              selectedIndex = 0
              if (!root) {
                // mount 会把容器追加到 body 并负责定位（scroll / resize 自动跟随）
                const container = document.createElement('div')
                container.className = 'z-50'
                unmount = props.mount(container)
                root = createRoot(container)
              }
              paint()
            },
            onUpdate(props: SuggestionProps<WikiLinkCandidate, WikiLinkCandidate>) {
              apply(props)
              paint()
            },
            onKeyDown(props: SuggestionKeyDownProps) {
              if (items.length === 0) return false
              if (props.event.key === 'ArrowDown') {
                selectedIndex = (selectedIndex + 1) % items.length
                paint()
                return true
              }
              if (props.event.key === 'ArrowUp') {
                selectedIndex = (selectedIndex - 1 + items.length) % items.length
                paint()
                return true
              }
              if (props.event.key === 'Enter' || props.event.key === 'Tab') {
                const candidate = items[selectedIndex]
                if (candidate) selected?.(candidate)
                return true
              }
              return false
            },
            onExit() {
              items = []
              query = ''
              selected = null
              unmount?.()
              unmount = null
              if (root) {
                root.unmount()
                root = null
              }
            }
          }
        }
      })
    ]
  }
})

export { WikilinkSuggest }
export type { WikiLinkCandidate }