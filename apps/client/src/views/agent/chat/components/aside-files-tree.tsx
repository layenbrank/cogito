/**
 * 右栏文件树。
 *
 * 与代码窗资源管理器共用 `views/workspace/overlay` 那棵 `FileTreeItem`：同样的折叠动画、
 * 图标、缩进、加载骨架；差别只在这棵树是「浏览 + 引用」—— 点文件交给右栏预览（Monaco），
 * 不接新建 / 重命名 / 删除。
 *
 * 约定：
 * - 节点的 `key` 就是**根内相对路径**，同时写成 `data-aside-path` / `data-aside-kind`，
 *   右栏右键菜单（添加到对话 / 复制路径）据此识别目标；
 * - 目录按需读盘（展开才列），搜索走封顶的 `WorkspaceFiles.search`，命中行仍是扁平列表；
 * - 展开态、已读的目录都留在内存里，`revision` 变化只重读「根 + 已展开目录」，不重置视图。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { useCallback, useEffect, useRef, useState } from 'react'

import { WorkspaceFiles, type DirEntry } from '@/lib/workspace-files.ts'
import { useWorkspaceFilePickerEntries } from '@/views/agent/chat/components/use-workspace-file-picker-entries.ts'
import { PickerList } from '@/views/agent/chat/components/workspace-file-picker-list.tsx'
import { FileTreeItem } from '@/views/workspace/overlay/file-tree-item.tsx'
import type { FileTreeNode } from '@/views/workspace/overlay/file-tree-node.ts'
import { findFileTreeNode, patchFileTreeNode, updateFileTreeNodes } from '@/views/workspace/overlay/file-tree.ts'

interface AsideFilesTreeProps {
  rootPath: string
  /** 工作区版本号：分支切换 / 外部改动后重读已展开的目录 */
  revision: number
  /** 当前预览的文件（相对路径）：树上高亮它，并把祖先目录展开出来 */
  activeRelative: string | null
  onPick: (relative: string) => void
}

function isDirectoryEntry(entry: DirEntry): boolean {
  return entry.kind === 'dir'
}

/** 目录在前、同类按名字排：与资源管理器一致，扫一眼就知道哪里还有子目录 */
function sortEntries(entries: readonly DirEntry[]): DirEntry[] {
  return [...entries].sort(function (left, right) {
    const leftDir = isDirectoryEntry(left)
    const rightDir = isDirectoryEntry(right)
    if (leftDir !== rightDir) return leftDir ? -1 : 1
    return left.name.localeCompare(right.name, 'zh-Hans-CN', { numeric: true })
  })
}

function toNodes(entries: readonly DirEntry[]): FileTreeNode[] {
  return entries.map(function (entry) {
    const isDirectory = isDirectoryEntry(entry)
    return {
      title: entry.name,
      key: entry.relative,
      isDirectory,
      isLeaf: !isDirectory
    }
  })
}

/** 祖先目录（不含自身）：`a/b/c.ts` → [`a`, `a/b`] */
function findAncestors(relative: string): string[] {
  const parts = relative.split('/').filter(Boolean)
  const ancestors: string[] = []
  for (let index = 1; index < parts.length; index += 1) {
    ancestors.push(parts.slice(0, index).join('/'))
  }
  return ancestors
}

/** 目录深度：浅的先进队，父目录读完再读子目录 */
function countSegments(relative: string): number {
  return relative.split('/').filter(Boolean).length
}

