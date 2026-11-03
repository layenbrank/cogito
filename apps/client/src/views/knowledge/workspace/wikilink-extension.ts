import { Mark, mergeAttributes } from '@tiptap/core'
import { markInputRule } from '@tiptap/core'

const WIKILINK_PATTERN = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/

const Wikilink = Mark.create({
  name: 'wikilink',

  inclusive: false,
  excludes: 'link',

  addAttributes() {
    return {
      title: {
        default: '',
        parseHTML(element) {
          return element.getAttribute('data-wikilink-title') || element.textContent || ''
        },
        renderHTML(attributes) {
          return { 'data-wikilink-title': String(attributes.title ?? '') }
        }
      },
      alias: {
        default: null,
        parseHTML(element) {
          return element.getAttribute('data-wikilink-alias')
        },
        renderHTML(attributes) {
          if (!attributes.alias) return {}
          return { 'data-wikilink-alias': String(attributes.alias) }
        }
      }
    }
  },

  parseHTML() {
    return [
      {
        tag: 'a[data-wikilink]',
        getAttrs(element) {
          const el = element
          return {
            title: el.getAttribute('data-wikilink-title') || el.textContent || '',
            alias: el.getAttribute('data-wikilink-alias')
          }
        }
      }
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        'data-wikilink': '',
        class:
          'wikilink cursor-pointer font-medium text-primary underline decoration-primary/40 underline-offset-2'
      }),
      0
    ]
  },

  addInputRules() {
    return [
      markInputRule({
        find: WIKILINK_PATTERN,
        type: this.type,
        getAttributes(match) {
          const title = (match[1] ?? '').trim()
          const alias = match[2]?.trim()
          return {
            title,
            alias: alias || null
          }
        }
      })
    ]
  }
})

export { Wikilink, WIKILINK_PATTERN }
