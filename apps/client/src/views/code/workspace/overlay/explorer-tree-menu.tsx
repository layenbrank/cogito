import { Icon } from '@iconify/react/offline'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { toast } from 'sonner'

import type { MenuItem } from '@/components/contextmenu'
import { useCodeStore } from '@/stores/code'
import { useTerminalStore } from '@/stores/terminal'
import { findFileName, findParentDir } from '@/views/code/lib/fs.ts'
import { findRelativePath } from '@/views/code/lib/path.ts'
import {
  EXPLORER_ROOT_KEY,
  findAbsoluteFromKey,
  findRelativeDirForCreate,
  type ExplorerDeleteTarget,
  type ExplorerNewTarget,
  type ExplorerRenameTarget
} from '@/views/code/workspace/overlay/explorer-tree-lib.ts'

interface ExplorerTreeMenuInput {
  workspaceRoot: string
  trigger: Element
  setNewTarget: (value: ExplorerNewTarget | null) => void
  setRenameTarget: (value: ExplorerRenameTarget | null) => void
  setPendingDelete: (value: ExplorerDeleteTarget | null) => void
}

function buildExplorerTreeMenuItems(input: ExplorerTreeMenuInput): MenuItem[] {
  const { workspaceRoot, trigger, setNewTarget, setRenameTarget, setPendingDelete } = input
  const treeKey = trigger.getAttribute('data-tree-key')
  if (!treeKey) return []
  const kind = trigger.getAttribute('data-tree-kind')
  const isDirectory = kind === 'directory' || treeKey === EXPLORER_ROOT_KEY
  const isRoot = treeKey === EXPLORER_ROOT_KEY
  const relativeDir = findRelativeDirForCreate(treeKey, isDirectory)
  const absolute = findAbsoluteFromKey(workspaceRoot, treeKey)
  const terminalCwd = isDirectory ? absolute : findParentDir(absolute)
  const relativePath =
    treeKey === EXPLORER_ROOT_KEY ? '' : findRelativePath(workspaceRoot, absolute)

  function copyText(text: string, success: string) {
    void navigator.clipboard.writeText(text).then(
      function () {
        toast.success(success)
      },
      function (error: unknown) {
        console.error('[code] clipboard write failed', error)
        toast.error('复制失败')
      }
    )
  }

  function revealInSystemExplorer() {
    void revealItemInDir(absolute).catch(function (error: unknown) {
      console.error('[code] revealItemInDir failed', absolute, error)
      toast.error(error instanceof Error ? error.message : '打开系统资源管理器失败')
    })
  }

  function openInTerminal() {
    useCodeStore.getState().toUpdateSurfaceTab('terminal')
    useTerminalStore.getState().newTab(terminalCwd)
  }

  const items: MenuItem[] = [
    {
      key: 'reveal-system',
      label: '在文件资源管理器中显示',
      shortcut: 'Shift+Alt+R',
      icon: (
        <Icon
          icon="lucide:folder-symlink"
          className="size-3.5"
        />
      ),
      onSelect: revealInSystemExplorer
    },
    {
      key: 'open-terminal',
      label: '在集成终端中打开',
      icon: (
        <Icon
          icon="lucide:terminal"
          className="size-3.5"
        />
      ),
      onSelect: openInTerminal
    },
    { key: 'divider-open', type: 'divider' },
    {
      key: 'copy-path',
      label: '复制路径',
      shortcut: 'Shift+Alt+C',
      icon: (
        <Icon
          icon="lucide:clipboard-copy"
          className="size-3.5"
        />
      ),
      onSelect() {
        copyText(absolute, '已复制路径')
      }
    },
    {
      key: 'copy-relative',
      label: '复制相对路径',
      icon: (
        <Icon
          icon="lucide:clipboard-list"
          className="size-3.5"
        />
      ),
      disabled: isRoot || !relativePath,
      onSelect() {
        copyText(relativePath, '已复制相对路径')
      }
    },
    { key: 'divider-create', type: 'divider' },
    {
      key: 'new-file',
      label: '新建文件',
      icon: (
        <Icon
          icon="lucide:file-plus-2"
          className="size-3.5"
        />
      ),
      onSelect() {
        setNewTarget({
          kind: 'file',
          relativeDir,
          name: 'untitled.txt'
        })
      }
    },
    {
      key: 'new-folder',
      label: '新建文件夹',
      icon: (
        <Icon
          icon="lucide:folder-plus"
          className="size-3.5"
        />
      ),
      onSelect() {
        setNewTarget({
          kind: 'folder',
          relativeDir,
          name: 'new-folder'
        })
      }
    }
  ]

  if (isRoot) return items

  items.push(
    { key: 'divider-edit', type: 'divider' },
    {
      key: 'rename',
      label: '重命名',
      shortcut: 'F2',
      icon: (
        <Icon
          icon="lucide:pencil"
          className="size-3.5"
        />
      ),
      onSelect() {
        setRenameTarget({
          absolute,
          name: findFileName(absolute),
          isDirectory
        })
      }
    },
    {
      key: 'delete',
      label: '删除',
      shortcut: 'Del',
      danger: true,
      icon: (
        <Icon
          icon="lucide:trash-2"
          className="size-3.5"
        />
      ),
      onSelect() {
        setPendingDelete({ absolute, isDirectory })
      }
    }
  )

  return items
}

export { buildExplorerTreeMenuItems }
