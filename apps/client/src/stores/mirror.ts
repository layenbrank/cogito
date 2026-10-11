import { invoke } from '@tauri-apps/api/core'
import { isEmpty } from 'lodash-es'
import type { StateCreator } from 'zustand'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { CHANNELS } from '@/shared/ipc/channels'

type MirrorWrite = Mirror.Write
type MagneticTileWrite = MagneticTile.Write
type MirrorUpdate = Mirror.Update
type MagneticTileUpdate = MagneticTile.Update

export type { MagneticTileUpdate, MagneticTileWrite, MirrorUpdate, MirrorWrite }

type MirrorPayload = {
  mirror: Mirror
  magneticTiles: MagneticTile[]
}

interface MirrorSlice {
  mirrors: Mirror[]
  active: {
    mirror: Mirror | null
    magneticTile: MagneticTile | null
  }

  toReadMirror: (ID: string) => Promise<Mirror | null>
  /** 预取镜像与磁贴，不写 store（切换时与退场并行） */
  toFetchMirrorPayload: (ID: string) => Promise<MirrorPayload | null>
  /** 原子提交预取结果 */
  toCommitMirrorPayload: (payload: MirrorPayload) => void
  toInsertMirror: (values: MirrorWrite[]) => Promise<void>
  toUpdateMirror: (values: MirrorUpdate[]) => Promise<void>
  toRemoveMirror: (keys: string[]) => Promise<void>

  toUpdateMirrors: (mirrors: Mirror[]) => void
  toInitialize: () => Promise<void>
}

interface MagneticTileSlice {
  magneticTiles: MagneticTile[]

  toReadMagneticTile: (ID: string) => Promise<MagneticTile | null>
  toInsertMagneticTile: (values: MagneticTileWrite[]) => Promise<void>
  toUpdateMagneticTile: (values: MagneticTileUpdate[]) => Promise<void>
  toRemoveMagneticTile: (keys: string[]) => Promise<void>

  toUpdateMagneticTiles: (magneticTiles: MagneticTile[]) => void
}

/** 完整 Store 类型 */
type MirrorStore = MirrorSlice & MagneticTileSlice

/** 切片创建器类型 */
type SliceCreator<T> = StateCreator<
  MirrorStore,
  [['zustand/devtools', never], ['zustand/immer', never]],
  [],
  T
>

/** 拖拽重排：change 仅含 index 时跳过 toReadMirror */
function isIndexOnlyUpdate(values: MagneticTileUpdate[]) {
  if (!values.length) return false
  return values.every(function (item) {
    const keys = Object.keys(item.change)
    return keys.length > 0 && keys.every(function (key) {
      return key === 'index'
    })
  })
}

