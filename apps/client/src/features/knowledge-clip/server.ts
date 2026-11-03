/**
 * 浏览器剪藏扩展 → 本机 client 的 HTTP 约定。
 *
 * MV3 扩展 POST `http://127.0.0.1:19828/clip`，body JSON：
 * `{ title, url, markdown }`。Tauri 侧在启动时尝试绑定该端口并转发为
 * `knowledge://clip` 事件；前端 `clip-inbox.ts` 落盘到 `raw/sources/`。
 */
const KNOWLEDGE_CLIP_PORT = 19828

const KNOWLEDGE_CLIP_URL = `http://127.0.0.1:${KNOWLEDGE_CLIP_PORT}/clip`

interface KnowledgeClipPayload {
  title: string
  url: string
  markdown: string
}

export { KNOWLEDGE_CLIP_PORT, KNOWLEDGE_CLIP_URL }
export type { KnowledgeClipPayload }
