import { useCallback } from 'react'

import { useDockStore } from '@/features/agent/dock'
import { useSpacesStore } from '@/stores/spaces'
import { openSpaceDoc } from '@/views/knowledge/lib/open-space-doc.ts'

function useDocsTab() {
  const spaces = useSpacesStore(function (state) {
    return state.spaces
  })
  const activeSpaceID = useSpacesStore(function (state) {
    return state.activeSpaceID
  })
  const docs = useSpacesStore(function (state) {
    return state.docs
  })
  const hits = useSpacesStore(function (state) {
    return state.hits
  })
  const query = useSpacesStore(function (state) {
    return state.query
  })
  const isLoading = useSpacesStore(function (state) {
    return state.isLoading
  })
  const error = useSpacesStore(function (state) {
    return state.error
  })
  const writeQuery = useSpacesStore(function (state) {
    return state.writeQuery
  })
  const selectSpace = useSpacesStore(function (state) {
    return state.selectSpace
  })
  const runSearch = useSpacesStore(function (state) {
    return state.runSearch
  })
  const clearSearch = useSpacesStore(function (state) {
    return state.clearSearch
  })
  const rescan = useSpacesStore(function (state) {
    return state.rescan
  })
  const exportBundle = useSpacesStore(function (state) {
    return state.exportBundle
  })

  const activeSpace = spaces.find(function (space) {
    return space.id === activeSpaceID
  })

  /** 引用保持稳定：列表用 memo 包裹，回调一变就白 memo 了 */
  const openDoc = useCallback(function (relative: string) {
    openSpaceDoc(relative)
  }, [])

  const openNewDocDock = useCallback(function () {
    useDockStore.getState().toOpen('new-doc')
  }, [])

  return {
    spaces,
    activeSpaceID,
    docs,
    hits,
    query,
    isLoading,
    error,
    selectSpace,
    writeQuery,
    runSearch,
    clearSearch,
    rescan,
    exportBundle,
    activeSpace,
    openDoc,
    openNewDocDock
  }
}

export { useDocsTab }
