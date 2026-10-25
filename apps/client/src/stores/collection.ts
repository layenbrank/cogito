import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

import { invalidateCollectionMarkerPreviews } from '@/features/magnetic-tiles/collection/preview-cache'

interface CollectionSlice {
  /** 成员变更后递增，供文件夹 Marker 刷新预览 */
  revision: number
  toBumpRevision: () => void
}

const useCollectionStore = create<CollectionSlice>()(
  devtools(
    immer(function (setters) {
      return {
        revision: 0,

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

export { useCollectionStore }
export type { CollectionSlice }
