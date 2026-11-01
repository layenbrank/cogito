/**
 * 导入向导用的精简文件夹树：只勾选文件夹，不复刻完整资源管理器。
 */
import { Icon } from '@iconify/react/offline'
import { Checkbox } from '@cogito/design/components/checkbox'
import { cn } from 'cn'
import { useState, type MouseEvent } from 'react'

import styles from '@/views/bookmark/bookmark.module.scss'
import {
  countFolderLinks,
  isFolderSelected,
  joinPath
} from '@/views/bookmark/import/tree'
import type { BookmarkNode } from '@/views/bookmark/import/types'

interface ImportFolderTreeProps {
  roots: BookmarkNode[]
  selectedFolders: string[]
  onUpdateSelectedFolders: (paths: string[]) => void
}

interface FolderRowProps {
  node: BookmarkNode
  path: string
  depth: number
  roots: BookmarkNode[]
  selected: Set<string>
  onToggle: (path: string, checked: boolean) => void
}

function toggleFolderPath(
  roots: BookmarkNode[],
  selectedFolders: string[],
  path: string,
  checked: boolean
) {
  const next = new Set(selectedFolders)
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
      if (!path.startsWith(`${existing}/`)) continue
      next.delete(existing)
      const parent = existing
      const siblings = (function () {
        if (!parent) return roots
        const segments = parent.split('/').filter(Boolean)
        let nodes = roots
        for (const segment of segments) {
          const folder = nodes.find(function (item) {
            return !item.url && item.title === segment
          })
          if (!folder) return [] as BookmarkNode[]
          nodes = folder.children ?? []
        }
        return nodes
      })().filter(function (item) {
        return !item.url
      })
      for (const sibling of siblings) {
        const siblingPath = joinPath(parent, sibling.title)
        if (siblingPath === path || path.startsWith(`${siblingPath}/`)) continue
        next.add(siblingPath)
      }
    }
  }
  return [...next]
}

function FolderRow(props: FolderRowProps) {
  const childFolders = (props.node.children ?? []).filter(function (child) {
    return !child.url
  })
  const [isOpen, setOpen] = useState(props.depth < 1)
  const checked = isFolderSelected(props.path, props.selected)
  const linkCount = countFolderLinks(props.roots, props.path)

  function onToggleTwist(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation()
    setOpen(function (prior) {
      return !prior
    })
  }

  return (
    <div className={styles.importTreeBranch}>
      <div
        role="treeitem"
        aria-selected={checked}
        data-checked={checked ? 'true' : undefined}
        className={styles.importTreeRow}
        style={{ paddingLeft: `${0.65 + props.depth * 1.15}rem` }}
        onClick={function () {
          props.onToggle(props.path, !checked)
        }}>
        <button
          type="button"
          className={styles.importTreeTwist}
          aria-label={isOpen ? '折叠' : '展开'}
          disabled={childFolders.length === 0}
          onClick={onToggleTwist}>
          {childFolders.length ? (
            <Icon
              icon={isOpen ? 'lucide:chevron-down' : 'lucide:chevron-right'}
              className="size-3.5"
              aria-hidden
            />
          ) : (
            <span className="size-3.5" />
          )}
        </button>
        <Checkbox
          checked={checked}
          onClick={function (event) {
            event.stopPropagation()
          }}
          onCheckedChange={function (value) {
            props.onToggle(props.path, value === true)
          }}
        />
        <Icon
          icon="lucide:folder"
          className="size-4 shrink-0 text-amber-500/90"
          aria-hidden
        />
        <span className={styles.importTreeTitle}>{props.node.title}</span>
        <span className={styles.importTreeMeta}>{linkCount}</span>
      </div>
      {isOpen
        ? childFolders.map(function (child) {
            const childPath = joinPath(props.path, child.title)
            return (
              <FolderRow
                key={childPath}
                node={child}
                path={childPath}
                depth={props.depth + 1}
                roots={props.roots}
                selected={props.selected}
                onToggle={props.onToggle}
              />
            )
          })
        : null}
    </div>
  )
}

function ImportFolderTree(props: ImportFolderTreeProps) {
  const selected = new Set(props.selectedFolders)
  const folders = props.roots.filter(function (node) {
    return !node.url
  })

  if (!folders.length) {
    return (
      <div className={cn(styles.importTree, styles.importTreeEmpty)}>
        没有可导入的文件夹
      </div>
    )
  }

  return (
    <div
      className={styles.importTree}
      role="tree"
      aria-label="选择要导入的文件夹">
      {folders.map(function (folder) {
        return (
          <FolderRow
            key={folder.title}
            node={folder}
            path={folder.title}
            depth={0}
            roots={props.roots}
            selected={selected}
            onToggle={function (path, checked) {
              props.onUpdateSelectedFolders(
                toggleFolderPath(props.roots, props.selectedFolders, path, checked)
              )
            }}
          />
        )
      })}
    </div>
  )
}

export { ImportFolderTree }
