import { Button } from '@cogito/design/components/button'
import { ToggleGroup, ToggleGroupItem } from '@cogito/design/components/toggle-group'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import {
  WALLPAPER_FRAMES,
  type WallpaperFrame
} from '@/features/magnetic-tiles/wallpaper/catalog'
import {
  fetchWallpaperShelf,
  findCachedWallpaperShelf,
  type WallpaperSource
} from '@/features/magnetic-tiles/wallpaper/remote'
import { useShellSurface } from '@/features/window-shell/slots'

const SOURCE_NOTE: Record<WallpaperSource, string> = {
  commons: '维基共享精选 · CC BY / CC BY-SA，可商用，须署名',
  nasa: 'NASA 公有领域 · 可商用，署 NASA',
  bing: '必应每日 · 版权归摄影师，只适合个人壁纸'
}

function StagePhoto(props: { frame: WallpaperFrame }) {
  const [src, updateSrc] = useState(props.frame.src)
  const [isBroken, onBroken] = useState(false)

  useEffect(
    function () {
      updateSrc(props.frame.src)
      onBroken(false)
    },
    [props.frame.src]
  )

  if (isBroken) {
    return (
      <div className="flex size-full items-center justify-center bg-signin-brand px-8 text-center text-sm text-signin-brand-muted">
        {props.frame.title}
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={props.frame.title}
      className="size-full object-cover"
      onError={function () {
        console.warn('[wallpaper] image failed', src)
        const thumb = props.frame.thumb
        if (thumb && src !== thumb) {
          updateSrc(thumb)
          return
        }
        onBroken(true)
      }}
    />
  )
}

function FilmThumb(props: {
  frame: WallpaperFrame
  isSelected: boolean
  onPick: (frame: WallpaperFrame) => void
}) {
  const [src, updateSrc] = useState(props.frame.thumb || props.frame.src)
  const [isBroken, onBroken] = useState(false)
  const itemRef = useRef<HTMLDivElement>(null)

  useEffect(
    function () {
      updateSrc(props.frame.thumb || props.frame.src)
      onBroken(false)
    },
    [props.frame.src, props.frame.thumb]
  )

  useEffect(
    function () {
      if (!props.isSelected) return
      itemRef.current?.scrollIntoView({ inline: 'center', block: 'nearest' })
    },
    [props.isSelected]
  )

  return (
    <div ref={itemRef} className="shrink-0">
      <Button
        type="button"
        variant="ghost"
        aria-pressed={props.isSelected}
        aria-label={props.frame.title}
        className="h-auto w-40 overflow-hidden rounded-md p-0 ring-ring aria-pressed:ring-2"
        onClick={function () {
          props.onPick(props.frame)
        }}>
        {isBroken ? (
          <span className="flex aspect-video w-full items-center justify-center bg-muted px-2 text-center text-xs text-muted-foreground">
            {props.frame.title}
          </span>
        ) : (
          <img
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            className="aspect-video w-full object-cover"
            onError={function () {
              console.warn('[wallpaper] image failed', src)
              if (src !== props.frame.src) {
                updateSrc(props.frame.src)
                return
              }
              onBroken(true)
            }}
          />
        )}
      </Button>
    </div>
  )
}

function WallpaperPage() {
  const [params, setParams] = useSearchParams()
  const [source, updateSource] = useState<WallpaperSource>('commons')
  const [frames, updateFrames] = useState<readonly WallpaperFrame[]>(
    function () {
      return findCachedWallpaperShelf('commons') ?? []
    }
  )
  const [isLoading, updateLoading] = useState(function () {
    return !findCachedWallpaperShelf('commons')
  })

  useShellSurface({
    summary: '壁纸库',
    scrollable: false
  })

  useEffect(
    function () {
      let cancelled = false
      const cached = findCachedWallpaperShelf(source)
      if (cached) {
        updateFrames(cached)
        updateLoading(false)
        return
      }

      updateFrames([])
      updateLoading(true)
      fetchWallpaperShelf(source)
        .then(function (loaded) {
          if (cancelled) return
          if (!loaded.length) console.warn('[wallpaper] 图库为空', source)
          updateFrames(loaded.length ? loaded : source === 'nasa' ? WALLPAPER_FRAMES : [])
          updateLoading(false)
        })
        .catch(function (error: unknown) {
          console.warn('[wallpaper] 图库加载失败', error)
          if (cancelled) return
          updateFrames(source === 'nasa' ? WALLPAPER_FRAMES : [])
          updateLoading(false)
        })

      return function () {
        cancelled = true
      }
    },
    [source]
  )

  const selected = useMemo(
    function () {
      const url = params.get('url')
      return (
        frames.find(function (frame) {
          return frame.src === url
        }) ?? frames[0] ?? null
      )
    },
    [frames, params]
  )

  useEffect(
    function () {
      if (!selected) return
      if (params.get('url') === selected.src && params.get('title') === selected.title) return
      setParams({ url: selected.src, title: selected.title }, { replace: true })
    },
    [params, selected, setParams]
  )

  useEffect(
    function () {
      function onKey(event: KeyboardEvent) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        if (!selected) return
        const index = frames.findIndex(function (frame) {
          return frame.src === selected.src
        })
        const step = event.key === 'ArrowRight' ? 1 : -1
        const next = frames[index + step]
        if (!next) return
        event.preventDefault()
        setParams({ url: next.src, title: next.title }, { replace: true })
      }

      window.addEventListener('keydown', onKey)
      return function () {
        window.removeEventListener('keydown', onKey)
      }
    },
    [frames, selected, setParams]
  )

  function onPickSource(value: string[]) {
    const next = value[0]
    if (next === 'commons' || next === 'nasa' || next === 'bing') updateSource(next)
  }

  function onPick(frame: WallpaperFrame) {
    setParams({ url: frame.src, title: frame.title }, { replace: true })
  }

  return (
    <div className="relative size-full bg-signin-brand">
      {selected ? <StagePhoto frame={selected} /> : null}

      <div className="absolute left-4 top-4 z-10 flex max-w-[calc(100%-2rem)] items-center gap-3 rounded-lg bg-background/90 px-2 py-1.5">
        <ToggleGroup
          variant="outline"
          size="sm"
          spacing={0}
          value={[source]}
          onValueChange={onPickSource}>
          <ToggleGroupItem type="button" value="commons" aria-label="维基共享">
            风景
          </ToggleGroupItem>
          <ToggleGroupItem type="button" value="nasa" aria-label="NASA 公有领域">
            NASA
          </ToggleGroupItem>
          <ToggleGroupItem type="button" value="bing" aria-label="必应每日壁纸">
            必应
          </ToggleGroupItem>
        </ToggleGroup>
        <p className="min-w-0 truncate text-xs text-muted-foreground">{SOURCE_NOTE[source]}</p>
      </div>

      <div className="absolute inset-x-0 bottom-0 z-10 bg-background/95">
        <div className="flex items-baseline justify-between gap-3 px-4 pt-3">
          <p className="min-w-0 truncate text-sm font-medium text-foreground">
            {isLoading ? '正在读取壁纸' : selected?.title || '这一组暂时没有壁纸'}
          </p>
          <p className="shrink-0 text-xs text-muted-foreground">
            {isLoading ? '' : `${frames.length} 张`}
          </p>
        </div>
        <p className="truncate px-4 pt-1 text-xs text-muted-foreground">{selected?.credit}</p>
        <div
          role="group"
          aria-label="壁纸"
          className="flex gap-2 overflow-x-auto overscroll-x-contain px-4 py-3">
          {frames.map(function (frame) {
            return (
              <FilmThumb
                key={frame.src}
                frame={frame}
                isSelected={frame.src === selected?.src}
                onPick={onPick}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default WallpaperPage
export { WallpaperPage }
