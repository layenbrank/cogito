import { convertFileSrc } from '@tauri-apps/api/core'
import { open as dialogOpen, save as dialogSave } from '@tauri-apps/plugin-dialog'
import { toast } from 'sonner'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

import { findPref, replacePref } from '@/features/persist'
import { MediaIpc } from '@/lib/media-ipc'
import { reportCaught } from '@/utils/exception-report'
import {
  MAX_UNDO,
  STICKER_LIBRARY,
  buildClipDefaults,
  makeEmptyProject,
  makeId,
  detachAudio,
  findActiveClips,
  findClip,
  formatTimecode,
  insertClip,
  placeClipOnLane,
  refreshDuration,
  removeClip,
  splitClipAt,
  updateClip,
  type AspectRatio,
  type Clip,
  type ExportPreset,
  type InspectorTab,
  type MediaAsset,
  type MediaSurface,
  type Project
} from '@/views/clipchamp/lib/project'
import { buildExportArgs } from '@/views/clipchamp/lib/export-graph'
import { ensureWaveform } from '@/views/clipchamp/lib/media-preview'
import { readPlayheadMs, writePlayheadMs } from '@/views/clipchamp/lib/playhead-clock'

interface ClipchampState {
  project: Project
  assets: MediaAsset[]
  playheadMs: number
  isPlaying: boolean
  selectedClipId: string | null
  mediaSurface: MediaSurface
  inspectorTab: InspectorTab
  timelineZoom: number
  isSnapping: boolean
  isFullscreen: boolean
  undoStack: Project[]
  redoStack: Project[]
  exportProgress: number | null
  isExporting: boolean
  exportPresetId: string
  /** 比例菜单悬停时的画布预览，不写入项目 */
  canvasAspect: AspectRatio | null

  commit: (mutate: (project: Project) => Project) => void
  /** 实时拖拽等不入历史的变更 */
  updateLive: (mutate: (project: Project) => Project) => void
  /** 拖拽开始前调用，将当前工程推入 undo */
  captureUndoPoint: () => void
  undo: () => void
  redo: () => void
  seek: (ms: number) => void
  play: () => void
  pause: () => void
  togglePlay: () => void
  selectClip: (clipId: string | null) => void
  updateMediaSurface: (surface: MediaSurface) => void
  updateInspectorTab: (tab: InspectorTab) => void
  updateTimelineZoom: (zoom: number) => void
  updateSnapping: (isSnapping: boolean) => void
  updateFullscreen: (isFullscreen: boolean) => void
  updateAspect: (aspect: AspectRatio) => void
  updateCanvasAspect: (aspect: AspectRatio | null) => void
  updateExportPreset: (presetId: string) => void
  exportVideo: (preset: ExportPreset) => Promise<void>
  importMedia: () => Promise<void>
  importFromGallery(asset: {
    id: string
    path: string
    name: string
    kind: 'video' | 'image'
    durationMs?: number
  }): Promise<void>
  patchAsset: (assetId: string, patch: Partial<MediaAsset>) => void
  /** 后台生成 filmstrip / waveform，不阻塞导入 */
  hydrateAssetPreviews: (assetIds: string[]) => void
  addAssetToTimeline: (assetId: string, trackKind?: 'video' | 'overlay' | 'audio') => void
  addTextClip: (content?: string) => void
  addSticker: (stickerId: string) => void
  addCaptionCue: (text?: string) => void
  splitAtPlayhead: () => void
  detachSelectedAudio: () => void
  removeSelected: () => void
  patchSelected: (patch: Partial<Clip>) => void
  tick: (deltaMs: number) => void
  persistProject: () => void
  restoreProject: (options?: { silent?: boolean }) => void
  resetProject: () => void
}

let lastActiveKey = ''

function pushHistory(
  undoStack: Project[],
  project: Project
): { undoStack: Project[]; redoStack: Project[] } {
  const stack = [...undoStack, structuredClone(project)]
  if (stack.length > MAX_UNDO) stack.shift()
  return { undoStack: stack, redoStack: [] }
}

function findFileName(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  return normalized.split('/').pop() || path
}

function findExt(name: string): string {
  const parts = name.split('.')
  if (parts.length < 2) return ''
  return parts[parts.length - 1].toLowerCase()
}

function parseMediaKind(path: string): 'video' | 'audio' | 'image' {
  const ext = findExt(findFileName(path))
  if (['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'wma'].includes(ext)) return 'audio'
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext)) return 'image'
  return 'video'
}

