import { Node, mergeAttributes } from '@tiptap/core'
import katex from 'katex'

import 'katex/dist/katex.min.css'

const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  defining: true,

  addAttributes() {
    return {
      formula: {
        default: '',
        parseHTML(element) {
          return element.getAttribute('data-formula') || element.textContent || ''
        },
        renderHTML(attributes) {
          return { 'data-formula': attributes.formula }
        }
      }
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="math-block"]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'math-block',
        'data-formula': node.attrs.formula,
        class: 'math-block'
      })
    ]
  },

  addNodeView() {
    return function ({ node }) {
      const dom = document.createElement('div')
      dom.className = 'math-block my-3 overflow-x-auto text-center'
      dom.setAttribute('data-type', 'math-block')
      dom.setAttribute('data-formula', node.attrs.formula || '')
      try {
        katex.render(node.attrs.formula || '', dom, {
          displayMode: true,
          throwOnError: false
        })
      } catch {
        dom.textContent = node.attrs.formula || ''
      }
      return { dom }
    }
  },

  addInputRules() {
    return []
  }
})

const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      formula: {
        default: '',
        parseHTML(element) {
          return element.getAttribute('data-formula') || element.textContent || ''
        },
        renderHTML(attributes) {
          return { 'data-formula': attributes.formula }
        }
      }
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-type="math-inline"]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'math-inline',
        'data-formula': node.attrs.formula,
        class: 'math-inline'
      })
    ]
  },

  addNodeView() {
    return function ({ node }) {
      const dom = document.createElement('span')
      dom.className = 'math-inline'
      dom.setAttribute('data-type', 'math-inline')
      dom.setAttribute('data-formula', node.attrs.formula || '')
      try {
        katex.render(node.attrs.formula || '', dom, {
          displayMode: false,
          throwOnError: false
        })
      } catch {
        dom.textContent = node.attrs.formula || ''
      }
      return { dom }
    }
  }
})

export { MathBlock, MathInline }
