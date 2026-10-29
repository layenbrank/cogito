/**
 * 禁止 `overscroll-contain` / `overscroll-behavior: contain`。
 *
 * 该类会截断滚动链，在嵌套滚动与触控板场景下容易「卡死」父级滚动；
 * monorepo 一律不用，改用默认 overscroll 或 `overscroll-auto` / `overscroll-none`。
 */

const FORBIDDEN =
  /\boverscroll-(?:[xy]-)?contain\b|overscroll-behavior(?:-[xy])?\s*:\s*contain\b/i

const MESSAGE =
  '禁止 overscroll-contain / overscroll-behavior: contain（会截断滚动链）；用默认行为或 overscroll-auto / overscroll-none。'

function reportIfMatch(context, node, text) {
  if (typeof text !== 'string' || !FORBIDDEN.test(text)) return
  context.report({ node, message: MESSAGE })
}

const noOverscrollContain = {
  meta: {
    type: 'problem',
    docs: {
      description: 'disallow overscroll-contain and overscroll-behavior: contain'
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

export { noOverscrollContain }
