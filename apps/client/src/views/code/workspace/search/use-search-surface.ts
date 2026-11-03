import { WorkspaceFiles, type ContentHit } from '@/lib/workspace-files'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { useCodeStore } from '@/stores/code'
import { revealLocation } from '@/views/code/lib/open-file.ts'
import { isValidQuery, type SearchQuery } from '@/views/code/lib/search-query.ts'
import { replaceInFiles } from '@/views/code/lib/search.ts'
import { groupHits } from '@/views/code/workspace/search/group-hits.ts'

const SEARCH_DELAY_MS = 300

function useSearchSurface() {
  const roots = useCodeStore(function (state) {
    return state.roots
  })
  const [query, updateQuery] = useState('')
  const [isCaseSensitive, setCaseSensitive] = useState(false)
  const [isWholeWord, setWholeWord] = useState(false)
  const [isRegex, setRegex] = useState(false)
  const [replacement, updateReplacement] = useState('')
  const [isPreserveCase, setPreserveCase] = useState(false)
  const [includes, updateIncludes] = useState('')
  const [excludes, updateExcludes] = useState('')
  const [hits, updateHits] = useState<ContentHit[]>([])
  const [isTruncated, setTruncated] = useState(false)
  const [isSearching, setSearching] = useState(false)
  const [isConfirmOpen, setConfirmOpen] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)
  const [collapseToken, setCollapseToken] = useState(0)

  const searchQuery: SearchQuery = useMemo(
    function () {
      return { query, isRegex, isCaseSensitive, isWholeWord }
    },
    [query, isRegex, isCaseSensitive, isWholeWord]
  )
  const isQueryValid = isValidQuery(searchQuery)
  const trimmed = query.trim()
  const isActive = Boolean(trimmed) && isQueryValid
  const groups = useMemo(
    function () {
      return groupHits(isActive ? hits : [])
    },
    [hits, isActive]
  )

  const rootsKey = roots.join('|')

  useEffect(
    function () {
      if (roots.length === 0 || !trimmed || !isQueryValid) return
      let cancelled = false
      const timer = window.setTimeout(function () {
        setSearching(true)
        void Promise.all(
          roots.map(function (root) {
            return WorkspaceFiles.content({
              root,
              query: trimmed,
              isRegex,
              isCaseSensitive,
              isWholeWord,
              includes,
              excludes
            })
          })
        )
          .then(function (results) {
            if (cancelled) return
            updateHits(
              results.flatMap(function (result) {
                return result.hits
              })
            )
            setTruncated(
              results.some(function (result) {
                return result.isTruncated
              })
            )
          })
          .catch(function (error: unknown) {
            if (cancelled) return
            updateHits([])
            setTruncated(false)
            toast.error(error instanceof Error ? error.message : '搜索失败')
          })
          .finally(function () {
            if (!cancelled) setSearching(false)
          })
      }, SEARCH_DELAY_MS)
      return function () {
        cancelled = true
        window.clearTimeout(timer)
      }
    },
    [
      roots,
      rootsKey,
      trimmed,
      isRegex,
      isCaseSensitive,
      isWholeWord,
      isQueryValid,
      refreshToken,
      includes,
      excludes
    ]
  )

  function onOpenHit(hit: ContentHit) {
    void revealLocation(hit.path, hit.line, hit.column)
  }

  function onClear() {
    updateQuery('')
    updateReplacement('')
    updateHits([])
    setTruncated(false)
  }

  function onRefresh() {
    setRefreshToken(function (value) {
      return value + 1
    })
  }

  function onCollapseAll() {
    setCollapseToken(function (value) {
      return value + 1
    })
  }

  async function onConfirmReplace() {
    setConfirmOpen(false)
    try {
      const outcome = await replaceInFiles({
        paths: groups.map(function (group) {
          return group.path
        }),
        query: searchQuery,
        replacement,
        isPreserveCase
      })
      const total = outcome.changed.reduce(function (sum, item) {
        return sum + item.count
      }, 0)
      if (outcome.failed.length > 0) {
        toast.error(`${outcome.failed.length} 个文件替换失败，${total} 处已替换`)
      } else if (total > 0) {
        toast.success(`已在 ${outcome.changed.length} 个文件中替换 ${total} 处`)
      } else {
        toast.message('没有可替换的内容')
      }
      useCodeStore.getState().toBumpTree()
      onRefresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '替换失败')
    }
  }

  const totalMatches = isActive ? hits.length : 0
  const canReplace = totalMatches > 0

  return {
    roots,
    query,
    updateQuery,
    isCaseSensitive,
    setCaseSensitive,
    isWholeWord,
    setWholeWord,
    isRegex,
    setRegex,
    replacement,
    updateReplacement,
    isPreserveCase,
    setPreserveCase,
    includes,
    updateIncludes,
    excludes,
    updateExcludes,
    hits,
    isTruncated,
    isSearching,
    isConfirmOpen,
    setConfirmOpen,
    collapseToken,
    searchQuery,
    isQueryValid,
    trimmed,
    isActive,
    groups,
    onOpenHit,
    onClear,
    onRefresh,
    onCollapseAll,
    onConfirmReplace,
    totalMatches,
    canReplace
  }
}

export { useSearchSurface }
