import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { CHANNELS } from '@/shared/ipc/channels'
import { reportCaught } from '@/utils/exception-report'

import type { SurfaceStyleInput } from '@/features/magnetic-tile/surface-style'
import {
  findMarkerBox,
  LAYOUT_FALLBACK,
  parseMarkerLayout,
  type MarkerLayout
} from '@/features/magnetic-tile/size'

type OverlayMode = 'idle' | 'screenshot'

interface OverlayTexture {
  id: string
  kind: 'texture'
  x: number
  y: number
  w: number
  h: number
  z: number
  src: string
  opacity: number
  scale: number
  isThrough: boolean
}

interface OverlayTile {
  id: string
  /** 磁贴 component，与主窗一致 */
  kind: MagneticTile.Component
  x: number
  y: number
  w: number
  h: number
  z: number
  scale: number
  magneticTileID: string
  size: Mirror.Size
  shape: Mirror.Shape
  direction: Mirror.Direction
  round: string | null
  background: MagneticTile.Background | null
  title: string
  mark: string | null
}

type OverlayItem = OverlayTexture | OverlayTile

/** overlay:write 磁贴载荷（camelCase JSON，tenantID 大写 ID） */
interface TileWritePayload {
  kind: 'tile'
  x: number
  y: number
  w: number
  h: number
  z: number
  scale: number
  tenantID: string
  component: MagneticTile.Component
  size: Mirror.Size
  shape: Mirror.Shape
  direction: Mirror.Direction
  round: string | null
  background: string | null
  title: string
  mark: string | null
}

/** overlay:update patch：texture / tile 可更新字段并集（isThrough 不持久化） */
type OverlayPatch = Partial<
  Pick<OverlayTexture, 'x' | 'y' | 'w' | 'h' | 'z' | 'opacity' | 'scale' | 'isThrough' | 'src'> &
    Pick<OverlayTile, 'size' | 'shape' | 'direction' | 'round' | 'background' | 'title' | 'mark'>
>

/** overlay:read 返回行 */
interface OverlayRow {
  id: string
  kind: 'texture' | 'tile'
  x: number
  y: number
  w: number
  h: number
  z: number
  src?: string | null
  opacity?: number | null
  tenantID?: string | null
  component?: string | null
  size?: Mirror.Size | null
  shape?: Mirror.Shape | null
  direction?: Mirror.Direction | null
  round?: string | null
  background?: string | null
  title?: string | null
  mark?: string | null
  scale?: number | null
  archivedAt?: string | null
  createdAt: string
  updatedAt: string
}

interface OverlayStore {
  mode: OverlayMode
  items: OverlayItem[]
  zCursor: number
  toMode: (mode: OverlayMode) => void
  toMount: (
    kind: MagneticTile.Component,
    magneticTileID: string,
    layout?: Partial<MarkerLayout> &
      SurfaceStyleInput & {
        title?: string
        mark?: string | null
      }
  ) => void
  toWrite: (input: {
    src: string
    title?: string
    x?: number
    y?: number
    w: number
    h: number
    opacity?: number
  }) => string
  toUpdate: (id: string, patch: OverlayPatch) => void
  toRemove: (id: string) => void
  toClear: () => void
  toFront: (id: string) => void
  hasContent: () => boolean
  toHide: () => Promise<void>
  toShow: () => Promise<void>
  toScreenshot: () => Promise<void>
  toExit: () => Promise<void>
  toScreenshotExit: () => Promise<void>
  toInitialize: () => Promise<void>
}

function nextZ(state: { zCursor: number }): number {
  state.zCursor += 1
  return state.zCursor
}

