/**
 * 浏览器剪藏扩展 → 本机 client 的 HTTP 约定。
 *
 * `@cogito/clipper` POST `http://127.0.0.1:19828/clip`（隔离 dev 为 19829），
 * body JSON：`{ title, url, markdown }`。Tauri 侧绑定该端口并转发为
 * `knowledge://clip`；前端 `clip-inbox.ts` 落盘到 `raw/sources/`。
 * 新标签扩展不直接组 Markdown，它把抽取交给剪藏扩展。
 */
const KNOWLEDGE_CLIP_PORT = 19828

const KNOWLEDGE_CLIP_PORT_ISOLATED = 19829

const KNOWLEDGE_CLIP_URL = `http://127.0.0.1:${KNOWLEDGE_CLIP_PORT}/clip`

interface KnowledgeClipPayload {
  title: string
  url: string
  markdown: string
}

export { KNOWLEDGE_CLIP_PORT, KNOWLEDGE_CLIP_PORT_ISOLATED, KNOWLEDGE_CLIP_URL }
export type { KnowledgeClipPayload }
