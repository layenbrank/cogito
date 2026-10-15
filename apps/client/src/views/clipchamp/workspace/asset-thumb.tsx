import { Icon } from '@iconify/react/offline'
import { useEffect, useRef, useState } from 'react'

import type { MediaAsset } from '@/views/clipchamp/lib/project'

interface AssetThumbProps {
  asset: MediaAsset
  className?: string
}

/**
 * 视频切勿用 `<img src=asset://…mp4>`：WebView2 会把整文件当图解码，大视频易直接拖垮进程。
 * 视频用轻量 `<video preload="metadata">`；失败则回退图标。
 */
function AssetThumb(props: AssetThumbProps) {
  const { asset, className } = props
  const videoRef = useRef<HTMLVideoElement>(null)
  const [hasFailed, updateFailed] = useState(false)

  useEffect(
    function () {
      updateFailed(false)
    },
    [asset.id, asset.thumbUrl]
  )

  if (asset.kind === 'audio' || hasFailed) {
    return (
      <div className={className ?? 'flex h-full items-center justify-center bg-black/80'}>
        <Icon
          icon={asset.kind === 'audio' ? 'lucide:music' : 'lucide:film'}
          className="size-6 text-muted-foreground"
        />
      </div>
    )
  }

  if (asset.kind === 'image') {
    return (
      <img
        src={asset.thumbUrl}
        alt=""
        className={className ?? 'h-full w-full object-cover'}
        onError={function () {
          updateFailed(true)
        }}
      />
    )
  }

  return (
    <video
      ref={videoRef}
      src={asset.thumbUrl}
      muted
      playsInline
      preload="metadata"
      className={className ?? 'h-full w-full object-cover'}
      onLoadedData={function () {
        const video = videoRef.current
        if (!video) return
        // seek a bit in to avoid black first frame when possible
        try {
          if (video.duration > 0.2 && video.currentTime < 0.05) {
            video.currentTime = Math.min(0.1, video.duration * 0.05)
          }
        } catch (error) {
          console.debug('[clipchamp] asset thumb seek skipped', error)
        }
      }}
      onError={function () {
        updateFailed(true)
      }}
    />
  )
}

export { AssetThumb }
