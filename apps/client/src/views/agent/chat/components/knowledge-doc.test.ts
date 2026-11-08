import { describe, expect, it } from 'vitest'

import {
  buildNewDocContent,
  buildNewDocRelative,
  rewriteMarkdownAssetSrc,
  toDocSlug
} from '@/views/agent/chat/components/knowledge-doc.ts'

describe('toDocSlug', function () {
  it('保留中文、空白与标点压成连字符', function () {
    expect(toDocSlug('  项目 笔记 v2.1 ')).toBe('项目-笔记-v2-1')
  })

  it('全被压掉时退回时间戳前缀', function () {
    expect(toDocSlug('!!!')).toMatch(/^note-\d+$/)
  })
})

describe('buildNewDocRelative', function () {
  it('默认落在 wiki/ 下', function () {
    expect(buildNewDocRelative('Monthly Note')).toBe('wiki/monthly-note.md')
  })

  it('重名时按 index 加后缀，不覆盖已有文档', function () {
    expect(buildNewDocRelative('Monthly Note', 1)).toBe('wiki/monthly-note.md')
    expect(buildNewDocRelative('Monthly Note', 3)).toBe('wiki/monthly-note-3.md')
  })
})

describe('buildNewDocContent', function () {
  it('带 front matter 与一级标题', function () {
    expect(buildNewDocContent('周报')).toBe('---\ntitle: "周报"\ntype: note\n---\n\n# 周报\n\n')
  })

  it('标题里的引号要转义', function () {
    expect(buildNewDocContent('a "b" c')).toContain('title: "a \\"b\\" c"')
  })
})

describe('rewriteMarkdownAssetSrc', function () {
  const resolve = function (src: string) {
    return src.startsWith('assets/') ? `asset://docs/${src}` : src
  }

  it('相对图片按文档目录解析', function () {
    const output = rewriteMarkdownAssetSrc('![图](assets/a.png)', 'D:/kb/wiki/a.md', resolve)
    expect(output).toBe('![图](asset://docs/assets/a.png)')
  })

  it('保留 title 与绝对地址', function () {
    const output = rewriteMarkdownAssetSrc(
      '![图](assets/a.png "说明")\n![远程](https://x/y.png)',
      'D:/kb/wiki/a.md',
      resolve
    )
    expect(output).toContain('![图](asset://docs/assets/a.png "说明")')
    expect(output).toContain('![远程](https://x/y.png)')
  })

  it('代码块里的图片语法原样保留', function () {
    const source = '```md\n![图](assets/a.png)\n```\n`![行内](assets/a.png)`'
    expect(rewriteMarkdownAssetSrc(source, 'D:/kb/wiki/a.md', resolve)).toBe(source)
  })

  it('没有文档路径时不动正文', function () {
    const source = '![图](assets/a.png)'
    expect(rewriteMarkdownAssetSrc(source, null, resolve)).toBe(source)
  })
})
