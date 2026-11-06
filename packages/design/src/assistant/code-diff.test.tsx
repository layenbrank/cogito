/**
 * `CodeDiff` 的标题栏在聊天流里就是「写文件工具卡的折叠行」，
 * 必须和 `ToolFallback.Trigger`、命令卡 `$ 命令` 行同一高度口径（`TOOL_ROW_HEIGHT_CLASS`）。
 *
 * 另外锁住「一行说完」：文件名 / `+N −M` / 次级说明 / 右侧动作都在同一行，
 * 次级说明不能退回成第二行的 `<p>` —— 那会把行高变成 40px 以上，卡与卡之间立刻参差。
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CodeDiff } from './code-diff'
import { TOOL_ROW_HEIGHT_CLASS } from './tool-row'

const LINES = [
  { kind: 'context' as const, text: 'const a = 1' },
  { kind: 'added' as const, text: 'const b = 2' }
]

function renderDiff(props: { expanded?: boolean; onToggle?: () => void } = {}) {
  return renderToStaticMarkup(
    <CodeDiff
      filename="a.ts"
      subtitle="src/a.ts"
      additions={3}
      deletions={1}
      lines={LINES}
      cycle={0}
      {...props}
    />
  )
}

describe('CodeDiff 标题栏', function () {
  it('是固定高度的一行，与工具行同一口径', function () {
    const html = renderDiff()
    const start = html.indexOf('data-slot="code-diff-header"')
    expect(start).toBeGreaterThan(-1)
    const headerTag = html.slice(start, html.indexOf('>', start))
    expect(headerTag).toContain(TOOL_ROW_HEIGHT_CLASS)
    expect(headerTag).toContain('items-center')
    // 不能再靠 py 凑高度
    expect(headerTag).not.toMatch(/\bpy-\d/)
  })

  it('次级说明与文件名同一行，不另起一行', function () {
    const html = renderDiff()
    const header = html.slice(html.indexOf('data-slot="code-diff-header"'))
    expect(header).toContain('data-slot="code-diff-subtitle"')
    expect(header).toContain('src/a.ts')
    // 标题栏里没有块级段落：多一行就没有「常数行高」可言了
    expect(header.slice(0, header.indexOf('</div></div>'))).not.toContain('<p')
  })

  it('可折叠且收起时，正文整段不挂载', function () {
    const html = renderDiff({ expanded: false, onToggle: function () {} })
    expect(html).toContain('data-state="closed"')
    expect(html).not.toContain('const b = 2')
  })
})
