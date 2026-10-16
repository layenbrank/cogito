/** Clipchamp 项目纯类型与编辑操作 */

type AspectRatio = '16:9' | '9:16' | '1:1' | '4:5'

type TrackKind = 'text' | 'video' | 'overlay' | 'audio' | 'caption'

type ClipKind = 'video' | 'audio' | 'text' | 'sticker' | 'shape' | 'caption' | 'image'

type MediaSurface = 'media' | 'text' | 'stickers' | 'transitions' | 'audio'

type InspectorTab =
  'captions' | 'audio' | 'fade' | 'filters' | 'color' | 'transform' | 'speed' | 'mask'

type AnimKind = 'none' | 'fade' | 'slide-up' | 'slide-down' | 'zoom'

type TransitionKind = 'none' | 'fade' | 'dissolve'

type MaskKind = 'none' | 'circle' | 'rect' | 'rounded'

interface ColorAdjust {
  exposure: number
  contrast: number
  saturation: number
  temperature: number
  transparency: number
}

interface AnimSpec {
  kind: AnimKind
  durationMs: number
}

interface TransitionSpec {
  kind: TransitionKind
  durationMs: number
}

interface MaskSpec {
  kind: MaskKind
  feather: number
}

interface TextSpec {
  content: string
  fontSize: number
  color: string
  fontWeight: number
  align: 'left' | 'center' | 'right'
}

interface CaptionCue {
  id: string
  startMs: number
  endMs: number
  text: string
}

/** FFmpeg 预生成的胶片条 sprite 元数据；时间轴用 canvas blit */
interface FilmstripMeta {
  spriteUrl: string
  spritePath: string
  cols: number
  rows: number
  tileWidth: number
  tileHeight: number
  intervalMs: number
  frameCount: number
  durationMs: number
}

interface WaveformMeta {
  waveUrl: string
  wavePath: string
  width: number
  height: number
  durationMs: number
}

interface MediaAsset {
  id: string
  path: string
  name: string
  kind: 'video' | 'audio' | 'image'
  durationMs: number
  width?: number
  height?: number
  hasAudio?: boolean
  thumbUrl?: string
  filmstrip?: FilmstripMeta
  waveform?: WaveformMeta
  /** Gallery asset id when imported from gallery */
  galleryId?: string
}

interface Clip {
  id: string
  assetId?: string
  kind: ClipKind
  trackId: string
  startMs: number
  durationMs: number
  sourceInMs: number
  x: number
  y: number
  scale: number
  rotation: number
  opacity: number
  speed: number
  volume: number
  fadeInMs: number
  fadeOutMs: number
  enterAnim: AnimSpec
  exitAnim: AnimSpec
  transition: TransitionSpec
  filter: ColorAdjust
  blend: string
  mask: MaskSpec
  text?: TextSpec
  captions?: CaptionCue[]
  label?: string
}

interface Track {
  id: string
  kind: TrackKind
  name: string
  clips: Clip[]
  isMuted: boolean
  isLocked: boolean
}

interface Project {
  id: string
  name: string
  aspect: AspectRatio
  durationMs: number
  tracks: Track[]
}

interface ExportPreset {
  id: string
  label: string
  width: number
  height: number
  fps: number
  videoBitrate: string
  audioBitrate: string
}

const ASPECT_RATIOS: AspectRatio[] = ['16:9', '9:16', '1:1', '4:5']

const ASPECT_OPTIONS: { ratio: AspectRatio; title: string; hint: string }[] = [
  { ratio: '16:9', title: '宽屏 16:9', hint: 'YouTube、电脑' },
  { ratio: '9:16', title: '竖屏 9:16', hint: 'Reels、TikTok、Shorts' },
  { ratio: '1:1', title: '方形 1:1', hint: 'Instagram 帖子' },
  { ratio: '4:5', title: '社交 4:5', hint: 'Instagram 动态' }
]

/** 预设决定清晰度档，宽高跟当前画幅走，不把 16:9 尺寸硬套到竖屏上 */
function fitExportPreset(preset: ExportPreset, aspect: AspectRatio): ExportPreset {
  const canvas = ASPECT_SIZE[aspect]
  const scale = preset.id === '720p' ? 720 / 1080 : 1
  return {
    ...preset,
    width: Math.round(canvas.width * scale),
    height: Math.round(canvas.height * scale)
  }
}

