import { toFfmpegGrade } from '@/lib/canvas/grade'
import type { Clip, ExportPreset, MediaAsset, Project } from '@/views/clipchamp/lib/project'
import { findTracksByKind } from '@/views/clipchamp/lib/project'

interface ExportArgs {
  inputs: string[]
  output: string
  filterComplex: string
  mapVideo: string
  mapAudio?: string
  videoBitrate: string
  audioBitrate: string
  fps: number
  width: number
  height: number
  /** 成片时长，供导出进度换算 */
  durationMs: number
}

/**
 * 将项目编译为 ffmpeg filter_complex。
 * 策略：主视频轨按时间拼接为 base；overlay/文本/贴纸叠层；音频混合。
 */
function buildExportArgs(
  project: Project,
  assets: MediaAsset[],
  output: string,
  preset: ExportPreset
): ExportArgs {
  const width = preset.width
  const height = preset.height
  const fps = preset.fps

  const inputs: string[] = []
  const inputIndexByAsset = new Map<string, number>()

  function ensureInput(assetId: string): number {
    const existing = inputIndexByAsset.get(assetId)
    if (existing !== undefined) return existing
    const asset = assets.find(function (item) {
      return item.id === assetId
    })
    if (!asset) throw new Error(`缺少素材 ${assetId}`)
    const index = inputs.length
    inputs.push(asset.path)
    inputIndexByAsset.set(assetId, index)
    return index
  }

  /** 自下而上铺轨：时间轴靠下的同类轨先合成，靠上的盖在上面 */
  function flattenTracksBottomUp(kind: 'video' | 'overlay' | 'text' | 'caption' | 'audio'): Clip[] {
    const tracks = findTracksByKind(project, kind)
    const clips: Clip[] = []
    for (let i = tracks.length - 1; i >= 0; i--) {
      const sorted = [...tracks[i].clips].sort(function (a, b) {
        return a.startMs - b.startMs
      })
      for (const clip of sorted) clips.push(clip)
    }
    return clips
  }

  const filters: string[] = []
  let lastVideoLabel = 'base'

  // Black canvas base
  filters.push(
    `color=c=black:s=${width}x${height}:d=${Math.max(0.1, project.durationMs / 1000)}:r=${fps}[${lastVideoLabel}]`
  )

  const videoClips = flattenTracksBottomUp('video')

  videoClips.forEach(function (clip, order) {
    if (!clip.assetId) return
    const inputIndex = ensureInput(clip.assetId)
    const speed = Math.max(0.1, clip.speed)
    const trimStart = clip.sourceInMs / 1000
    const trimEnd = (clip.sourceInMs + clip.durationMs) / 1000
    const start = clip.startMs / 1000
    const label = `v${order}`
    const scaled = `vs${order}`
    const placed = `vp${order}`

    const eq = toFfmpegGrade(clip.filter)
    const fade = buildFade(
      findFadeMs(clip.fadeInMs, clip.transition),
      findFadeMs(clip.fadeOutMs, clip.transition),
      clip.durationMs / speed
    )
    const mask = buildMask(clip.mask)

    filters.push(
      `[${inputIndex}:v]trim=${trimStart}:${trimEnd},setpts=PTS-STARTPTS,setpts=PTS/${speed},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=rgba${eq ? `,${eq}` : ''}${fade ? `,${fade}` : ''}${mask ? `,${mask}` : ''}[${label}]`
    )

    const x = Math.round((clip.x - 0.5 * clip.scale) * width)
    const y = Math.round((clip.y - 0.5 * clip.scale) * height)
    const rotation = clip.rotation
    if (Math.abs(rotation) > 0.01) {
      filters.push(
        `[${label}]rotate=${(rotation * Math.PI) / 180}:c=none:ow=rotw(iw):oh=roth(ih),scale=iw*${clip.scale}:ih*${clip.scale}[${scaled}]`
      )
    } else {
      filters.push(`[${label}]scale=iw*${clip.scale}:ih*${clip.scale}[${scaled}]`)
    }

    const next = `vx${order}`
    filters.push(
      `[${lastVideoLabel}][${scaled}]overlay=${x}:${y}:enable='between(t,${start},${start + clip.durationMs / speed / 1000})'[${placed}]`
    )
    // rename for chain - overlay writes to placed; use as next base
    lastVideoLabel = placed
    void next
  })

  const overlayClips = [
    ...flattenTracksBottomUp('overlay'),
    ...flattenTracksBottomUp('text'),
    ...flattenTracksBottomUp('caption')
  ]

  overlayClips.forEach(function (clip, order) {
    const start = clip.startMs / 1000
    const dur = clip.durationMs / Math.max(0.1, clip.speed) / 1000
    const label = `ov${order}`
    const out = `ovo${order}`

    if ((clip.kind === 'video' || clip.kind === 'image') && clip.assetId) {
      const inputIndex = ensureInput(clip.assetId)
      const trimStart = clip.sourceInMs / 1000
      const trimEnd = (clip.sourceInMs + clip.durationMs) / 1000
      const targetW = Math.round(width * clip.scale)
      const targetH = Math.round(height * clip.scale)
      const mask = buildMask(clip.mask)
      filters.push(
        `[${inputIndex}:v]trim=${trimStart}:${trimEnd},setpts=PTS-STARTPTS,scale=${targetW}:${targetH},format=rgba${mask ? `,${mask}` : ''}[${label}]`
      )
      const x = Math.round(clip.x * width - targetW / 2)
      const y = Math.round(clip.y * height - targetH / 2)
      filters.push(
        `[${lastVideoLabel}][${label}]overlay=${x}:${y}:enable='between(t,${start},${start + dur})'[${out}]`
      )
      lastVideoLabel = out
      return
    }

    if (clip.kind === 'text' || clip.kind === 'caption' || clip.kind === 'sticker') {
      const content = escapeDrawtext(clip.text?.content || '')
      const fontSize = clip.text?.fontSize || 48
      const color = (clip.text?.color || '#ffffff').replace('#', '')
      const xExpr =
        clip.text?.align === 'left'
          ? `${Math.round(clip.x * width)}`
          : clip.text?.align === 'right'
            ? `w-text_w-${Math.round((1 - clip.x) * width)}`
            : `(w-text_w)/2`
      const yExpr = Math.round(clip.y * height)
      filters.push(
        `[${lastVideoLabel}]drawtext=text='${content}':fontsize=${fontSize}:fontcolor=0x${color}:x=${xExpr}:y=${yExpr}:enable='between(t,${start},${start + dur})'[${out}]`
      )
      lastVideoLabel = out
    }
  })

  // Audio mix
  const audioLabels: string[] = []
  const allAudioSources = [
    ...flattenTracksBottomUp('video').filter(function (clip) {
      return clip.volume > 0 && !!clip.assetId
    }),
    ...flattenTracksBottomUp('audio')
  ]

  allAudioSources.forEach(function (clip, order) {
    if (!clip.assetId) return
    const asset = assets.find(function (item) {
      return item.id === clip.assetId
    })
    if (!asset) return
    if (asset.kind === 'image') return
    if (asset.kind === 'video' && !asset.hasAudio && clip.kind === 'video') return

    const inputIndex = ensureInput(clip.assetId)
    const speed = Math.max(0.1, clip.speed)
    const trimStart = clip.sourceInMs / 1000
    const trimEnd = (clip.sourceInMs + clip.durationMs) / 1000
    const start = clip.startMs / 1000
    const label = `a${order}`
    const delayed = `ad${order}`
    const atempo = buildAtempo(speed)

    filters.push(
      `[${inputIndex}:a]atrim=${trimStart}:${trimEnd},asetpts=PTS-STARTPTS${atempo},volume=${clip.volume}[${label}]`
    )
    filters.push(`[${label}]adelay=${Math.round(start * 1000)}|${Math.round(start * 1000)}[${delayed}]`)
    audioLabels.push(`[${delayed}]`)
  })

  let mapAudio: string | undefined
  if (audioLabels.length > 0) {
    filters.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:normalize=0[aout]`)
    mapAudio = '[aout]'
  }

  return {
    inputs,
    output,
    filterComplex: filters.join(';'),
    mapVideo: `[${lastVideoLabel}]`,
    mapAudio,
    videoBitrate: preset.videoBitrate,
    audioBitrate: preset.audioBitrate,
    fps,
    width,
    height,
    durationMs: project.durationMs
  }
}

function findFadeMs(
  fadeMs: number,
  transition: { kind: string; durationMs: number }
): number {
  if (fadeMs > 0) return fadeMs
  if (transition.kind === 'fade' || transition.kind === 'dissolve') {
    return transition.durationMs
  }
  return 0
}

function buildMask(mask: { kind: string }): string {
  if (mask.kind === 'circle') {
    return "geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(pow(X-W/2\\,2)+pow(Y-H/2\\,2)\\,pow(min(W\\,H)/2\\,2))\\,255\\,0)'"
  }
  if (mask.kind === 'rounded') {
    return "geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(gt(hypot(max(abs(X-W/2)-(W/2-min(W\\,H)*0.18)\\,0)\\,max(abs(Y-H/2)-(H/2-min(W\\,H)*0.18)\\,0))\\,min(W\\,H)*0.18)\\,0\\,255)'"
  }
  return ''
}

function buildFade(fadeInMs: number, fadeOutMs: number, durationMs: number): string {
  const parts: string[] = []
  if (fadeInMs > 0) parts.push(`fade=t=in:st=0:d=${fadeInMs / 1000}`)
  if (fadeOutMs > 0) {
    const start = Math.max(0, durationMs / 1000 - fadeOutMs / 1000)
    parts.push(`fade=t=out:st=${start}:d=${fadeOutMs / 1000}`)
  }
  return parts.join(',')
}

function buildAtempo(speed: number): string {
  // atempo only accepts 0.5–2.0; chain if needed
  let remaining = speed
  const parts: string[] = []
  while (remaining > 2.0001) {
    parts.push('atempo=2.0')
    remaining /= 2
  }
  while (remaining < 0.4999) {
    parts.push('atempo=0.5')
    remaining /= 0.5
  }
  parts.push(`atempo=${remaining.toFixed(4)}`)
  return parts.length ? `,${parts.join(',')}` : ''
}

function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/\n/g, ' ')
}

export { buildExportArgs }
export type { ExportArgs }
