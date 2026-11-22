import { create } from 'zustand'

import { invalidateCollectionMarkerPreviews } from '@/features/magnetic-tiles/collection/preview-cache'

interface CollectionSlice {
  revision: number
  toBumpRevision: () => void
}

const useCollectionStore = create<CollectionSlice>(function (set) {
  return {
    revision: 0,
    toBumpRevision() {
      set(function (state) {
        return { revision: state.revision + 1 }
      })
      invalidateCollectionMarkerPreviews()
    }
  }
})

export { useCollectionStore }
