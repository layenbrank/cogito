import { useState } from 'react'

import { useDockStore } from '@/features/agent/dock'
import { useKnowledgeBaseStore } from '@/stores/knowledge-base'
import { useKnowledgeStore } from '@/stores/knowledge'
import { isPathInsideRoot, isSamePath, joinPath } from '@/views/knowledge/lib/path.ts'
import { openEditorPath } from '@/views/knowledge/workspace/editor-context.ts'

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
  const query = useKnowledgeBaseStore(function (state) {
    return state.query
  })
  const isLoading = useKnowledgeBaseStore(function (state) {
    return state.isLoading
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
  const exportBundle = useKnowledgeBaseStore(function (state) {
    return state.exportBundle
  })

  const [newName, setNewName] = useState('')
  const [isCreating, toSetCreating] = useState(false)

  const activeBase = bases.find(function (base) {
    return base.id === activeBaseID
  })

  function openDoc(relative: string) {
    if (!activeBase) return
    const absolute = joinPath(activeBase.rootPath, relative)
    const workspace = useKnowledgeStore.getState()
    const isInsideWorkspace =
      Boolean(workspace.rootDir) && isPathInsideRoot(workspace.rootDir!, absolute)
    if (!isInsideWorkspace && !isSamePath(workspace.rootDir, activeBase.rootPath)) {
      workspace.toSetRootDir(activeBase.rootPath, { persist: true })
      workspace.toBumpTree()
    }
    openEditorPath(absolute)
  }

  function openNewDocDock() {
    useDockStore.getState().toOpen('new-doc')
  }

  return {
    bases,
    activeBaseID,
    docs,
    hits,
    query,
    isLoading,
    error,
    selectBase,
    writeQuery,
    runSearch,
    clearSearch,
    insert,
    rescan,
    exportBundle,
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
