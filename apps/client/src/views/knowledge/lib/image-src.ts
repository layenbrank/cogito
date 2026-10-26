import { convertFileSrc } from '@tauri-apps/api/core'

import { findParentDir, joinPath } from '@/views/knowledge/lib/path.ts'

/** 带协议的 src（http: / data: / asset: / tauri: …）或协议相对地址，原样使用 */
const PROTOCOL_SRC = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i
/** Windows 绝对路径（`D:/...` 会被上面的协议正则误判成 scheme，先单独处理） */
const WINDOWS_ABS_SRC = /^[a-z]:[\\/]/i

/**
 * 把图片 src 解析成 webview 能直接加载的地址。
 *
 * markdown 里存的是相对路径（`assets/img-xxx.png`），渲染时才按当前文档所在目录拼成
 * asset 协议 URL；绝对磁盘路径同样转成 asset 协议，远程 URL / data: 原样返回。
 */
function findImageSrc(src: string, docPath: string | null): string {
  if (!src) return src
  if (WINDOWS_ABS_SRC.test(src)) return convertFileSrc(src)
  if (PROTOCOL_SRC.test(src)) return src
  if (!docPath) return src
  return convertFileSrc(joinPath(findParentDir(docPath), src))
}

export { findImageSrc }
