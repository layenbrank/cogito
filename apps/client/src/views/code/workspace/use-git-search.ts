import type { KeyboardEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import type { SearchField } from '@/lib/workspace-git'
import { useCodeGitStore } from '@/stores/code-git'
import { useCodeStore } from '@/stores/code'
import { joinPath } from '@/views/code/lib/path.ts'

function useGitSearch() {
  const workspaceRoot = useCodeStore(function (state) {
    return state.workspaceRoot
  })
  const isRepo = useCodeGitStore(function (state) {
    return state.isRepo
  })
  const searchQuery = useCodeGitStore(function (state) {
    return state.searchQuery
  })
  const searchField = useCodeGitStore(function (state) {
    return state.searchField
  })
  const searchHits = useCodeGitStore(function (state) {
    return state.searchHits
  })
  const searchHasMore = useCodeGitStore(function (state) {
    return state.searchHasMore
  })
  const searchHitScanCap = useCodeGitStore(function (state) {
    return state.searchHitScanCap
  })
  const isSearchLoading = useCodeGitStore(function (state) {
    return state.isSearchLoading
  })
  const searchError = useCodeGitStore(function (state) {
    return state.searchError
  })
  const selectedOid = useCodeGitStore(function (state) {
    return state.selectedOid
  })
  const commitFiles = useCodeGitStore(function (state) {
    return state.commitFiles
  })
  const isShowLoading = useCodeGitStore(function (state) {
    return state.isShowLoading
  })
  const showError = useCodeGitStore(function (state) {
    return state.showError
  })
  const recentHits = useCodeGitStore(function (state) {
    return state.recentHits
  })

  const [draft, updateDraft] = useState(searchQuery)
  const [fileFilter, updateFileFilter] = useState('')
  const [activeFilePath, updateActiveFilePath] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const didBootstrap = useRef(false)
  const listRef = useRef<HTMLDivElement | null>(null)

  const selectedHit = useMemo(
    function () {
      return (
        searchHits.find(function (hit) {
          return hit.oid === selectedOid
        }) ??
        recentHits.find(function (hit) {
          return hit.oid === selectedOid
        })
      )
    },
    [searchHits, recentHits, selectedOid]
  )

  const filteredFiles = useMemo(
    function () {
      const needle = fileFilter.trim().toLowerCase()
      if (!needle) return commitFiles
      return commitFiles.filter(function (file) {
        return file.path.toLowerCase().includes(needle)
      })
    },
    [commitFiles, fileFilter]
  )

  useEffect(
    function () {
      if (!isRepo || didBootstrap.current) return
      didBootstrap.current = true
      void useCodeGitStore.getState().toSearchCommits()
    },
    [isRepo]
  )

  useEffect(
    function () {
      updateDraft(searchQuery)
    },
    [searchQuery]
  )

  useEffect(
    function () {
      updateFileFilter('')
      updateActiveFilePath(null)
    },
    [selectedOid]
  )

  useEffect(
    function () {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(function () {
        const store = useCodeGitStore.getState()
        if (store.searchQuery === draft) return
        store.toSetSearchQuery(draft)
        void store.toSearchCommits()
      }, 280)
      return function () {
        if (debounceRef.current) clearTimeout(debounceRef.current)
      }
    },
    [draft]
  )

  function runSearchNow(nextDraft = draft) {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const store = useCodeGitStore.getState()
    store.toSetSearchQuery(nextDraft)
    void store.toSearchCommits()
  }

  function onField(field: SearchField) {
    useCodeGitStore.getState().toSetSearchField(field)
    runSearchNow()
  }

  function onSelect(oid: string) {
    void useCodeGitStore.getState().toSelectCommit(oid)
  }

  function onOpenFile(relative: string) {
    if (!workspaceRoot || !selectedOid) return
    updateActiveFilePath(relative)
    const parentOid = selectedHit?.parentOid ?? null
    useCodeStore.getState().toOpenDiffTab({
      path: joinPath(workspaceRoot, relative),
      baseOid: parentOid ?? '',
      headOid: selectedOid,
      titleHint: selectedOid.slice(0, 7)
    })
  }

  function onCopySha(oid: string) {
    void navigator.clipboard.writeText(oid).then(
      function () {
        toast.success('已复制 SHA')
      },
      function (error) {
        console.error('[code] copy sha failed', error)
        toast.error('复制失败')
      }
    )
  }

  function onCommitKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (searchHits.length === 0) return
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const index = searchHits.findIndex(function (hit) {
      return hit.oid === selectedOid
    })
    const nextIndex =
      event.key === 'ArrowDown'
        ? Math.min(searchHits.length - 1, Math.max(0, index) + 1)
        : Math.max(0, (index < 0 ? 0 : index) - 1)
    const next = searchHits[nextIndex]
    if (next) onSelect(next.oid)
  }

  const showCommitSkeleton = isSearchLoading && searchHits.length === 0
  const showFileSkeleton = isShowLoading && commitFiles.length === 0 && Boolean(selectedOid)

  return {
    workspaceRoot,
    isRepo,
    searchField,
    searchHits,
    searchHasMore,
    searchHitScanCap,
    isSearchLoading,
    searchError,
    selectedOid,
    commitFiles,
    isShowLoading,
    showError,
    draft,
    updateDraft,
    fileFilter,
    updateFileFilter,
    activeFilePath,
    listRef,
    selectedHit,
    filteredFiles,
    runSearchNow,
    onField,
    onSelect,
    onOpenFile,
    onCopySha,
    onCommitKeyDown,
    showCommitSkeleton,
    showFileSkeleton
  }
}

export { useGitSearch }
