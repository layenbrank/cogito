import { convertFileSrc } from '@tauri-apps/api/core'

import type { GalleryRow } from '@/views/gallery/model/asset'

/**
 * 缩略图 / 原图地址（与 Rust `media/thumb.rs` 的协议严格对应）。
 *
 * 四条规则：
 * - 只按桶取（192 / 384 / 768），避免同一张图生成十几个尺寸；
 * - `version` 用源文件 mtime —— 文件被覆盖后 URL 自然变，不需要缓存失效逻辑；
 * - 原图也走同一个协议（`/o/`）而不是 `asset://`：`assetProtocol.scope` 只开给应用目录，
 *   用户照片在任意盘符下，放宽成 `**` 等于把整个磁盘挂给渲染进程；
 * - 视频与 HEIC/RAW 先请求 `thumb://`，失败由调用方回落（后端已用 FFmpeg 兜底）。
 */
const BUCKETS = [192, 384, 768] as const

type ThumbBucket = (typeof BUCKETS)[number]

function pickBucket(columns: number): ThumbBucket {
  if (columns >= 7) return 192
  if (columns >= 4) return 384
  return 768
}

function thumbUrlFor(row: GalleryRow, bucket: ThumbBucket): string {
  const version = row.mtimeMs ?? 0
  return convertFileSrc(`/t/${row.id}/${bucket}/${version}-cover.jpg`, 'thumb')
}

/** 原图地址（只给库内 assetID，协议侧会校验它存不存在）。`/o/` 支持 Range，视频拖动才正常。 */
function originalUrlForAsset(assetID: string, version: number): string {
  return convertFileSrc(`/o/${assetID}/${version}`, 'thumb')
}

/** catalog 行的原图地址（灯箱 / 对比 / 缩略图解码失败时的回落）。 */
function originalUrlFor(row: GalleryRow): string {
  return originalUrlForAsset(row.id, row.mtimeMs ?? 0)
}

export { BUCKETS, originalUrlFor, originalUrlForAsset, pickBucket, thumbUrlFor }
export type { ThumbBucket }
