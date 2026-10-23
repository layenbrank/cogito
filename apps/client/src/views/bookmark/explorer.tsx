import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Checkbox } from '@cogito/design/components/checkbox'
import { Input } from '@cogito/design/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { ToggleGroup, ToggleGroupItem } from '@cogito/design/components/toggle-group'
import { cn } from 'cn'
import { useMemo, useState } from 'react'

import styles from '@/views/bookmark/bookmark.module.scss'
import {
  countFolderLinks,
  findChildrenAtPath,
  isFolderSelected,
  joinPath
} from '@/views/bookmark/import/tree'
import type { BookmarkNode } from '@/views/bookmark/import/types'
import {
  SORT_OPTIONS,
  type BookmarkSortKey,
  type BookmarkViewMode
} from '@/views/bookmark/view-prefs'

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

type Row =
  | { kind: 'folder'; path: string; id: string; title: string; count: number; index: number }
  | { kind: 'link'; path: string; id: string; title: string; url: string; index: number }

function compareRows(a: Row, b: Row, sortKey: BookmarkSortKey) {
  if (sortKey === 'type') {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    return a.title.localeCompare(b.title, 'zh')
  }
  if (sortKey === 'name-asc') return a.title.localeCompare(b.title, 'zh')
  if (sortKey === 'name-desc') return b.title.localeCompare(a.title, 'zh')
  if (sortKey === 'links') {
    const ac = a.kind === 'folder' ? a.count : 0
    const bc = b.kind === 'folder' ? b.count : 0
    if (ac !== bc) return bc - ac
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    return a.title.localeCompare(b.title, 'zh')
  }
  if (a.index !== b.index) return a.index - b.index
  return a.title.localeCompare(b.title, 'zh')
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
      const list: Row[] = []
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
        return compareRows(a, b, props.sortKey)
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

  function isRowChecked(row: Row) {
    if (selectionMode === 'node-id') return selectedIds.has(row.id)
    if (row.kind === 'folder') return isFolderSelected(row.path, selectedPaths)
    return false
  }

  function canCheckRow(row: Row) {
    return selectionMode === 'node-id' || row.kind === 'folder'
  }

  function onToggleRow(row: Row, on: boolean) {
    if (selectionMode === 'node-id') {
      toggleNodeId(row.id, on)
    } else {
      toggleFolderPath(row.path, on)
    }
  }

  return (
    <div className={styles.explorer}>
      <aside className={styles.aside}>
        <p className={styles.asideTitle}>位置</p>
        <nav className={styles.asideNav}>
          <button
            type="button"
            className={cn(styles.asideItem, !cwd && styles.asideItemActive)}
            onClick={function () {
              setCwd('')
              setQuery('')
            }}>
            <Icon
              icon="lucide:house"
              className="size-4 shrink-0"
            />
            <span className="truncate">全部</span>
          </button>
          {sidebarRoots.map(function (root) {
            const path = root.title
            const active = cwd === path || cwd.startsWith(`${path}/`)
            return (
              <button
                key={root.id}
                type="button"
                className={cn(styles.asideItem, active && styles.asideItemActive)}
                onClick={function () {
                  openFolder(path)
                }}>
                <Icon
                  icon="lucide:folder"
                  className="size-4 shrink-0 text-amber-500"
                />
                <span className="truncate">{root.title}</span>
              </button>
            )
          })}
        </nav>
      </aside>

      <div className={styles.main}>
        <header className={styles.commandBar}>
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="返回上一级"
              className="size-7 rounded-md"
              disabled={!cwd}
              onClick={function () {
                const parts = cwd.split('/').filter(Boolean)
                parts.pop()
                setCwd(parts.join('/'))
              }}>
              <Icon icon="lucide:arrow-left" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="回到根目录"
              title="回到根目录"
              className="size-7 rounded-md"
              onClick={function () {
                setCwd('')
                setQuery('')
              }}>
              <Icon icon="lucide:refresh-cw" />
            </Button>
          </div>

          <div className={styles.crumb}>
            <Icon
              icon="lucide:folder"
              className="size-3.5 shrink-0 text-amber-500"
            />
            <button
              type="button"
              className="shrink-0 text-muted-foreground hover:text-foreground"
              onClick={function () {
                goCrumb(-1)
              }}>
              书签
            </button>
            {crumbs.map(function (segment, index) {
              return (
                <span
                  key={`${segment}-${index}`}
                  className="flex min-w-0 items-center gap-1">
                  <Icon
                    icon="lucide:chevron-right"
                    className="size-3.5 shrink-0 text-muted-foreground/70"
                  />
                  <button
                    type="button"
                    className={cn(
                      'truncate',
                      index === crumbs.length - 1
                        ? 'font-medium text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                    onClick={function () {
                      goCrumb(index)
                    }}>
                    {segment}
                  </button>
                </span>
              )
            })}
          </div>

          <div className={styles.viewTools}>
            <Select
              items={[...SORT_OPTIONS]}
              value={props.sortKey}
              onValueChange={function (value) {
                if (
                  value === 'type' ||
                  value === 'name-asc' ||
                  value === 'name-desc' ||
                  value === 'links' ||
                  value === 'index'
                ) {
                  props.onUpdateSortKey(value)
                }
              }}>
              <SelectTrigger
                className={styles.sortControl}
                aria-label="排序方式">
                <SelectValue placeholder="排序" />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map(function (item) {
                  return (
                    <SelectItem
                      key={item.value}
                      value={item.value}>
                      {item.label}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>

            <ToggleGroup
              spacing={0}
              value={[props.viewMode]}
              onValueChange={function (value) {
                const next = value[0]
                if (next === 'list' || next === 'grid') props.onUpdateViewMode(next)
              }}
              className={styles.viewToggle}>
              <ToggleGroupItem
                value="list"
                aria-label="列表视图"
                className={styles.viewToggleItem}>
                <Icon icon="lucide:list" />
              </ToggleGroupItem>
              <ToggleGroupItem
                value="grid"
                aria-label="网格视图"
                className={styles.viewToggleItem}>
                <Icon icon="lucide:layout-grid" />
              </ToggleGroupItem>
            </ToggleGroup>

            <div className={styles.search}>
              <Icon
                icon="lucide:search"
                className={styles.searchIcon}
              />
              <Input
                value={query}
                placeholder="搜索"
                aria-label="搜索当前文件夹"
                className={styles.searchInput}
                onChange={function (event) {
                  setQuery(event.target.value)
                }}
              />
            </div>
          </div>
        </header>

        {props.viewMode === 'grid' ? (
          <div className={styles.gridWrap}>
            {rows.length === 0 ? (
              <p className={styles.gridEmpty}>此文件夹为空</p>
            ) : (
              <div className={styles.grid}>
                {rows.map(function (row) {
                  const checked = isRowChecked(row)
                  const canCheck = canCheckRow(row)
                  return (
                    <div
                      key={`${row.kind}:${row.id}`}
                      className={cn(styles.card, checked && styles.cardSelected)}
                      onDoubleClick={function () {
                        if (row.kind === 'folder') openFolder(row.path)
                      }}>
                      {selectable && canCheck ? (
                        <div className={styles.cardCheck}>
                          <Checkbox
                            checked={checked}
                            onCheckedChange={function (value) {
                              onToggleRow(row, value === true)
                            }}
                          />
                        </div>
                      ) : null}
                      <button
                        type="button"
                        className={styles.cardBody}
                        onClick={function () {
                          if (row.kind === 'folder') openFolder(row.path)
                        }}>
                        <span className={styles.cardIcon}>
                          <Icon
                            icon={row.kind === 'folder' ? 'lucide:folder' : 'lucide:globe'}
                            className={cn(
                              'size-7',
                              row.kind === 'folder' ? 'text-amber-500' : 'text-sky-500'
                            )}
                          />
                        </span>
                        <span className={styles.cardTitle}>{row.title}</span>
                        <span className={styles.cardMeta}>
                          {row.kind === 'folder' ? `${row.count} 个链接` : row.url}
                        </span>
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead className={styles.thead}>
                <tr>
                  {selectable ? <th className={cn(styles.th, styles.thCheck)} /> : null}
                  <th className={cn(styles.th, styles.thName)}>名称</th>
                  <th className={cn(styles.th, styles.thType)}>类型</th>
                  <th className={styles.th}>详情</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={selectable ? 4 : 3}
                      className={cn(styles.td, 'py-16 text-center text-muted-foreground')}>
                      此文件夹为空
                    </td>
                  </tr>
                ) : (
                  rows.map(function (row) {
                    const checked = isRowChecked(row)
                    const canCheck = canCheckRow(row)
                    return (
                      <tr
                        key={`${row.kind}:${row.id}`}
                        className={styles.tr}
                        onDoubleClick={function () {
                          if (row.kind === 'folder') openFolder(row.path)
                        }}>
                        {selectable ? (
                          <td className={styles.td}>
                            {canCheck ? (
                              <Checkbox
                                checked={checked}
                                onCheckedChange={function (value) {
                                  onToggleRow(row, value === true)
                                }}
                              />
                            ) : (
                              <span className="block size-4" />
                            )}
                          </td>
                        ) : null}
                        <td className={styles.td}>
                          <button
                            type="button"
                            className={styles.nameBtn}
                            onClick={function () {
                              if (row.kind === 'folder') openFolder(row.path)
                            }}>
                            <Icon
                              icon={row.kind === 'folder' ? 'lucide:folder' : 'lucide:globe'}
                              className={cn(
                                'size-4 shrink-0',
                                row.kind === 'folder' ? 'text-amber-500' : 'text-sky-500'
                              )}
                            />
                            <span className="truncate font-medium">{row.title}</span>
                          </button>
                        </td>
                        <td className={cn(styles.td, 'text-muted-foreground')}>
                          {row.kind === 'folder' ? '文件夹' : '网址'}
                        </td>
                        <td className={cn(styles.td, 'truncate text-muted-foreground')}>
                          {row.kind === 'folder' ? `${row.count} 个链接` : row.url}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
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
