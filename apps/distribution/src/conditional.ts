/**
 * 条件请求（RFC 7232）与范围请求（RFC 7233）的判定：只吃请求头 + 对象的几个字段，不碰 R2 绑定，
 * 所以能直接单测。worker.ts 拿这里的结论决定回 200 / 206 / 304 / 412。
 * 两条都不是可选项：R2 自己的条件读失败只回不带 body 的对象，`If-Range` 它干脆不认。
 */

/** 条件读只关心 etag 与上传时间；用结构子集而不是整个 `R2Object`，测试里能直接造数据 */
type ConditionalObject = {
  httpEtag: string
  uploaded?: Date
}

/** 范围读只关心对象大小与 R2 给出的分片窗口 */
type RangedObject = {
  size: number
  range?: R2Range
}

/** 分片响应要回的长度（`Content-Range` 用），整读或空窗口回 null */
type ServedRange = {
  offset: number
  length: number
}

/** 条件头里的 etag 可能带 `W/` 弱标记，比较前统一削掉 */
function normalizeEtag(value: string): string {
  return value.trim().replace(/^W\//, '')
}

/** HTTP 日期只有秒级精度，两边都截到秒再比 */
function toSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

/** RFC 7232 §6 的先后：`If-Match` 在时就不看 `If-None-Match` —— 它不满足是 412，不是「没变」 */
function isNotModified(request: Request, object: ConditionalObject): boolean {
  if (request.headers.get('If-Match') !== null) {
    return false
  }
  const ifNoneMatch = request.headers.get('If-None-Match')
  if (ifNoneMatch !== null) {
    const etag = normalizeEtag(object.httpEtag)
    return ifNoneMatch.split(',').some(function (candidate) {
      const value = normalizeEtag(candidate)
      return value === '*' || value === etag
    })
  }
  const ifModifiedSince = request.headers.get('If-Modified-Since')
  if (ifModifiedSince === null || !object.uploaded) {
    return false
  }
  const since = Date.parse(ifModifiedSince)
  return !Number.isNaN(since) && toSeconds(object.uploaded) <= toSeconds(new Date(since))
}

/** `If-Range` 成立才按 Range 回 206；不成立要回整份（对象已变时给局部字节比不给更坏） */
function isRangeStillValid(ifRange: string, object: ConditionalObject | null): boolean {
  if (object === null) {
    return false
  }
  if (normalizeEtag(ifRange) === normalizeEtag(object.httpEtag)) {
    return true
  }
  const date = Date.parse(ifRange)
  if (Number.isNaN(date) || !object.uploaded) {
    return false
  }
  return toSeconds(object.uploaded) <= toSeconds(new Date(date))
}

/**
 * R2 对**每次**读都带 `range`（整读也是 `{ offset: 0, length: size }`），所以「是不是分片响应」只看
 * 请求头；`workers-types` 把 `R2Range` 写成联合（`{offset, length?}` | `{offset?, suffix?}`），
 * 而运行时真带一个值为 `undefined` 的 `suffix`，所以取值一律 `typeof` + 统一形状的视图。
 */
function findServedRange(object: RangedObject, canServeRange: boolean): ServedRange | null {
  if (!canServeRange || !object.range) {
    return null
  }
  const range = object.range as { offset?: number; length?: number; suffix?: number }
  const size = object.size
  if (typeof range.suffix === 'number') {
    const length = Math.min(range.suffix, size)
    return { offset: Math.max(0, size - length), length }
  }
  const offset = typeof range.offset === 'number' ? range.offset : 0
  const length = typeof range.length === 'number' ? range.length : Math.max(0, size - offset)
  return length > 0 ? { offset, length } : null
}

export { findServedRange, isNotModified, isRangeStillValid }
