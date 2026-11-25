import { convertFileSrc } from '@tauri-apps/api/core'
import { useState } from 'react'

import type { GalleryAsset, GalleryMedia } from '@/views/gallery/model/media'

/**
 * `thumb://` 缩略图地址。
 *
 * 协议与缓存规则见 Rust `media/thumb.rs`：
 * - 只按桶取（192 / 384 / 768），避免同一张图生成十几个尺寸；
 * - URL 里带 asset.updatedAt 作为 version —— 行更新（含改名）后自然换 URL，
 *   不需要前端做缓存失效；
 * - Windows / Android 会被 `convertFileSrc` 转成 `http://thumb.localhost/...`，
 *   CSP 的 `img-src` 已放行。
 */
const BUCKETS = [192, 384, 768] as const

type ThumbBucket = (typeof BUCKETS)[number]

/** 网格列数 → 尺寸桶：密网格用小图，大图模式给到 768。 */
function pickBucket(columns: number): ThumbBucket {
  if (columns >= 7) return 192
  if (columns >= 4) return 384
  return 768
}

function thumbUrl(asset: GalleryAsset, bucket: ThumbBucket): string {
  const version = asset.updatedAt || asset.createdAt
  return convertFileSrc(`/t/${asset.id}/${bucket}/${version}-cover.jpg`, 'thumb')
}

/**
 * 带降级的缩略图地址：HEIC / RAW 等本轮不解码的格式会 4xx，
 * 这时回落到原图 `media.src`（保住「至少能看」，不假装支持）。
 */
function useThumbnail(
  media: GalleryMedia,
  bucket: ThumbBucket
): { src: string; onError: () => void; isFallback: boolean } {
  const [failed, setFailed] = useState(false)
  if (media.kind === 'video') {
    // 视频封面要 ffmpeg 抽帧（P4），本轮继续用元素内解码
    return { src: media.src, onError() {}, isFallback: true }
  }
  return {
    src: failed ? media.src : thumbUrl(media.asset, bucket),
    onError() {
      setFailed(true)
    },
    isFallback: failed
  }
}

export { BUCKETS, pickBucket, thumbUrl, useThumbnail }
export type { ThumbBucket }
