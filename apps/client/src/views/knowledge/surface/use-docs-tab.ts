import { useState } from 'react'

import { useDockStore } from '@/features/agent/dock'
import { useKnowledgeBaseStore } from '@/stores/knowledge-base'
import { useDictStore } from '@/stores/dict'
import { useKnowledgeStore } from '@/stores/knowledge'
import { isPathInsideRoot, isSamePath } from '@/views/knowledge/lib/path.ts'
import { openPath } from '@/views/knowledge/lib/session.ts'

function joinPath(root: string, relative: string): string {
  const base = root.replace(/[\\/]+$/, '')
  return `${base}/${relative.replace(/^[\\/]+/, '')}`
}

function useDocsTab() {
  const bases = useKnowledgeBaseStore(function (state) {
    return state.bases
  })
  const activeBaseID = useKnowledgeBaseStore(function (state) {
    return state.activeBaseID
  })
  const docs = useKnowledgeBaseStore(function (state) {
    return state.docs
  })
  const hits = useKnowledgeBaseStore(function (state) {
    return state.hits
  })
  const counts = useKnowledgeBaseStore(function (state) {
    return state.counts
  })
  const cloudState = useKnowledgeBaseStore(function (state) {
    return state.cloudState
  })
  const cloudStates = useKnowledgeBaseStore(function (state) {
    return state.cloudStates
  })
  const query = useKnowledgeBaseStore(function (state) {
    return state.query
  })
  const isLoading = useKnowledgeBaseStore(function (state) {
    return state.isLoading
  })
  const isSyncingCloud = useKnowledgeBaseStore(function (state) {
    return state.isSyncingCloud
  })
  const error = useKnowledgeBaseStore(function (state) {
    return state.error
  })
  const selectBase = useKnowledgeBaseStore(function (state) {
    return state.selectBase
  })
  const writeQuery = useKnowledgeBaseStore(function (state) {
    return state.writeQuery
  })
  const runSearch = useKnowledgeBaseStore(function (state) {
    return state.runSearch
  })
  const clearSearch = useKnowledgeBaseStore(function (state) {
    return state.clearSearch
  })
  const insert = useKnowledgeBaseStore(function (state) {
    return state.insert
  })
  const rescan = useKnowledgeBaseStore(function (state) {
    return state.rescan
  })
  const syncCloud = useKnowledgeBaseStore(function (state) {
    return state.syncCloud
  })
  const exportBundle = useKnowledgeBaseStore(function (state) {
    return state.exportBundle
  })
  const findLabel = useDictStore(function (state) {
    return state.findLabel
  })

  const [newName, setNewName] = useState('')
  const [isCreating, toSetCreating] = useState(false)

  const activeBase = bases.find(function (base) {
    return base.id === activeBaseID
  })

  async function openDoc(relative: string) {
    if (!activeBase) return
    const absolute = joinPath(activeBase.rootPath, relative)
    const workspace = useKnowledgeStore.getState()
    const isInsideWorkspace =
      Boolean(workspace.rootDir) && isPathInsideRoot(workspace.rootDir!, absolute)
    if (!isInsideWorkspace && !isSamePath(workspace.rootDir, activeBase.rootPath)) {
      workspace.toSetRootDir(activeBase.rootPath, { persist: true })
      workspace.toBumpTree()
    }
    await openPath(absolute)
  }

  function openNewDocDock() {
    useDockStore.getState().toOpen('new-doc')
  }

  return {
    bases,
    activeBaseID,
    docs,
    hits,
    counts,
    cloudState,
    cloudStates,
    query,
    isLoading,
    isSyncingCloud,
    error,
    selectBase,
    writeQuery,
    runSearch,
    clearSearch,
    insert,
    rescan,
    syncCloud,
    exportBundle,
    findLabel,
    newName,
    setNewName,
    isCreating,
    toSetCreating,
    activeBase,
    openDoc,
    openNewDocDock
  }
}

export { useDocsTab }
