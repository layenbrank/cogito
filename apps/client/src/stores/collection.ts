import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

import { invalidateCollectionMarkerPreviews } from '@/features/magnetic-tiles/collection/preview-cache'

interface OriginRect {
  x: number
  y: number
  width: number
  height: number
}

interface CollectionSlice {
  openId: string | null
  originRect: OriginRect | null
  /** 成员变更后递增，供文件夹 Marker 刷新预览 */
  revision: number
  toOpen(params: { id: string; rect: OriginRect }): void
  toClose: () => void
  toBumpRevision: () => void
}

function parseOriginRect(rect: DOMRect | OriginRect): OriginRect {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height
  }
}

const useCollectionStore = create<CollectionSlice>()(
  devtools(
    immer(function (setters) {
      return {
        openId: null,
        originRect: null,
        revision: 0,

        toOpen(params) {
          setters(
            function (state) {
              state.openId = params.id
              state.originRect = parseOriginRect(params.rect)
            },
            false,
            'toOpen'
          )
        },

        toClose() {
          setters(
            function (state) {
              state.openId = null
              state.originRect = null
            },
            false,
            'toClose'
          )
        },

        toBumpRevision() {
          setters(
            function (state) {
              state.revision += 1
            },
            false,
            'toBumpRevision'
          )
          invalidateCollectionMarkerPreviews()
        }
      }
    }),
    { name: 'collection' }
  )
)

export { parseOriginRect, useCollectionStore }
export type { CollectionSlice, OriginRect }
