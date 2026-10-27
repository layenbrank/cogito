import { join } from '@tauri-apps/api/path'
import { save } from '@tauri-apps/plugin-dialog'
import { mkdir, writeTextFile } from '@tauri-apps/plugin-fs'
import { toast } from 'sonner'

import { findFileName } from '@/views/knowledge/lib/path.ts'
import { readMarkdownFile } from '@/views/knowledge/lib/fs.ts'
import { parseMarkdown } from '@/views/knowledge/lib/parse-markdown.ts'
import { t } from '@/views/knowledge/locale.ts'

function buildPrintableHtml(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${title.replace(/</g, '&lt;')}</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
      line-height: 1.65;
      max-width: 760px;
      margin: 2rem auto;
      padding: 0 1.25rem;
      color: #111;
      background: #fff;
    }
    @media (prefers-color-scheme: dark) {
      body { color: #f5f5f5; background: #111; }
    }
    @media print {
      body { max-width: none; margin: 0; padding: 0; }
      a[href]::after { content: " (" attr(href) ")"; font-size: 0.85em; }
    }
    h1,h2,h3 { line-height: 1.25; letter-spacing: -0.02em; }
    pre, code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    pre { padding: 0.75rem 1rem; overflow: auto; border-radius: 8px; background: #f4f4f5; }
    img { max-width: 100%; height: auto; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #d4d4d8; padding: 0.4rem 0.6rem; }
  </style>
</head>
<body>
${bodyHtml}
</body>
</html>`
}

async function exportHtmlDocument(params: {
  activePath: string | null
  html: string
}): Promise<boolean> {
  const base = params.activePath
    ? findFileName(params.activePath).replace(/\.mdx?$/i, '')
    : 'untitled'
  const target = await save({
    defaultPath: `${base}.html`,
    filters: [{ name: 'HTML', extensions: ['html'] }]
  })
  if (!target) return false
  try {
    await writeTextFile(target, buildPrintableHtml(base, params.html))
    toast.success(t('EXPORT_HTML'))
    return true
  } catch (error) {
    console.error('[markdown] export html failed', error)
    toast.error(t('SAVE_FAILED'))
    return false
  }
}

function printDocument(title: string, bodyHtml: string): void {
  const html = buildPrintableHtml(title, bodyHtml)
  const frame = document.createElement('iframe')
  frame.style.position = 'fixed'
  frame.style.right = '0'
  frame.style.bottom = '0'
  frame.style.width = '0'
  frame.style.height = '0'
  frame.style.border = '0'
  document.body.appendChild(frame)
  const doc = frame.contentDocument
  if (!doc) {
    frame.remove()
    return
  }
  doc.open()
  doc.write(html)
  doc.close()
  frame.onload = function () {
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
    window.setTimeout(function () {
      frame.remove()
    }, 500)
  }
}

/**
 * 自动导出：把库内一篇文档另存一份 HTML 到 `<库目录>/exports/`。
 *
 * 只读库里的 markdown（正文以文件为准），不碰索引；导出物是副产物，
 * 不进文档表也不进侧栏（侧栏只列 markdown）。
 */
async function exportDocHtml(params: {
  rootPath: string
  relPath: string
  title: string
}): Promise<string | null> {
  try {
    const markdown = await readMarkdownFile(await join(params.rootPath, params.relPath))
    const relative = params.relPath.replace(/\.mdx?$/i, '.html')
    const target = await join(params.rootPath, 'exports', relative)
    const dir = await join(params.rootPath, 'exports', findParentTail(relative))
    if (dir) await mkdir(dir, { recursive: true })
    await writeTextFile(target, buildPrintableHtml(params.title, parseMarkdown(markdown).html))
    return target
  } catch (error) {
    console.warn('[knowledge] 自动导出 HTML 失败:', error)
    return null
  }
}

/** `a/b/c.html` → `a/b`；没有子目录时返回空串 */
function findParentTail(relative: string): string {
  const index = relative.lastIndexOf('/')
  return index < 0 ? '' : relative.slice(0, index)
}

export { buildPrintableHtml, exportDocHtml, exportHtmlDocument, printDocument }
