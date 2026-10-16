import { Node, mergeAttributes } from '@tiptap/core'

/** 只用得到 initialize / render 两个方法，因此按最小结构声明，避免 `import()` 类型注解 */
interface MermaidApi {
  initialize(config: { startOnLoad: boolean; securityLevel: string; theme: string }): void
  render(id: string, source: string): Promise<{ svg: string }>
}

/**
 * mermaid 体积大且只有文档里真的出现图表块才用得上：按需动态加载，并只初始化一次。
 */
let mermaidPromise: Promise<MermaidApi> | null = null

function loadMermaid(): Promise<MermaidApi> {
  mermaidPromise ??= import('mermaid').then(function (mod) {
    mod.default.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'neutral'
    })
    return mod.default as MermaidApi
  })
  return mermaidPromise
}

let mermaidSeq = 0

const MermaidBlock = Node.create({
  name: 'mermaidBlock',
  group: 'block',
  atom: true,
  defining: true,

  addAttributes() {
    return {
      source: { default: '' }
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="mermaid-block"]',
        getAttrs(element) {
          const el = element as HTMLElement
          return { source: el.getAttribute('data-source') || el.textContent || '' }
        }
      },
      {
        tag: 'pre[data-language="mermaid"]',
        getAttrs(element) {
          return { source: (element as HTMLElement).textContent || '' }
        }
      }
    ]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'mermaid-block',
        'data-source': node.attrs.source
      }),
      ['pre', {}, node.attrs.source || '']
    ]
  },

  addNodeView() {
    return function ({ node }) {
      const dom = document.createElement('div')
      dom.className = 'mermaid-block my-4 overflow-x-auto rounded-md border border-border bg-muted/30 p-3'
      dom.setAttribute('data-type', 'mermaid-block')
      dom.setAttribute('data-source', node.attrs.source || '')

      const renderId = `mermaid-${mermaidSeq++}`
      const source = node.attrs.source || ''

      void loadMermaid()
        .then(function (mermaid) {
          return mermaid.render(renderId, source)
        })
        .then(function (result) {
          dom.innerHTML = result.svg
        })
        .catch(function () {
          const pre = document.createElement('pre')
          pre.className = 'text-xs text-destructive whitespace-pre-wrap'
          pre.textContent = source
          dom.replaceChildren(pre)
        })

      return { dom }
    }
  }
})

export { MermaidBlock }