const ASPECT_SIZE: Record<AspectRatio, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 }
}

const EXPORT_PRESETS: ExportPreset[] = [
  {
    id: '1080p',
    label: '1080p',
    width: 1920,
    height: 1080,
    fps: 30,
    videoBitrate: '8M',
    audioBitrate: '192k'
  },
  {
    id: '720p',
    label: '720p',
    width: 1280,
    height: 720,
    fps: 30,
    videoBitrate: '5M',
    audioBitrate: '160k'
  },
  {
    id: 'vertical-1080',
    label: '竖屏 1080',
    width: 1080,
    height: 1920,
    fps: 30,
    videoBitrate: '8M',
    audioBitrate: '192k'
  }
]

const COLOR_NEUTRAL: ColorAdjust = {
  exposure: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  transparency: 0
}

const ANIM_NONE: AnimSpec = { kind: 'none', durationMs: 0 }
const TRANSITION_NONE: TransitionSpec = { kind: 'none', durationMs: 0 }
const MASK_NONE: MaskSpec = { kind: 'none', feather: 0 }

const FILTER_PRESETS: { id: string; label: string; filter: ColorAdjust }[] = [
  { id: 'none', label: '无', filter: { ...COLOR_NEUTRAL } },
  {
    id: 'vivid',
    label: '鲜艳',
    filter: { exposure: 0.05, contrast: 0.15, saturation: 0.35, temperature: 0, transparency: 0 }
  },
  {
    id: 'warm',
    label: '暖调',
    filter: { exposure: 0.05, contrast: 0.05, saturation: 0.1, temperature: 0.35, transparency: 0 }
  },
  {
    id: 'cool',
    label: '冷调',
    filter: { exposure: 0, contrast: 0.1, saturation: -0.05, temperature: -0.35, transparency: 0 }
  },
  {
    id: 'mono',
    label: '黑白',
    filter: { exposure: 0, contrast: 0.2, saturation: -1, temperature: 0, transparency: 0 }
  }
]

const STICKER_LIBRARY: { id: string; label: string; emoji: string }[] = [
  { id: 'star', label: '星星', emoji: '⭐' },
  { id: 'heart', label: '爱心', emoji: '❤️' },
  { id: 'fire', label: '火焰', emoji: '🔥' },
  { id: 'clap', label: '鼓掌', emoji: '👏' },
  { id: 'sparkles', label: '闪光', emoji: '✨' },
  { id: 'arrow', label: '箭头', emoji: '➡️' },
  { id: 'check', label: '对勾', emoji: '✅' },
  { id: 'party', label: '派对', emoji: '🎉' }
]

const MAX_UNDO = 80

const TRACK_KIND_LABEL: Record<TrackKind, string> = {
  text: '文字',
  caption: '字幕',
  overlay: '叠加',
  video: '视频',
  audio: '音频'
}

const TRACK_KIND_ORDER: TrackKind[] = ['text', 'caption', 'overlay', 'video', 'audio']

