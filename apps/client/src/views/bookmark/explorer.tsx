import { useMemo, useState } from 'react'

import styles from '@/views/bookmark/bookmark.module.scss'
import { ExplorerAside } from '@/views/bookmark/explorer-aside'
import { ExplorerGrid } from '@/views/bookmark/explorer-grid'
import { ExplorerHeader } from '@/views/bookmark/explorer-header'
import { ExplorerTable } from '@/views/bookmark/explorer-table'
import { compareExplorerRows, type ExplorerRow } from '@/views/bookmark/explorer-types'
import {
  countFolderLinks,
  findChildrenAtPath,
  isFolderSelected,
  joinPath
} from '@/views/bookmark/import/tree'
import type { BookmarkNode } from '@/views/bookmark/import/types'
import type { BookmarkSortKey, BookmarkViewMode } from '@/views/bookmark/view-prefs'

type ExplorerProps = {
  roots: BookmarkNode[]
  selectedFolders: string[]
  onUpdateSelectedFolders: (paths: string[]) => void
  selectionMode?: 'folder-path' | 'node-id'
  selectedNodeIds?: string[]
  onUpdateSelectedNodeIds?: (ids: string[]) => void
  selectable?: boolean
  viewMode: BookmarkViewMode
  sortKey: BookmarkSortKey
  onUpdateViewMode: (mode: BookmarkViewMode) => void
  onUpdateSortKey: (key: BookmarkSortKey) => void
}

function BookmarkExplorer(props: ExplorerProps) {
  const selectable = props.selectable !== false
  const selectionMode = props.selectionMode ?? 'folder-path'
  const [cwd, setCwd] = useState('')
  const [query, setQuery] = useState('')

  const selectedPaths = useMemo(function () {
    return new Set(props.selectedFolders)
  }, [props.selectedFolders])

  const selectedIds = useMemo(function () {
    return new Set(props.selectedNodeIds ?? [])
  }, [props.selectedNodeIds])

  const crumbs = useMemo(
    function () {
      if (!cwd) return [] as string[]
      return cwd.split('/').filter(Boolean)
    },
    [cwd]
  )

  const rows = useMemo(
    function () {
      const children = findChildrenAtPath(props.roots, cwd)
      const list: ExplorerRow[] = []
      for (const node of children) {
        if (node.url) {
          list.push({
            kind: 'link',
            id: node.id,
            path: cwd || '未分类',
            title: node.title,
            url: node.url,
            index: node.index ?? 0
          })
        } else {
          const path = joinPath(cwd, node.title)
          list.push({
            kind: 'folder',
            id: node.id,
            path,
            title: node.title,
            count: countFolderLinks(props.roots, path),
            index: node.index ?? 0
          })
        }
      }
      list.sort(function (a, b) {
        return compareExplorerRows(a, b, props.sortKey)
      })
      const needle = query.trim().toLowerCase()
      if (!needle) return list
      return list.filter(function (row) {
        if (row.title.toLowerCase().includes(needle)) return true
        if (row.kind === 'link' && row.url.toLowerCase().includes(needle)) return true
        return false
      })
    },
    [props.roots, cwd, query, props.sortKey]
  )

  const sidebarRoots = useMemo(
    function () {
      return props.roots.filter(function (node) {
        return !node.url
      })
    },
    [props.roots]
  )

  function goCrumb(index: number) {
    if (index < 0) {
      setCwd('')
      return
    }
    setCwd(crumbs.slice(0, index + 1).join('/'))
  }

  function toggleFolderPath(path: string, checked: boolean) {
    const next = new Set(props.selectedFolders)
    if (checked) {
      next.add(path)
      for (const existing of [...next]) {
        if (existing !== path && existing.startsWith(`${path}/`)) next.delete(existing)
      }
    } else {
      next.delete(path)
      for (const existing of [...next]) {
        if (existing.startsWith(`${path}/`)) next.delete(existing)
      }
      for (const existing of [...next]) {
        if (path.startsWith(`${existing}/`)) {
          next.delete(existing)
          const parent = existing
          const siblings = findChildrenAtPath(props.roots, parent).filter(function (node) {
            return !node.url
          })
          for (const sibling of siblings) {
            const siblingPath = joinPath(parent, sibling.title)
            if (siblingPath === path || path.startsWith(`${siblingPath}/`)) continue
            next.add(siblingPath)
          }
        }
      }
    }
    props.onUpdateSelectedFolders([...next])
  }

  function toggleNodeId(id: string, checked: boolean) {
    const prev = props.selectedNodeIds ?? []
    if (checked) {
      props.onUpdateSelectedNodeIds?.([...new Set([...prev, id])])
    } else {
      props.onUpdateSelectedNodeIds?.(
        prev.filter(function (item) {
          return item !== id
        })
      )
    }
  }

  function openFolder(path: string) {
    setCwd(path)
    setQuery('')
  }

  function isRowChecked(row: ExplorerRow) {
    if (selectionMode === 'node-id') return selectedIds.has(row.id)
    if (row.kind === 'folder') return isFolderSelected(row.path, selectedPaths)
    return false
  }

  function canCheckRow(row: ExplorerRow) {
    return selectionMode === 'node-id' || row.kind === 'folder'
  }

  function onToggleRow(row: ExplorerRow, on: boolean) {
    if (selectionMode === 'node-id') {
      toggleNodeId(row.id, on)
    } else {
      toggleFolderPath(row.path, on)
    }
  }

  function goRoot() {
    setCwd('')
    setQuery('')
  }

  function goUp() {
    const parts = cwd.split('/').filter(Boolean)
    parts.pop()
    setCwd(parts.join('/'))
  }

  const rowHandlers = {
    isRowChecked,
    canCheckRow,
    onToggleRow,
    onOpenFolder: openFolder
  }

  return (
    <div className={styles.explorer}>
      <ExplorerAside
        cwd={cwd}
        sidebarRoots={sidebarRoots}
        onGoRoot={goRoot}
        onOpenFolder={openFolder}
      />

      <div className={styles.main}>
        <ExplorerHeader
          cwd={cwd}
          crumbs={crumbs}
          query={query}
          viewMode={props.viewMode}
          sortKey={props.sortKey}
          onGoCrumb={goCrumb}
          onGoUp={goUp}
          onGoRoot={goRoot}
          onUpdateQuery={setQuery}
          onUpdateViewMode={props.onUpdateViewMode}
          onUpdateSortKey={props.onUpdateSortKey}
        />

        {props.viewMode === 'grid' ? (
          <ExplorerGrid
            rows={rows}
            selectable={selectable}
            {...rowHandlers}
          />
        ) : (
          <ExplorerTable
            rows={rows}
            selectable={selectable}
            {...rowHandlers}
          />
        )}

        <footer className={styles.footer}>
          <span>{cwd || '全部'}</span>
          <span>{rows.length} 个项目</span>
        </footer>
      </div>
    </div>
  )
}

export { BookmarkExplorer }
