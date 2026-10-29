/**
 * 禁止 `scrollbar-width: thin` / Tailwind `scrollbar-thin`。
 *
 * Chromium 上 `scrollbar-width: thin` 会盖掉 app 全局 `*::-webkit-scrollbar` 的 6px 规则，
 * 滚动条变粗且风格不一致。隐藏滚动条用 `none`；否则交给全局 webkit 规则。
 */

const FORBIDDEN =
  /\bscrollbar-thin\b|scrollbar-width\s*:\s*thin\b|\[scrollbar-width:thin\]/i

const MESSAGE =
  '禁止 scrollbar-width: thin / scrollbar-thin（会盖掉全局 6px 滚动条）；隐藏用 none，否则交给 app 全局规则。'

function reportIfMatch(context, node, text) {
  if (typeof text !== 'string' || !FORBIDDEN.test(text)) return
  context.report({ node, message: MESSAGE })
}

const noScrollbarWidthThin = {
  meta: {
    type: 'problem',
    docs: {
      description: 'disallow scrollbar-width: thin and scrollbar-thin'
    },
    schema: [],
    messages: {}
  },
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value === 'string') reportIfMatch(context, node, node.value)
      },
      TemplateElement(node) {
        reportIfMatch(context, node, node.value?.raw ?? '')
      }
    }
  }
}

export { noScrollbarWidthThin }