function createId(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`
}

function findClipEndMs(clip: Clip): number {
  return clip.startMs + clip.durationMs / Math.max(0.1, clip.speed)
}

function findTracksByKind(project: Project, kind: TrackKind): Track[] {
  return project.tracks.filter(function (track) {
    return track.kind === kind
  })
}

function findTrackDisplayName(project: Project, track: Track): string {
  const same = findTracksByKind(project, track.kind)
  const label = TRACK_KIND_LABEL[track.kind]
  if (same.length <= 1) return label
  const index = same.findIndex(function (item) {
    return item.id === track.id
  })
  return `${label} ${index + 1}`
}

function hasTrackOverlap(track: Track, startMs: number, durationMs: number, speed = 1): boolean {
  const endMs = startMs + durationMs / Math.max(0.1, speed)
  return track.clips.some(function (clip) {
    return startMs < findClipEndMs(clip) && endMs > clip.startMs
  })
}

function createTrack(kind: TrackKind, name?: string): Track {
  return {
    id: createId('track'),
    kind,
    name: name ?? TRACK_KIND_LABEL[kind],
    clips: [],
    isMuted: false,
    isLocked: false
  }
}

/** 新轨插到同类组顶部（时间轴更靠上、合成更靠前） */
function insertTrackInKindGroup(project: Project, track: Track): Project {
  const firstIndex = project.tracks.findIndex(function (item) {
    return item.kind === track.kind
  })
  if (firstIndex >= 0) {
    const tracks = [...project.tracks]
    tracks.splice(firstIndex, 0, track)
    return { ...project, tracks }
  }

  const kindOrder = TRACK_KIND_ORDER.indexOf(track.kind)
  let insertAt = project.tracks.length
  for (let i = 0; i < project.tracks.length; i++) {
    const otherOrder = TRACK_KIND_ORDER.indexOf(project.tracks[i]!.kind)
    if (otherOrder > kindOrder) {
      insertAt = i
      break
    }
  }
  const tracks = [...project.tracks]
  tracks.splice(insertAt, 0, track)
  return { ...project, tracks }
}

/**
 * 在同类轨中找无重叠的空档；若都冲突则新建一条轨。
 * 保证「一个类型可有多条轨道」。
 */
function placeClipOnLane(
  project: Project,
  kind: TrackKind,
  startMs: number,
  durationMs: number,
  speed = 1
): { project: Project; trackId: string } {
  const lanes = findTracksByKind(project, kind)
  for (const track of lanes) {
    if (track.isLocked) continue
    if (!hasTrackOverlap(track, startMs, durationMs, speed)) {
      return { project, trackId: track.id }
    }
  }
  const track = createTrack(kind)
  return {
    project: insertTrackInKindGroup(project, track),
    trackId: track.id
  }
}

/** 删除后保留每类至少一条空轨，去掉多余空轨 */
function pruneEmptyLanes(project: Project): Project {
  const kept: Track[] = []
  const seenKind = new Set<TrackKind>()
  // 自下而上扫描：优先保留组内靠下的轨（主轨），清掉上方空轨
  for (let i = project.tracks.length - 1; i >= 0; i--) {
    const track = project.tracks[i]!
    if (track.clips.length > 0) {
      kept.push(track)
      seenKind.add(track.kind)
      continue
    }
    if (!seenKind.has(track.kind)) {
      kept.push(track)
      seenKind.add(track.kind)
    }
  }
  kept.reverse()
  // 确保五类轨都在
  for (const kind of TRACK_KIND_ORDER) {
    if (seenKind.has(kind)) continue
    kept.push(createTrack(kind))
    seenKind.add(kind)
  }
  // 按 kind 顺序重排，同类保持相对顺序
  kept.sort(function (a, b) {
    const order = TRACK_KIND_ORDER.indexOf(a.kind) - TRACK_KIND_ORDER.indexOf(b.kind)
    if (order !== 0) return order
    return project.tracks.indexOf(a) - project.tracks.indexOf(b)
  })
  return { ...project, tracks: kept }
}

function createClipDefaults(partial: Partial<Clip> & Pick<Clip, 'kind' | 'trackId'>): Clip {
  return {
    id: createId('clip'),
    startMs: 0,
    durationMs: 3000,
    sourceInMs: 0,
    x: 0.5,
    y: 0.5,
    scale: 1,
    rotation: 0,
    opacity: 1,
    speed: 1,
    volume: 1,
    fadeInMs: 0,
    fadeOutMs: 0,
    enterAnim: { ...ANIM_NONE },
    exitAnim: { ...ANIM_NONE },
    transition: { ...TRANSITION_NONE },
    filter: { ...COLOR_NEUTRAL },
    blend: 'normal',
    mask: { ...MASK_NONE },
    ...partial
  }
}

function createEmptyProject(name = '未命名项目'): Project {
  const textTrack: Track = {
    id: createId('track'),
    kind: 'text',
    name: '文字',
    clips: [],
    isMuted: false,
    isLocked: false
  }
  const captionTrack: Track = {
    id: createId('track'),
    kind: 'caption',
    name: '字幕',
    clips: [],
    isMuted: false,
    isLocked: false
  }
  const overlayTrack: Track = {
    id: createId('track'),
    kind: 'overlay',
    name: '叠加',
    clips: [],
    isMuted: false,
    isLocked: false
  }
  const videoTrack: Track = {
    id: createId('track'),
    kind: 'video',
    name: '视频',
    clips: [],
    isMuted: false,
    isLocked: false
  }
  const audioTrack: Track = {
    id: createId('track'),
    kind: 'audio',
    name: '音频',
    clips: [],
    isMuted: false,
    isLocked: false
  }
  return {
    id: createId('project'),
    name,
    aspect: '16:9',
    durationMs: 0,
    tracks: [textTrack, captionTrack, overlayTrack, videoTrack, audioTrack]
  }
}

function findTrack(project: Project, trackId: string): Track | undefined {
  return project.tracks.find(function (track) {
    return track.id === trackId
  })
}

function findTrackByKind(project: Project, kind: TrackKind): Track | undefined {
  return project.tracks.find(function (track) {
    return track.kind === kind
  })
}

function findClip(project: Project, clipId: string): Clip | undefined {
  for (const track of project.tracks) {
    const clip = track.clips.find(function (item) {
      return item.id === clipId
    })
    if (clip) return clip
  }
  return undefined
}

function findClipLocation(
  project: Project,
  clipId: string
): { track: Track; clip: Clip; index: number } | undefined {
  for (const track of project.tracks) {
    const index = track.clips.findIndex(function (item) {
      return item.id === clipId
    })
    if (index >= 0) {
      return { track, clip: track.clips[index]!, index }
    }
  }
  return undefined
}

function refreshDuration(project: Project): number {
  let max = 0
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      const end = clip.startMs + clip.durationMs / Math.max(0.1, clip.speed)
      if (end > max) max = end
    }
  }
  return Math.ceil(max)
}

function formatTimecode(ms: number): string {
  const total = Math.max(0, Math.floor(ms))
  const minutes = Math.floor(total / 60000)
  const seconds = Math.floor((total % 60000) / 1000)
  const centis = Math.floor((total % 1000) / 10)
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centis).padStart(2, '0')}`
}

