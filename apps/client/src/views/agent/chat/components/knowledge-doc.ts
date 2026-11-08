/**
 * 知识库面板里「一篇文档」的纯逻辑：新文档的落点 / 正文，以及预览前把相对图片换成
 * webview 能直接加载的地址。
 *
 * 抽出来是因为这些都只跟字符串有关，能被单测直接覆盖；真正的读写盘与落库仍走 IPC
 * （`knowledge:writeDoc` / `knowledge:removeDoc`），不在这里碰文件系统。
 */
import { findImageSrc } from '@/views/knowledge/lib/image-src.ts'

/** 新文档落在 wiki/ 下：与「生成」的落点一致（type=note 也归 wiki） */
const NEW_DOC_DIR = 'wiki'

/**
 * 标题 → 文件名。保留中文（库里很多中文标题），其余非字母数字压成 `-`；
 * 全被压掉时退回时间戳，避免落成 `.md` 这种空名字。
 */
function toDocSlug(title: string): string {
  const cleaned = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned.slice(0, 48) || `note-${Date.now()}`
}

/**
 * 新文档的库内相对路径（`/` 分隔，与 `knowledge_doc.relPath` 一致）。
 *
 * `index > 1` 用来避开同名：库里已经有同名文档时不能覆盖别人的正文，
 * 由调用方递增 index 直到磁盘上没有这个文件。
 */
function buildNewDocRelative(title: string, index = 1): string {
  const suffix = index > 1 ? `-${index}` : ''
  return `${NEW_DOC_DIR}/${toDocSlug(title)}${suffix}.md`
}

/** 新文档正文：带 front matter，写进去就会被索引成 note（标题也取自它） */
function buildNewDocContent(title: string): string {
  const safeTitle = title.trim().replace(/"/g, '\\"')
  return `---\ntitle: "${safeTitle}"\ntype: note\n---\n\n# ${safeTitle}\n\n`
}

/** 代码块（围栏 / 行内）：里面的 `![](...)` 是示例文本，不能当图片改写 */
const FENCE_RE = /(```[\s\S]*?```|`[^`]+`)/g
/** `![alt](src "title")` —— 只取 src，alt 与 title 原样保留 */
const IMAGE_RE = /(!\[[^\]]*\]\()([^)\s]+)(\s+"[^"]*")?(\))/g

/**
 * 预览用：把 Markdown 里的相对图片按文档所在目录换成 asset 协议地址。
 *
 * 库里正文写的是 `assets/x.png` 这类相对路径，直接交给 react-markdown 只会得到裂图。
 * `resolve` 可注入，单测据此避开 `convertFileSrc`（Node 环境里没有 Tauri 注入）。
 */
function rewriteMarkdownAssetSrc(
  markdown: string,
  docPath: string | null,
  resolve: (src: string, docPath: string | null) => string = findImageSrc
): string {
  if (!docPath) return markdown
  return markdown
    .split(FENCE_RE)
    .map(function (part, index) {
      // split 带捕获组后奇数位是代码块/行内代码，原样返回
      if (index % 2 === 1) return part
      return part.replace(
        IMAGE_RE,
        function (
          _whole: string,
          head: string,
          src: string,
          title: string | undefined,
          tail: string | undefined
        ) {
          return `${head}${resolve(src, docPath)}${title ?? ''}${tail ?? ''}`
        }
      )
    })
    .join('')
}

export { buildNewDocContent, buildNewDocRelative, rewriteMarkdownAssetSrc, toDocSlug }
