/**
 * `ReviewableDiff` 的口径：数字与按钮状态全部由 `hunks` 上的决定算出来。
 *
 * 这里只跑到静态渲染（仓库里没有 DOM 测试环境）：断言「谁该出现、谁该被禁用」。
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ReviewableDiff, type DiffHunk } from './reviewable-diff'

const HUNKS: DiffHunk[] = [
  {
    id: 'a',
    range: '@@ -12,6 +12,7 @@',
    decision: 'pending',
    lines: [
      { kind: 'context', text: 'const composer = useComposer();' },
      { kind: 'removed', text: 'const [draft, setDraft] = useState("")' },
      { kind: 'added', text: 'const draft = useDraft(threadId)' }
    ]
  },
  {
    id: 'b',
    range: '@@ -31,4 +32,5 @@',
    decision: 'pending',
    lines: [{ kind: 'added', text: 'if (!threadId) return' }]
  }
]

function markup(hunks: readonly DiffHunk[], props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <ReviewableDiff
      filename="composer.tsx"
      hunks={hunks}
      {...props}
    />
  )
}

/** 「应用」那颗按钮的标签片段：`disabled:` 是 class，真正的禁用属性是 `disabled` */
function applyButton(html: string) {
  const start = html.lastIndexOf('<button', html.indexOf('Apply'))
  return html.slice(start, html.indexOf('</button>', start) + '</button>'.length)
}

function isDisabled(html: string) {
  return /disabled(=""|\s|>)/.test(applyButton(html))
}

describe('ReviewableDiff', function () {
  it('derives the header count from decisions', function () {
    expect(markup(HUNKS)).toContain('0 of 2 kept')
    expect(markup([{ ...HUNKS[0], decision: 'kept' }, HUNKS[1]])).toContain('1 of 2 kept')
  })

  it('renders nothing but the labels when no handler is given', function () {
    const html = markup(HUNKS)
    expect(html).not.toContain('>Keep<')
    expect(html).not.toContain('>Discard<')
    expect(html).not.toContain('Apply')
  })

  it('renders keep / discard only when the handler exists', function () {
    const onlyKeep = markup(HUNKS, { onKeep: function () {} })
    expect(onlyKeep).toContain('Keep')
    expect(onlyKeep).not.toContain('Discard')

    const both = markup(HUNKS, { onKeep: function () {}, onDiscard: function () {} })
    expect(both).toContain('Keep')
    expect(both).toContain('Discard')
    expect(both).toContain('aria-label="Keep hunk @@ -12,6 +12,7 @@"')
  })

  it('replaces the two buttons with the decision label once decided', function () {
    const html = markup([{ ...HUNKS[0], decision: 'discarded' }, HUNKS[1]], {
      onKeep: function () {},
      onDiscard: function () {}
    })
    expect(html).toContain('Discarded')
    expect(html).toContain('data-decision="discarded"')
    // 丢弃的块整段压暗，但正文仍然在
    expect(html).toContain('opacity-45')
    expect(html).toContain('const [draft, setDraft] = useState(&quot;&quot;)')
  })

  it('disables apply until every hunk is decided', function () {
    const pending = markup(HUNKS, { onApply: function () {} })
    expect(pending).toContain('2 left to review')
    expect(isDisabled(pending)).toBe(true)

    const decided = markup(
      [
        { ...HUNKS[0], decision: 'kept' },
        { ...HUNKS[1], decision: 'discarded' }
      ],
      { onApply: function () {} }
    )
    expect(decided).toContain('All reviewed')
    expect(decided).toContain('Apply 1')
    expect(isDisabled(decided)).toBe(false)
  })

  it('treats an empty hunk list as reviewed', function () {
    const html = markup([], { onApply: function () {} })
    expect(html).toContain('0 of 0 kept')
    expect(html).toContain('All reviewed')
    expect(html).toContain('Apply 0')
  })
})