const mirrorSlice: SliceCreator<MirrorSlice> = function (setters, getters) {
  return {
    mirrors: [],
    active: { mirror: null, magneticTile: null },

    async toReadMirror(ID: string) {
      const mirror = getters().mirrors.find((m) => m.id === ID) ?? null
      setters(
        (state) => {
          state.active.mirror = mirror
          state.active.magneticTile = null
        },
        false,
        'toReadMirror'
      )
      if (mirror?.id) {
        const magneticTiles = await invoke<MagneticTile[]>(CHANNELS.MAGNETIC_TILE.READ, {
          params: { mirrorID: mirror.id }
        })
        getters().toUpdateMagneticTiles(
          magneticTiles.filter((a) => !a.collectionID).toSorted((a, b) => a.index - b.index)
        )
      }
      return mirror
    },

    async toFetchMirrorPayload(ID: string) {
      const mirror = getters().mirrors.find(function (item) {
        return item.id === ID
      })
      if (!mirror) return null
      const magneticTiles = await invoke<MagneticTile[]>(CHANNELS.MAGNETIC_TILE.READ, {
        params: { mirrorID: mirror.id }
      })
      return {
        mirror,
        magneticTiles: magneticTiles
          .filter(function (tile) {
            return !tile.collectionID
          })
          .toSorted(function (a, b) {
            return a.index - b.index
          })
      }
    },

    toCommitMirrorPayload(payload) {
      setters(
        function (state) {
          state.active.mirror = payload.mirror
          state.active.magneticTile = null
          state.magneticTiles = payload.magneticTiles
        },
        false,
        'toCommitMirrorPayload'
      )
    },

    async toInsertMirror(values: MirrorWrite[]) {
      const params = values.length === 1 ? values[0] : values
      await invoke(CHANNELS.MIRROR.WRITE, { params })
      const mirrors = await invoke<Mirror[]>(CHANNELS.MIRROR.READ, { params: {} })
      getters().toUpdateMirrors(mirrors.toSorted((a, b) => a.index - b.index))
    },

    async toUpdateMirror(values: MirrorUpdate[]) {
      const params = values.length === 1 ? values[0] : values
      await invoke(CHANNELS.MIRROR.UPDATE, { params })
      const mirrors = await invoke<Mirror[]>(CHANNELS.MIRROR.READ, { params: {} })
      getters().toUpdateMirrors(mirrors.toSorted((a, b) => a.index - b.index))
    },

    async toRemoveMirror(keys: string[]) {
      const params = keys.length === 1 ? keys[0] : keys
      await invoke(CHANNELS.MIRROR.REMOVE, { params })
      const mirrors = await invoke<Mirror[]>(CHANNELS.MIRROR.READ, { params: {} })
      getters().toUpdateMirrors(mirrors.toSorted((a, b) => a.index - b.index))
    },

    toUpdateMirrors(mirrors) {
      setters({ mirrors }, false, 'toUpdateMirrors')
    },

    async toInitialize() {
      const mirrors = await invoke<Mirror[]>(CHANNELS.MIRROR.READ, { params: {} })
      getters().toUpdateMirrors(
        mirrors.toSorted(function (a, b) {
          return a.index - b.index
        })
      )

      const [first] = getters().mirrors
      if (!first) return

      const activeMirror = getters().active.mirror
      await getters().toReadMirror(activeMirror?.id ?? first.id)

      const [firstApp] = getters().magneticTiles
      if (firstApp && !getters().active.magneticTile) {
        await getters().toReadMagneticTile(firstApp.id)
      }
    }
  }
}

const magneticTileSlice: SliceCreator<MagneticTileSlice> = function (setters, getters) {
  return {
    magneticTiles: [],

    async toReadMagneticTile(ID: string) {
      const magneticTiles = await invoke<MagneticTile[]>(CHANNELS.MAGNETIC_TILE.READ, {
        params: { id: ID }
      })
      const [magneticTile] = magneticTiles
      setters(
        (state) => {
          state.active.magneticTile = magneticTile ?? null
        },
        false,
        'toReadMagneticTile'
      )
      return magneticTile
    },

    async toInsertMagneticTile(values: MagneticTileWrite[]) {
      if (isEmpty(values)) return
      const params = values.length === 1 ? values[0] : values
      await invoke(CHANNELS.MAGNETIC_TILE.WRITE, { params })

      const writes = Array.isArray(params) ? params : [params]
      const writtenMirrorIDs = new Set(
        writes.map(function (write) {
          return write.mirrorID
        })
      )
      const activeMirrorID = getters().active.mirror?.id
      // 仅当写入目标包含当前 active 时刷新列表，避免切到其它镜像
      if (activeMirrorID && writtenMirrorIDs.has(activeMirrorID)) {
        await getters().toReadMirror(activeMirrorID)
      }
    },

    async toUpdateMagneticTile(values: MagneticTileUpdate[]) {
      const mirrorID = getters().active.mirror?.id
      if (!mirrorID) return
      const params = values.length === 1 ? values[0] : values
      await invoke(CHANNELS.MAGNETIC_TILE.UPDATE, { params })
      // index-only（拖拽重排）乐观序已是真相，跳过全量重读避免松手二次抖动
      if (isIndexOnlyUpdate(values)) return
      await getters().toReadMirror(mirrorID)
    },

    async toRemoveMagneticTile(keys: string[]) {
      const mirrorID = getters().active.mirror?.id
      if (!mirrorID) return
      const params = keys.length === 1 ? keys[0] : keys
      await invoke(CHANNELS.MAGNETIC_TILE.REMOVE, { params })
      await getters().toReadMirror(mirrorID)
    },

    toUpdateMagneticTiles(magneticTiles) {
      setters({ magneticTiles }, false, 'toUpdateMagneticTiles')
    }
  }
}

const useMirrorStore = create<MirrorStore>()(
  devtools(
    immer(function (...args) {
      return {
        ...mirrorSlice(...args),
        ...magneticTileSlice(...args)
      }
    }),
    {
      name: 'MirrorStore',
      enabled: import.meta.env.DEV
    }
  )
)

export { useMirrorStore }