function splitClipAt(project: Project, clipId: string, atMs: number): Project | null {
  const located = findClipLocation(project, clipId)
  if (!located) return null
  const { track, clip, index } = located
  const clipStart = clip.startMs
  const clipEnd = clip.startMs + clip.durationMs / Math.max(0.1, clip.speed)
  if (atMs <= clipStart + 50 || atMs >= clipEnd - 50) return null

  const offsetOnTimeline = atMs - clipStart
  const sourceOffset = offsetOnTimeline * Math.max(0.1, clip.speed)
  const leftDuration = sourceOffset
  const rightDuration = clip.durationMs - sourceOffset

  const left: Clip = { ...clip, durationMs: leftDuration }
  const right: Clip = {
    ...structuredClone(clip),
    id: createId('clip'),
    startMs: atMs,
    sourceInMs: clip.sourceInMs + sourceOffset,
    durationMs: rightDuration
  }

  const nextTracks = project.tracks.map(function (item) {
    if (item.id !== track.id) return item
    const clips = [...item.clips]
    clips.splice(index, 1, left, right)
    return { ...item, clips }
  })

  const next = { ...project, tracks: nextTracks }
  next.durationMs = refreshDuration(next)
  return next
}

function detachAudio(project: Project, clipId: string, assets: MediaAsset[]): Project | null {
  const located = findClipLocation(project, clipId)
  if (!located) return null
  const { clip } = located
  if (clip.kind !== 'video' || !clip.assetId) return null
  const asset = assets.find(function (item) {
    return item.id === clip.assetId
  })
  if (!asset?.hasAudio) return null

  const placed = placeClipOnLane(project, 'audio', clip.startMs, clip.durationMs, clip.speed)
  const audioClip = createClipDefaults({
    kind: 'audio',
    trackId: placed.trackId,
    assetId: clip.assetId,
    startMs: clip.startMs,
    durationMs: clip.durationMs,
    sourceInMs: clip.sourceInMs,
    speed: clip.speed,
    volume: clip.volume,
    fadeInMs: clip.fadeInMs,
    fadeOutMs: clip.fadeOutMs,
    label: `${asset.name} 音频`
  })

  let next = updateClip(placed.project, clip.id, { volume: 0 })
  next = insertClip(next, placed.trackId, audioClip)
  return next
}