function AsideFilesTree(props: AsideFilesTreeProps) {
  const [nodes, updateNodes] = useState<FileTreeNode[]>([])
  const [expandedKeys, updateExpandedKeys] = useState<Set<string>>(function () {
    return new Set()
  })
  const [isRootLoading, updateRootLoading] = useState(true)
  const [query, updateQuery] = useState('')

  /*
   * 回调必须保持引用稳定：`FileTreeItem` 的自定义 memo 会比较 onFetch / onSelect /
   * onExpandChange，只要它们每帧新建，任何一次 setState 都会退化成整树重渲染。
   */
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const expandedRef = useRef(expandedKeys)
  expandedRef.current = expandedKeys
  const rootRef = useRef(props.rootPath)
  rootRef.current = props.rootPath
  const rootSeenRef = useRef(props.rootPath)
  const onPickRef = useRef(props.onPick)
  onPickRef.current = props.onPick

  const isSearching = query.trim().length > 0
  const search = useWorkspaceFilePickerEntries(
    isSearching,
    props.rootPath,
    '',
    query,
    props.revision
  )

  const fetchChildren = useCallback(function (relative: string): Promise<FileTreeNode[]> {
    return WorkspaceFiles.listDir(rootRef.current, relative).then(function (rows) {
      return toNodes(sortEntries(rows))
    })
  }, [])

  const loadChildren = useCallback(
    function (relative: string): Promise<void> {
      return fetchChildren(relative)
        .then(function (children) {
          updateNodes(function (origin) {
            return updateFileTreeNodes(origin, relative, children)
          })
        })
        .catch(function (error: unknown) {
          console.warn('[agent/aside-files] 读取目录失败:', relative, error)
          updateNodes(function (origin) {
            return patchFileTreeNode(origin, relative, { isLoading: false })
          })
        })
    },
    [fetchChildren]
  )

  const handleSelect = useCallback(function (node: FileTreeNode) {
    if (node.isDirectory) return
    onPickRef.current(node.key)
  }, [])

  const handleFetch = useCallback(
    function (node: FileTreeNode): Promise<void> {
      if (node.children) return Promise.resolve()
      // 展开时先给骨架：慢盘 / 大目录下不至于看起来「点了没反应」
      updateNodes(function (origin) {
        return patchFileTreeNode(origin, node.key, { isLoading: true })
      })
      return loadChildren(node.key)
    },
    [loadChildren]
  )

  /** 只维护展开态：真正的读盘由 `FileTreeDirectoryItem` 展开时触发 */
  const handleExpandChange = useCallback(function (relative: string, open: boolean) {
    updateExpandedKeys(function (previous) {
      const next = new Set(previous)
      if (open) next.add(relative)
      else next.delete(relative)
      return next
    })
  }, [])

  const expand = useCallback(function (keys: readonly string[]) {
    if (keys.length === 0) return
    updateExpandedKeys(function (previous) {
      const isCovered = keys.every(function (key) {
        return previous.has(key)
      })
      if (isCovered) return previous
      const next = new Set(previous)
      for (const key of keys) next.add(key)
      return next
    })
  }, [])

  /** 搜索命中里的目录：清掉搜索，回到树上展开它 */
  const handleEnterDirectory = useCallback(
    function (relative: string) {
      updateQuery('')
      expand([relative])
      void loadChildren(relative)
    },
    [expand, loadChildren]
  )

  const handlePickFromSearch = useCallback(function (relative: string) {
    onPickRef.current(relative)
  }, [])

  // 根 / 版本号变化：重读「根 + 已展开目录」，展开态与当前文件都保留。
  // 换根时相对路径不再对得上，展开态清零。
  useEffect(
    function () {
      let cancelled = false
      const isRootChanged = rootSeenRef.current !== props.rootPath
      rootSeenRef.current = props.rootPath
      if (isRootChanged) {
        updateExpandedKeys(function () {
          return new Set()
        })
      }
      const reopened = isRootChanged
        ? []
        : [...expandedRef.current].sort(function (left, right) {
            return countSegments(left) - countSegments(right)
          })

      updateRootLoading(true)

      void (async function () {
        try {
          const rootNodes = await fetchChildren('')
          if (cancelled) return
          updateNodes(rootNodes)
          for (const relative of reopened) {
            if (cancelled) return
            await loadChildren(relative)
          }
        } catch (error) {
          if (cancelled) return
          console.warn('[agent/aside-files] 读取工作区根目录失败:', error)
          updateNodes([])
        } finally {
          if (!cancelled) updateRootLoading(false)
        }
      })()

      return function () {
        cancelled = true
      }
    },
    [props.rootPath, props.revision, fetchChildren, loadChildren]
  )

  // 从工具卡 / 来源打开的文件：先把祖先目录展开并读出来，否则树上根本没有这一行
  const activeRelative = props.activeRelative
  useEffect(
    function () {
      if (!activeRelative || isRootLoading) return
      const ancestors = findAncestors(activeRelative)
      if (ancestors.length === 0) return
      // 收起过的目录也要重新展开：数据可能还在内存里，但行没显示
      expand(ancestors)
      const unloaded = ancestors.filter(function (relative) {
        return !findFileTreeNode(nodesRef.current, relative)?.children
      })
      if (unloaded.length === 0) return
      let cancelled = false
      void (async function () {
        for (const relative of unloaded) {
          if (cancelled) return
          await loadChildren(relative)
        }
      })()
      return function () {
        cancelled = true
      }
    },
    [activeRelative, isRootLoading, expand, loadChildren]
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-border flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
        <Input
          data-aside-find=""
          value={query}
          placeholder="搜索当前项目文件"
          aria-label="搜索当前项目文件"
          className="h-7 text-xs"
          onChange={function (event) {
            updateQuery(event.target.value)
          }}
        />
        {isSearching ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="清空搜索"
            title="清空搜索"
            className="size-7 shrink-0"
            onClick={function () {
              updateQuery('')
            }}>
            <Icon
              icon="lucide:x"
              className="size-3.5"
            />
          </Button>
        ) : null}
      </div>

      {isSearching ? (
        <PickerList
          isPending={search.isPending}
          hasWorkspace
          isSearching
          entries={search.entries}
          listClassName="min-h-0"
          onPick={handlePickFromSearch}
          onEnterDirectory={handleEnterDirectory}
        />
      ) : isRootLoading ? (
        <p className="text-muted-foreground flex items-center gap-1.5 p-2.5 text-xs">
          <Icon
            icon="lucide:loader-circle"
            className="size-3.5 animate-spin"
          />
          读取中…
        </p>
      ) : nodes.length === 0 ? (
        <p className="text-muted-foreground p-2.5 text-xs">这个工作区里还没有文件</p>
      ) : (
        <ul className="min-h-0 flex-1 list-none overflow-x-hidden overflow-y-auto py-1 text-sm">
          {nodes.map(function (node) {
            return (
              <FileTreeItem
                key={node.key}
                node={node}
                activeKey={activeRelative}
                expandedKeys={expandedKeys}
                emptyHint="空目录"
                emitAsidePath
                onFetch={handleFetch}
                onSelect={handleSelect}
                onExpandChange={handleExpandChange}
              />
            )
          })}
        </ul>
      )}
    </div>
  )
}

export { AsideFilesTree }