const useClipchampStore = create<ClipchampState>()(
  devtools(
    function (setter, getter) {
      return {
        project: makeEmptyProject('Video Project'),
        assets: [],
        playheadMs: 0,
        isPlaying: false,
        selectedClipId: null,
        mediaSurface: 'media',
        inspectorTab: 'transform',
        timelineZoom: 1,
        isSnapping: true,
        isFullscreen: false,
        undoStack: [],
        redoStack: [],
        exportProgress: null,
        isExporting: false,
        exportPresetId: '1080p',
        canvasAspect: null,

        commit(mutate) {
          const prev = getter().project
          const next = mutate(structuredClone(prev))
          next.durationMs = refreshDuration(next)
          const history = pushHistory(getter().undoStack, prev)
          setter({ project: next, ...history })
        },

        updateLive(mutate) {
          const next = mutate(structuredClone(getter().project))
          next.durationMs = refreshDuration(next)
          setter({ project: next })
        },

        captureUndoPoint() {
          const history = pushHistory(getter().undoStack, getter().project)
          setter(history)
        },

        undo() {
          const { undoStack, project, redoStack } = getter()
          if (undoStack.length === 0) return
          const prev = undoStack[undoStack.length - 1]
          setter({
            project: prev,
            undoStack: undoStack.slice(0, -1),
            redoStack: [...redoStack, structuredClone(project)],
            selectedClipId: null
          })
        },

        redo() {
          const { redoStack, project, undoStack } = getter()
          if (redoStack.length === 0) return
          const next = redoStack[redoStack.length - 1]
          setter({
            project: next,
            redoStack: redoStack.slice(0, -1),
            undoStack: [...undoStack, structuredClone(project)],
            selectedClipId: null
          })
        },

        seek(ms) {
          const duration = getter().project.durationMs
          const next = Math.max(0, Math.min(ms, Math.max(duration, 0)))
          writePlayheadMs(next)
          lastActiveKey = ''
          setter({ playheadMs: next })
        },

        play() {
          if (getter().project.durationMs <= 0) return
          writePlayheadMs(getter().playheadMs)
          setter({ isPlaying: true })
        },

        pause() {
          const ms = readPlayheadMs()
          setter({ isPlaying: false, playheadMs: ms })
        },

        togglePlay() {
          if (getter().isPlaying) getter().pause()
          else getter().play()
        },

        selectClip(clipId) {
          setter({ selectedClipId: clipId })
        },

        updateMediaSurface(surface) {
          setter({ mediaSurface: surface })
        },

        updateInspectorTab(tab) {
          setter({ inspectorTab: tab })
        },

        updateTimelineZoom(zoom) {
          setter({ timelineZoom: Math.max(0.25, Math.min(4, zoom)) })
        },

        updateSnapping(isSnapping) {
          setter({ isSnapping })
        },

        updateFullscreen(isFullscreen) {
          setter({ isFullscreen })
        },

        updateAspect(aspect) {
          setter({ canvasAspect: null })
          getter().commit(function (project) {
            return { ...project, aspect }
          })
        },

        updateCanvasAspect(aspect) {
          setter({ canvasAspect: aspect })
        },

        updateExportPreset(presetId) {
          setter({ exportPresetId: presetId })
        },

        async importMedia() {
          const selected = await dialogOpen({
            multiple: true,
            filters: [
              {
                name: '媒体',
                extensions: [
                  'mp4',
                  'mov',
                  'webm',
                  'mkv',
                  'avi',
                  'm4v',
                  'mp3',
                  'wav',
                  'aac',
                  'm4a',
                  'png',
                  'jpg',
                  'jpeg',
                  'webp',
                  'gif'
                ]
              }
            ]
          })
          if (!selected) return
          const paths = Array.isArray(selected) ? selected : [selected]
          const imported: MediaAsset[] = []

          for (const path of paths) {
            const name = findFileName(path)
            const kind = parseMediaKind(path)
            const src = convertFileSrc(path)
            let durationMs = kind === 'image' ? 5000 : 0
            let width: number | undefined
            let height: number | undefined
            let hasAudio = kind === 'audio'

            // 先用 HTML 元数据（不 spawn 子进程）；ffprobe 失败也不影响导入
            if (kind === 'video' || kind === 'audio') {
              durationMs = await probeHtmlDuration(src)
            }

            try {
              const probed = await MediaIpc.probe(path)
              if (probed.durationMs > 0) durationMs = probed.durationMs
              width = probed.width
              height = probed.height
              hasAudio = kind === 'audio' ? true : probed.hasAudio
            } catch (error) {
              console.warn('[clipchamp] ffprobe failed, using HTML metadata', error)
            }

            imported.push({
              id: makeId('asset'),
              path,
              name,
              kind,
              durationMs: durationMs || 3000,
              width,
              height,
              hasAudio: kind === 'audio' ? true : hasAudio,
              thumbUrl: src
            })
          }

          if (imported.length === 0) return
          setter({ assets: [...getter().assets, ...imported] })
          toast.success(`已导入 ${imported.length} 个素材`)
          getter().hydrateAssetPreviews(
            imported.map(function (item) {
              return item.id
            })
          )
        },

        async importFromGallery(asset) {
          const kind = asset.kind === 'image' ? 'image' : 'video'
          const src = convertFileSrc(asset.path)
          let durationMs = asset.durationMs || (kind === 'image' ? 5000 : 0)
          let width: number | undefined
          let height: number | undefined
          let hasAudio = false
          if (kind === 'video') {
            durationMs = durationMs || (await probeHtmlDuration(src))
          }
          try {
            const probed = await MediaIpc.probe(asset.path)
            if (probed.durationMs > 0) durationMs = probed.durationMs
            width = probed.width
            height = probed.height
            hasAudio = probed.hasAudio
          } catch (error) {
            console.warn('[clipchamp] gallery probe failed, using HTML metadata', error)
          }
          const media: MediaAsset = {
            id: makeId('asset'),
            path: asset.path,
            name: asset.name,
            kind,
            durationMs: durationMs || 3000,
            width,
            height,
            hasAudio,
            thumbUrl: src,
            galleryId: asset.id
          }
          setter({ assets: [...getter().assets, media], mediaSurface: 'media' })
          toast.success('已从图库加入素材')
          getter().hydrateAssetPreviews([media.id])
        },

        patchAsset(assetId, patch) {
          setter({
            assets: getter().assets.map(function (item) {
              return item.id === assetId ? { ...item, ...patch } : item
            })
          })
        },

        hydrateAssetPreviews(assetIds) {
          // 胶片改为视口 LOD 按需抽帧；导入只预热波形
          const idSet = new Set(assetIds)
          for (const asset of getter().assets) {
            if (!idSet.has(asset.id)) continue
            if (!(asset.kind === 'audio' || (asset.kind === 'video' && asset.hasAudio))) continue
            void (async function () {
              const waveform = await ensureWaveform(asset)
              if (waveform) getter().patchAsset(asset.id, { waveform })
            })()
          }
        },

        addAssetToTimeline(assetId, trackKind) {
          const asset = getter().assets.find(function (item) {
            return item.id === assetId
          })
          if (!asset) return
          const playhead = readPlayheadMs()

          const kindTrack: 'video' | 'overlay' | 'audio' =
            trackKind ||
            (asset.kind === 'audio' ? 'audio' : asset.kind === 'image' ? 'overlay' : 'video')

          const clipKind =
            asset.kind === 'audio' ? 'audio' : asset.kind === 'image' ? 'image' : 'video'

          let selectedId: string | null = null
          getter().commit(function (draft) {
            const placed = placeClipOnLane(draft, kindTrack, playhead, asset.durationMs)
            const clip = buildClipDefaults({
              kind: clipKind,
              trackId: placed.trackId,
              assetId: asset.id,
              startMs: playhead,
              durationMs: asset.durationMs,
              sourceInMs: 0,
              label: asset.name,
              scale: kindTrack === 'overlay' ? 0.35 : 1,
              x: kindTrack === 'overlay' ? 0.78 : 0.5,
              y: kindTrack === 'overlay' ? 0.78 : 0.5
            })
            selectedId = clip.id
            return insertClip(placed.project, placed.trackId, clip)
          })
          if (selectedId) setter({ selectedClipId: selectedId })
        },

        addTextClip(content = '双击编辑文本') {
          const playhead = readPlayheadMs()
          let selectedId: string | null = null
          getter().commit(function (draft) {
            const placed = placeClipOnLane(draft, 'text', playhead, 3000)
            const clip = buildClipDefaults({
              kind: 'text',
              trackId: placed.trackId,
              startMs: playhead,
              durationMs: 3000,
              text: {
                content,
                fontSize: 48,
                color: '#ffffff',
                fontWeight: 700,
                align: 'center'
              },
              enterAnim: { kind: 'fade', durationMs: 400 },
              exitAnim: { kind: 'fade', durationMs: 400 },
              label: content.slice(0, 12)
            })
            selectedId = clip.id
            return insertClip(placed.project, placed.trackId, clip)
          })
          if (selectedId) {
            setter({
              selectedClipId: selectedId,
              mediaSurface: 'text',
              inspectorTab: 'transform'
            })
          }
        },

        addSticker(stickerId) {
          const sticker = STICKER_LIBRARY.find(function (item) {
            return item.id === stickerId
          })
          if (!sticker) return
          const playhead = readPlayheadMs()
          let selectedId: string | null = null
          getter().commit(function (draft) {
            const placed = placeClipOnLane(draft, 'overlay', playhead, 3000)
            const clip = buildClipDefaults({
              kind: 'sticker',
              trackId: placed.trackId,
              startMs: playhead,
              durationMs: 3000,
              scale: 0.2,
              x: 0.5,
              y: 0.35,
              text: {
                content: sticker.emoji,
                fontSize: 96,
                color: '#ffffff',
                fontWeight: 400,
                align: 'center'
              },
              enterAnim: { kind: 'zoom', durationMs: 350 },
              exitAnim: { kind: 'fade', durationMs: 300 },
              label: sticker.label
            })
            selectedId = clip.id
            return insertClip(placed.project, placed.trackId, clip)
          })
          if (selectedId) {
            setter({ selectedClipId: selectedId, mediaSurface: 'stickers' })
          }
        },

        addCaptionCue(text = '字幕内容') {
          const playhead = readPlayheadMs()
          let selectedId: string | null = null
          getter().commit(function (draft) {
            const placed = placeClipOnLane(draft, 'caption', playhead, 2500)
            const clip = buildClipDefaults({
              kind: 'caption',
              trackId: placed.trackId,
              startMs: playhead,
              durationMs: 2500,
              y: 0.88,
              text: {
                content: text,
                fontSize: 32,
                color: '#ffffff',
                fontWeight: 600,
                align: 'center'
              },
              label: text.slice(0, 16)
            })
            selectedId = clip.id
            return insertClip(placed.project, placed.trackId, clip)
          })
          if (selectedId) {
            setter({ selectedClipId: selectedId, inspectorTab: 'captions' })
          }
        },

        splitAtPlayhead() {
          const { selectedClipId, project } = getter()
          const playheadMs = readPlayheadMs()
          if (!selectedClipId) {
            toast.message('请先选中要分割的片段')
            return
          }
          const next = splitClipAt(project, selectedClipId, playheadMs)
          if (!next) {
            toast.message('播放头需落在片段内部才能分割')
            return
          }
          const history = pushHistory(getter().undoStack, project)
          setter({ project: next, ...history })
        },

        detachSelectedAudio() {
          const { selectedClipId, project, assets } = getter()
          if (!selectedClipId) return
          const next = detachAudio(project, selectedClipId, assets)
          if (!next) {
            toast.message('当前片段无法分离音频')
            return
          }
          const history = pushHistory(getter().undoStack, project)
          setter({ project: next, ...history, inspectorTab: 'audio' })
          toast.success('已分离音频到音频轨')
        },

        removeSelected() {
          const { selectedClipId, project } = getter()
          if (!selectedClipId) return
          const history = pushHistory(getter().undoStack, project)
          const next = removeClip(project, selectedClipId)
          setter({ project: next, selectedClipId: null, ...history })
        },

        patchSelected(patch) {
          const { selectedClipId } = getter()
          if (!selectedClipId) return
          getter().updateLive(function (draft) {
            return updateClip(draft, selectedClipId, patch)
          })
        },

        tick(deltaMs) {
          if (!getter().isPlaying) return
          const duration = getter().project.durationMs
          const next = readPlayheadMs() + deltaMs
          if (next >= duration) {
            writePlayheadMs(duration)
            setter({ playheadMs: duration, isPlaying: false })
            return
          }
          writePlayheadMs(next)
          const activeKey = findActiveClips(getter().project, next)
            .map(function (clip) {
              return clip.id
            })
            .join('\0')
          if (activeKey !== lastActiveKey) {
            lastActiveKey = activeKey
            setter({ playheadMs: next })
          }
        },

        async exportVideo(preset) {
          const { project, assets, isExporting } = getter()
          if (isExporting) return
          if (project.durationMs <= 0) {
            toast.message('时间轴为空，无法导出')
            return
          }

          const dest = await dialogSave({
            defaultPath: `${project.name || 'export'}.mp4`,
            filters: [{ name: 'MP4', extensions: ['mp4'] }]
          })
          if (!dest) return

          setter({ isExporting: true, exportProgress: 0, exportPresetId: preset.id })
          const unlisten = await MediaIpc.listenExportProgress(function (progress) {
            setter({ exportProgress: progress })
          })

          try {
            const args = buildExportArgs(project, assets, dest, preset)
            await MediaIpc.exportVideo(args)
            setter({ exportProgress: 100 })
            toast.success(`导出完成：${dest}`)
            await new Promise(function (resolve) {
              window.setTimeout(resolve, 700)
            })
          } catch (error) {
            reportCaught('clipchamp.exportVideo', error)
            toast.error(error instanceof Error ? error.message : '导出失败')
          } finally {
            unlisten()
            setter({ isExporting: false, exportProgress: null })
          }
        },

        persistProject() {
          const payload = {
            project: getter().project,
            assets: getter().assets,
            exportPresetId: getter().exportPresetId
          }
          void replacePref('clipchamp', payload)
            .then(function () {
              toast.success('项目已保存到本地')
            })
            .catch(function (error: unknown) {
              toast.error('保存失败')
              reportCaught('clipchamp.persistProject', error)
            })
        },

        restoreProject(options?: { silent?: boolean }) {
          try {
            const parsed = findPref('clipchamp') as {
              project?: Project
              assets?: MediaAsset[]
              exportPresetId?: string
            }
            if (!parsed.project) {
              if (!options?.silent) toast.message('没有可恢复的项目')
              return
            }
            const assets = (parsed.assets || []).map(function (asset) {
              // asset protocol URL 不可持久化，恢复时按磁盘路径重建
              let thumbUrl = asset.thumbUrl
              let filmstrip = asset.filmstrip
              let waveform = asset.waveform
              try {
                thumbUrl = convertFileSrc(asset.path)
                if (filmstrip?.spritePath) {
                  filmstrip = {
                    ...filmstrip,
                    spriteUrl: convertFileSrc(filmstrip.spritePath)
                  }
                }
                if (waveform?.wavePath) {
                  waveform = {
                    ...waveform,
                    waveUrl: convertFileSrc(waveform.wavePath)
                  }
                }
              } catch (error) {
                console.warn('[clipchamp] convertFileSrc failed, keep stored thumb', error)
              }
              return { ...asset, thumbUrl, filmstrip, waveform }
            })
            writePlayheadMs(0)
            lastActiveKey = ''
            setter({
              project: parsed.project,
              assets,
              exportPresetId: parsed.exportPresetId || '1080p',
              playheadMs: 0,
              canvasAspect: null,
              selectedClipId: null,
              undoStack: [],
              redoStack: [],
              isPlaying: false
            })
            getter().hydrateAssetPreviews(
              assets.map(function (item) {
                return item.id
              })
            )
            if (!options?.silent) toast.success('已恢复本地项目')
          } catch (error) {
            if (!options?.silent) toast.error('恢复失败')
            reportCaught('clipchamp.restoreProject', error)
          }
        },

        resetProject() {
          writePlayheadMs(0)
          lastActiveKey = ''
          setter({
            project: makeEmptyProject('Video Project'),
            assets: [],
            playheadMs: 0,
            selectedClipId: null,
            undoStack: [],
            redoStack: [],
            isPlaying: false
          })
        }
      }
    },
    { name: 'clipchamp' }
  )
)

function probeHtmlDuration(src: string): Promise<number> {
  return new Promise(function (resolve) {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    let settled = false
    function finish(durationMs: number) {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
      resolve(durationMs)
    }
    const timer = window.setTimeout(function () {
      finish(3000)
    }, 8000)
    video.onloadedmetadata = function () {
      const seconds = video.duration
      if (!Number.isFinite(seconds) || seconds <= 0) {
        finish(3000)
        return
      }
      finish(Math.round(seconds * 1000))
    }
    video.onerror = function () {
      finish(3000)
    }
    video.src = src
  })
}

function findSelectedClip(state: ClipchampState): Clip | undefined {
  if (!state.selectedClipId) return undefined
  return findClip(state.project, state.selectedClipId)
}

export { useClipchampStore, findSelectedClip, formatTimecode }
export type { ClipchampState }
