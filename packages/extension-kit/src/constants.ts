/**
 * 剪藏协议常量。**同一个扩展内**的消息名与 client 端口都收在这里。
 *
 * 合并成一个扩展后不再有「剪藏 → 新标签扩展」的跨扩展消息（那套要用
 * `externally_connectable` + 手填对方扩展 ID），所以这里只剩下 worker 与页面之间的四种：
 * 投递现成正文 / 剪藏当前标签 / 抽正文 / 健康检查。
 */

/** 正式包 client 剪藏端口。隔离 dev 实例是 `CLIP_PORT_ISOLATED`。 */
const CLIP_PORT_RELEASE = 19828

/** `pnpm dev:client:isolated` 的剪藏端口。 */
const CLIP_PORT_ISOLATED = 19829

const CLIP_PORTS: readonly number[] = [CLIP_PORT_RELEASE, CLIP_PORT_ISOLATED]

const CLIP_HOST = '127.0.0.1'

/** 只投递已经组好的正文。 */
const MESSAGE_CLIP_PAGE = 'clip-page'

/** 抽取当前激活标签并投递（弹窗按钮走这条）。 */
const MESSAGE_CLIP_ACTIVE = 'clip-active'

/** 只抽取正文、不投递（取正文给别处用）。 */
const MESSAGE_CLIP_EXTRACT = 'clip-extract'

/** 问 client 是否在听（弹窗状态点走这条或直接 fetch `/health`）。 */
const MESSAGE_CLIP_HEALTH = 'clip-health'

/** 最近一次投递结果：worker 写、弹窗读，是跨 worker / 页面的事实源 */
const STORAGE_CLIP_DELIVERY = 'cogito.clip.delivery'

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
  MESSAGE_CLIP_EXTRACT,
  MESSAGE_CLIP_HEALTH,
  STORAGE_CLIP_DELIVERY
}
