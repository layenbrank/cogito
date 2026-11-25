/**
 * Callout 块节点：`div[data-callout]`，内容为普通块序列。
 *
 * 标题不做成可编辑文本，而是 `data-callout-title` 属性 + CSS `::before` 渲染：
 * 内容里多一个非编辑元素会让光标进出、全选、复制都要特殊处理，而 callout 标题本来就不常改。
 */
import { Node, mergeAttributes } from '@tiptap/core'

const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      type: {
        default: 'note',
        parseHTML(element) {
          return element.getAttribute('data-callout') || 'note'
        },
        renderHTML(attributes) {
          return { 'data-callout': String(attributes.type ?? 'note') }
        }
      },
      title: {
        default: '',
        parseHTML(element) {
          return element.getAttribute('data-callout-title') || ''
        },
        renderHTML(attributes) {
          return { 'data-callout-title': String(attributes.title ?? '') }
        }
      }
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'callout' }), 0]
  }
})

export { Callout }
