/** 正式包 client 剪藏端口。隔离 dev 实例是 `CLIP_PORT_ISOLATED`。 */
const CLIP_PORT_RELEASE = 19828

/** `pnpm dev:client:isolated` 的剪藏端口。 */
const CLIP_PORT_ISOLATED = 19829

const CLIP_PORTS: readonly number[] = [CLIP_PORT_RELEASE, CLIP_PORT_ISOLATED]

const CLIP_HOST = '127.0.0.1'

/** 弹窗 / 旧调用方：只投递已经组好的正文。 */
const MESSAGE_CLIP_PAGE = 'clip-page'

/** 剪藏弹窗：抽取当前标签并投递。 */
const MESSAGE_CLIP_ACTIVE = 'clip-active'

/** 与旧 content script 相同的抽取消息。 */
const MESSAGE_EXTRACT = 'cogito-extract'

/** 新标签扩展 → 剪藏：抽取并投递。 */
const MESSAGE_EXTERNAL_CLIP = 'cogito:clip'

/** 剪藏 → 新标签扩展：投递结果。 */
const MESSAGE_CLIP_RESULT = 'cogito:clip-result'

/** 任一方询问客户端是否在听。 */
const MESSAGE_HEALTH = 'cogito:health'

const MARKDOWN_LIMIT = 80_000

const ARTICLE_LIMIT = 120_000

export {
  ARTICLE_LIMIT,
  CLIP_HOST,
  CLIP_PORT_ISOLATED,
  CLIP_PORT_RELEASE,
  CLIP_PORTS,
  MARKDOWN_LIMIT,
  MESSAGE_CLIP_ACTIVE,
  MESSAGE_CLIP_PAGE,
  MESSAGE_CLIP_RESULT,
  MESSAGE_EXTERNAL_CLIP,
  MESSAGE_EXTRACT,
  MESSAGE_HEALTH
}