const useOverlayStore = create<OverlayStore>()(
  devtools(
    immer(function (setter, getter) {
      /** 防抖定时器 + 按 id 合并的待发送 patch */
      let updateTimer: ReturnType<typeof setTimeout> | undefined
      const pendingPatches = new Map<string, OverlayPatch>()

      function scheduleUpdate(id: string, patch: OverlayPatch) {
        const merged = pendingPatches.get(id) ?? {}
        pendingPatches.set(id, Object.assign(merged, patch))
        clearTimeout(updateTimer)
        updateTimer = setTimeout(flushUpdates, 150)
      }

      function flushUpdates() {
        updateTimer = undefined
        const batch = Array.from(pendingPatches.entries())
        pendingPatches.clear()
        for (const [id, patch] of batch) {
          // isThrough 仅运行时状态，不持久化
          const { isThrough: _isThrough, ...rest } = patch
          if (Object.keys(rest).length === 0) continue
          void invoke(CHANNELS.OVERLAY.UPDATE, { id, patch: rest }).catch(function (e) {
            console.warn('[overlay] update failed:', e)
          })
        }
      }

      function dropPending(id: string) {
        pendingPatches.delete(id)
      }

      return {
        mode: 'idle',
        items: [],
        zCursor: 10,

        toMode(mode) {
          setter(function (state) {
            state.mode = mode
          })
        },

        toMount(kind, magneticTileID, layout) {
          let payload: TileWritePayload | null = null
          setter(function (state) {
            const parsed = parseMarkerLayout(layout)
            const box = findMarkerBox(parsed)
            const round = layout?.round ?? null
            const background = layout?.background ?? null
            const title = layout?.title ?? ''
            const mark = layout?.mark ?? null
            const existing = state.items.find(function (w) {
              return w.kind !== 'texture' && w.id === magneticTileID
            })
            if (existing && existing.kind !== 'texture') {
              existing.z = nextZ(state)
              existing.kind = kind
              existing.size = parsed.size
              existing.shape = parsed.shape
              existing.direction = parsed.direction
              existing.round = round
              existing.background = background
              existing.title = title
              existing.mark = mark
              existing.w = box.w
              existing.h = box.h
              payload = {
                kind: 'tile',
                x: existing.x,
                y: existing.y,
                w: existing.w,
                h: existing.h,
                z: existing.z,
                tenantID: magneticTileID,
                component: kind,
                size: parsed.size,
                shape: parsed.shape,
                direction: parsed.direction,
                round,
                background: background ? JSON.stringify(background) : null,
                title,
                mark,
                scale: existing.scale ?? 1
              }
              return
            }
            const screenW = window.innerWidth
            const screenH = window.innerHeight
            const jitter = function () {
              return (Math.random() - 0.5) * 40
            }
            const cx = Math.max(0, (screenW - box.w) / 2 + jitter())
            const cy = Math.max(0, (screenH - box.h) / 2 + jitter())
            state.items.push({
              id: magneticTileID,
              kind,
              x: cx,
              y: cy,
              w: box.w,
              h: box.h,
              z: nextZ(state),
              scale: 1,
              magneticTileID,
              size: parsed.size,
              shape: parsed.shape,
              direction: parsed.direction,
              round,
              background,
              title,
              mark
            })
            payload = {
              kind: 'tile',
              x: cx,
              y: cy,
              w: box.w,
              h: box.h,
              z: state.zCursor,
              scale: 1,
              tenantID: magneticTileID,
              component: kind,
              size: parsed.size,
              shape: parsed.shape,
              direction: parsed.direction,
              round,
              background: background ? JSON.stringify(background) : null,
              title,
              mark
            }
          })
          if (payload) {
            void invoke(CHANNELS.OVERLAY.WRITE, { item: payload }).catch(function (e) {
              console.warn('[overlay] write tile failed:', e)
            })
          }
          void getter().toShow()
        },

        toWrite(input) {
          let id = ''
          let writeItem: {
            kind: 'texture'
            x: number
            y: number
            w: number
            h: number
            z: number
            src: string
            opacity: number
            scale: number
            title: string
            mark: string | null
          } | null = null
          setter(function (state) {
            id = `texture-${Date.now()}-${state.zCursor}`
            const screenW = window.innerWidth
            const screenH = window.innerHeight
            const jitter = (state.items.filter(function (w) {
              return w.kind === 'texture'
            }).length % 8) * 28 * (Math.random() > 0.5 ? 1 : -1)
            const defaultX = Math.max(0, (screenW - input.w) / 2 + jitter)
            const defaultY = Math.max(0, (screenH - input.h) / 2 + jitter)
            const item: OverlayTexture = {
              id,
              kind: 'texture',
              x: input.x ?? defaultX,
              y: input.y ?? defaultY,
              w: input.w,
              h: input.h,
              z: nextZ(state),
              src: input.src,
              opacity: input.opacity ?? 1,
              scale: 1,
              isThrough: false
            }
            state.items.push(item)
            writeItem = {
              kind: 'texture',
              x: item.x,
              y: item.y,
              w: item.w,
              h: item.h,
              z: item.z,
              src: item.src,
              opacity: item.opacity,
              scale: item.scale,
              title: input.title ?? '',
              mark: null
            }
          })
          if (writeItem) {
            const localId = id
            void invoke<string>(CHANNELS.OVERLAY.WRITE, { item: writeItem })
              .then(function (rowId) {
                // texture 以后端返回的 id 为准，回填本地 item
                if (!rowId || rowId === localId) return
                setter(function (state) {
                  const entry = state.items.find(function (w) {
                    return w.id === localId
                  })
                  if (entry) entry.id = rowId
                })
              })
              .catch(function (e) {
                console.warn('[overlay] write texture failed:', e)
              })
          }
          void getter().toShow()
          return id
        },

        toUpdate(id, patch) {
          setter(function (state) {
            const entry = state.items.find(function (w) {
              return w.id === id
            })
            if (!entry) return
            Object.assign(entry, patch)
          })
          scheduleUpdate(id, patch)
        },

        toRemove(id) {
          setter(function (state) {
            state.items = state.items.filter(function (w) {
              return w.id !== id
            })
          })
          dropPending(id)
          void invoke(CHANNELS.OVERLAY.REMOVE, { ids: [id] }).catch(function (e) {
            console.warn('[overlay] remove failed:', e)
          })
          void getter().toHide()
        },

        toClear() {
          const textureIds = getter()
            .items.filter(function (w) {
              return w.kind === 'texture'
            })
            .map(function (w) {
              return w.id
            })
          setter(function (state) {
            state.items = state.items.filter(function (w) {
              return w.kind !== 'texture'
            })
          })
          textureIds.forEach(dropPending)
          if (textureIds.length > 0) {
            void invoke(CHANNELS.OVERLAY.REMOVE, { ids: textureIds }).catch(function (e) {
              console.warn('[overlay] clear failed:', e)
            })
          }
          void getter().toHide()
        },

        toFront(id) {
          let z: number | undefined
          setter(function (state) {
            const entry = state.items.find(function (w) {
              return w.id === id
            })
            if (!entry) return
            entry.z = nextZ(state)
            z = entry.z
          })
          if (z !== undefined) scheduleUpdate(id, { z })
        },

        hasContent() {
          return getter().items.length > 0 || getter().mode === 'screenshot'
        },

        async toHide() {
          const { mode, items } = getter()
          if (mode === 'screenshot' || items.length > 0) return
          try {
            await invoke(CHANNELS.OVERLAY.HIDE)
          } catch (e) {
            console.warn('[overlay] toHide failed:', e)
          }
        },

        async toShow() {
          try {
            await invoke(CHANNELS.OVERLAY.ENSURE)
          } catch (e) {
            console.warn('[overlay] toShow failed:', e)
          }
        },

        async toScreenshot() {
          const previous = getter().mode
          setter(function (state) {
            state.mode = 'screenshot'
          })
          try {
            await invoke(CHANNELS.OVERLAY.UPDATE_MODE, { mode: 'screenshot' })
          } catch (e) {
            console.warn('[overlay] toScreenshot failed:', e)
            setter(function (state) {
              state.mode = previous
            })
          }
        },

        async toExit() {
          const previous = getter().mode
          setter(function (state) {
            state.mode = 'idle'
          })
          try {
            // capture:close 会清 pending 并切 idle，避免残留预截图
            await invoke(CHANNELS.CAPTURE.CLOSE)
          } catch (e) {
            console.warn('[overlay] toExit failed:', e)
            setter(function (state) {
              state.mode = previous
            })
            return
          }
          await getter().toHide()
        },

        async toScreenshotExit() {
          await getter().toExit()
        },

        async toInitialize() {
          try {
            const rows = await invoke<OverlayRow[]>(CHANNELS.OVERLAY.READ)
            if (!Array.isArray(rows)) return
            const items: OverlayItem[] = []
            for (const row of rows) {
              // structuredClone 确保每个 item 是可变的纯对象，避免 IPC/Immer 冻结
              const base = structuredClone(row)
              if (base.kind === 'texture') {
                items.push({
                  id: base.id,
                  kind: 'texture',
                  x: base.x,
                  y: base.y,
                  w: base.w,
                  h: base.h,
                  z: base.z,
                  src: base.src ?? '',
                  opacity: base.opacity ?? 1,
                  scale: base.scale ?? 1,
                  isThrough: false
                })
              } else if (base.kind === 'tile') {
                items.push({
                  id: base.id,
                  kind: base.component as MagneticTile.Component,
                  x: base.x,
                  y: base.y,
                  w: base.w,
                  h: base.h,
                  z: base.z,
                  scale: base.scale ?? 1,
                  magneticTileID: base.tenantID ?? base.id,
                  size: base.size ?? LAYOUT_FALLBACK.size,
                  shape: base.shape ?? LAYOUT_FALLBACK.shape,
                  direction: base.direction ?? LAYOUT_FALLBACK.direction,
                  round: base.round ?? null,
                  background: base.background
                    ? (JSON.parse(base.background) as MagneticTile.Background)
                    : null,
                  title: base.title ?? '',
                  mark: base.mark ?? null
                })
              }
            }
            // 传入 store 的必须是副本，否则 Immer 会冻结原始 items 导致后续边界校验无法写入
            setter(function (state) {
              state.items = structuredClone(items)
              if (items.length > 0) {
                state.zCursor =
                  Math.max(
                    ...items.map(function (i) {
                      return i.z
                    }),
                    10
                  ) + 1
              }
            })

            // 坐标边界校验：适配多屏/缩放变化
            let screenW = 1920
            let screenH = 1080
            try {
              const win = getCurrentWindow()
              const sf = await win.scaleFactor()
              const sz = await win.innerSize()
              screenW = sz.width / sf
              screenH = sz.height / sf
            } catch (e) {
              console.warn('[overlay] read screen size failed, using fallback:', e)
            }

            const clampedItems = items.map(function (item) {
              const cx = Math.max(0, Math.min(item.x, screenW - (item.w ?? 60)))
              const cy = Math.max(0, Math.min(item.y, screenH - (item.h ?? 60)))
              if (cx !== item.x || cy !== item.y) {
                return { ...item, x: cx, y: cy }
              }
              return item
            })
            const needsSave = clampedItems.some(function (item, idx) {
              return item.x !== items[idx].x || item.y !== items[idx].y
            })

            // 坐标有修正则更新 store 并批量持久化
            if (needsSave) {
              setter(function (state) {
                const itemsById = new Map(
                  state.items.map(function (entry) {
                    return [entry.id, entry] as const
                  })
                )
                for (const item of clampedItems) {
                  const entry = itemsById.get(item.id)
                  if (entry) {
                    entry.x = item.x
                    entry.y = item.y
                  }
                }
              })
              for (const item of clampedItems) {
                scheduleUpdate(item.id, { x: item.x, y: item.y })
              }
            }

            // 有内容则自动恢复显示
            if (clampedItems.length > 0) {
              await getter().toShow()
            }
          } catch (e) {
            reportCaught('overlay.toInitialize', e, 'warning')
          }
        }
      }
    }),
    { name: 'overlay-store' }
  )
)

export type { OverlayMode, OverlayTexture, OverlayTile, OverlayItem, OverlayPatch, OverlayRow }
export { useOverlayStore }
