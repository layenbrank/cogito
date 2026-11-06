/**
 * 交互式文件树（目录列举用）的槽位回归。
 *
 * 元素页（assistant-ui elements/file-tree）把 `data-slot` 当公开选择器用，本仓这套
 * 交互树（可折叠 / 可选择）是另一份实现，但**槽位名字要与元素页对齐**，否则：
 * - 面板里按 `[data-slot="file-tree"]` 写样式 / 断言时对不上；
 * - 「改动文件树」（`file-change-tree`）与它可以被同一套选择器分别命中，不会互相误伤。
 *
 * 这里只锁结构与槽位，不锁配色：颜色属于设计 token，改配色不该让测试变红。
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { FileTree, FileTreeFile, FileTreeFolder, FileTreeName } from './file-tree'

function count(html: string, needle: string): number {
  return html.split(needle).length - 1
}

describe('FileTree', function () {
  it('根节点带元素页同名的 data-slot，且不再是一张自带边框的卡', function () {
    const html = renderToStaticMarkup(
      <FileTree>
        <FileTreeFile
          path="README.md"
          name="README.md"
        />
      </FileTree>
    )
    expect(html).toContain('data-slot="file-tree"')
    expect(html).toContain('role="tree"')
    // 明细里会套在 ToolFallback 的边框之内，再来一层 border 就是卡里套卡
    expect(html).not.toContain('rounded-lg border')
  })

  it('目录行与文件行各带自己的槽位，名字走 file-tree-name', function () {
    const html = renderToStaticMarkup(
      <FileTree defaultExpanded={new Set(['src'])}>
        <FileTreeFolder
          path="src"
          name="src">
          <FileTreeFile
            path="src/a.ts"
            name="a.ts"
          />
        </FileTreeFolder>
      </FileTree>
    )
    expect(count(html, 'data-slot="file-tree-folder"')).toBe(1)
    expect(count(html, 'data-slot="file-tree-file"')).toBe(1)
    expect(count(html, 'data-slot="file-tree-name"')).toBe(2)
    expect(html).toContain('>src<')
    expect(html).toContain('>a.ts<')
  })

  it('收起的目录不渲染子行（折叠是数据驱动，不是 CSS 藏起来）', function () {
    const html = renderToStaticMarkup(
      <FileTree>
        <FileTreeFolder
          path="src"
          name="src">
          <FileTreeFile
            path="src/a.ts"
            name="a.ts"
          />
        </FileTreeFolder>
      </FileTree>
    )
    expect(count(html, 'data-slot="file-tree-folder"')).toBe(1)
    expect(count(html, 'data-slot="file-tree-file"')).toBe(0)
  })

  it('自定义行内渲染仍然生效（children 覆盖默认的 图标 + 名字）', function () {
    const html = renderToStaticMarkup(
      <FileTree>
        <FileTreeFile
          path="b.ts"
          name="b.ts">
          <FileTreeName>b.ts</FileTreeName>
          <span>+3</span>
        </FileTreeFile>
      </FileTree>
    )
    expect(html).toContain('data-slot="file-tree-name"')
    expect(html).toContain('+3')
    // 默认那套图标不再出现
    expect(html).not.toContain('data-slot="file-tree-icon"')
  })
})