function removeClip(project: Project, clipId: string): Project {
  const nextTracks = project.tracks.map(function (track) {
    return {
      ...track,
      clips: track.clips.filter(function (clip) {
        return clip.id !== clipId
      })
    }
  })
  const next = pruneEmptyLanes({ ...project, tracks: nextTracks })
  next.durationMs = refreshDuration(next)
  return next
}

function updateClip(project: Project, clipId: string, patch: Partial<Clip>): Project {
  const nextTracks = project.tracks.map(function (track) {
    return {
      ...track,
      clips: track.clips.map(function (clip) {
        return clip.id === clipId ? { ...clip, ...patch } : clip
      })
    }
  })
  const next = { ...project, tracks: nextTracks }
  next.durationMs = refreshDuration(next)
  return next
}

function insertClip(project: Project, trackId: string, clip: Clip): Project {
  const nextTracks = project.tracks.map(function (track) {
    if (track.id !== trackId) return track
    return { ...track, clips: [...track.clips, { ...clip, trackId }] }
  })
  const next = { ...project, tracks: nextTracks }
  next.durationMs = refreshDuration(next)
  return next
}

function findActiveClips(project: Project, atMs: number): Clip[] {
  const active: Clip[] = []
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      const end = clip.startMs + clip.durationMs / Math.max(0.1, clip.speed)
      if (atMs >= clip.startMs && atMs < end) active.push(clip)
    }
  }
  return active
}

function parseAspectCss(aspect: AspectRatio): string {
  const size = ASPECT_SIZE[aspect]
  return `${size.width} / ${size.height}`
}

function colorToCssFilter(filter: ColorAdjust): string {
  const brightness = 1 + filter.exposure
  const contrast = 1 + filter.contrast
  const saturate = 1 + filter.saturation
  const sepia = Math.max(0, filter.temperature) * 0.35
  const hue = filter.temperature * 18
  const opacity = 1 - filter.transparency
  return [
    `brightness(${brightness})`,
    `contrast(${contrast})`,
    `saturate(${saturate})`,
    `sepia(${sepia})`,
    `hue-rotate(${hue}deg)`,
    `opacity(${opacity})`
  ].join(' ')
}

function maskToCss(mask: MaskSpec): string | undefined {
  if (mask.kind === 'none') return undefined
  if (mask.kind === 'circle') return 'circle(50% at 50% 50%)'
  if (mask.kind === 'rounded') return 'inset(0 round 18%)'
  return 'inset(0)'
}

export type {
  AspectRatio,
  TrackKind,
  ClipKind,
  MediaSurface,
  InspectorTab,
  AnimKind,
  TransitionKind,
  MaskKind,
  ColorAdjust,
  AnimSpec,
  TransitionSpec,
  MaskSpec,
  TextSpec,
  CaptionCue,
  FilmstripMeta,
  WaveformMeta,
  MediaAsset,
  Clip,
  Track,
  Project,
  ExportPreset
}

export {
  ASPECT_RATIOS,
  ASPECT_OPTIONS,
  ASPECT_SIZE,
  EXPORT_PRESETS,
  fitExportPreset,
  COLOR_NEUTRAL,
  ANIM_NONE,
  TRANSITION_NONE,
  MASK_NONE,
  FILTER_PRESETS,
  STICKER_LIBRARY,
  MAX_UNDO,
  TRACK_KIND_LABEL,
  TRACK_KIND_ORDER,
  createId,
  createClipDefaults,
  createEmptyProject,
  createTrack,
  findTrack,
  findTrackByKind,
  findTracksByKind,
  findTrackDisplayName,
  findClipEndMs,
  findClip,
  findClipLocation,
  hasTrackOverlap,
  placeClipOnLane,
  insertTrackInKindGroup,
  pruneEmptyLanes,
  refreshDuration,
  formatTimecode,
  splitClipAt,
  detachAudio,
  removeClip,
  updateClip,
  insertClip,
  findActiveClips,
  parseAspectCss,
  colorToCssFilter,
  maskToCss
}
