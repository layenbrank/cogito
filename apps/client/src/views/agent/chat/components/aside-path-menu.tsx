/**
 * 右栏路径共用右键菜单：添加到对话、在资源管理器中打开、复制路径。
 * 文案尽量短；文件树、审阅、提交历史等 tab 复用。
 */
import { Icon } from '@iconify/react/offline'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { toast } from 'sonner'

import type { MenuItem } from '@/components/contextmenu'
import { toAgentPath } from '@/features/agent/workspace/paths.ts'
import { findBaseName } from '@/views/agent/chat/components/workspace-relative-path.ts'
import { joinPath } from '@/views/code/lib/path.ts'

const ASIDE_PATH_TRIGGER = '[data-aside-path]'

interface AsidePathAttrs {
  relative: string
  isDirectory: boolean
}

interface AsidePathMenuInput {
  rootPath: string
  /**
   * 会话 cwd（工作区的**主文件夹**）：引用路径按它折算 —— 主文件夹内给相对路径，
   * 其他文件夹给绝对路径。省略时退回 rootPath（单根工作区两者相同）。
   */
  agentRoot?: string | null
  relative: string
  /** 参数是**引用路径**（可直接交给 agent），不是根内相对路径 */
  onAddToComposer?: (reference: string) => void
}

function findAsidePathAttrs(trigger: Element): AsidePathAttrs | null {
  const relative = trigger.getAttribute('data-aside-path')
  if (relative === null || relative.length === 0) return null
  const kind = trigger.getAttribute('data-aside-kind')
  return {
    relative,
    isDirectory: kind === 'dir' || kind === 'directory'
  }
}

function copyText(text: string, success: string) {
  void navigator.clipboard.writeText(text).then(
    function () {
      toast.success(success)
    },
    function (error: unknown) {
      console.error('[agent/aside-path-menu] clipboard write failed', error)
      toast.error('复制失败')
    }
  )
}

function revealInSystemExplorer(absolute: string) {
  void revealItemInDir(absolute).catch(function (error: unknown) {
    console.error('[agent/aside-path-menu] revealItemInDir failed', absolute, error)
    toast.error(error instanceof Error ? error.message : '打开失败')
  })
}

function buildAsidePathMenuItems(input: AsidePathMenuInput): MenuItem[] {
  const absolute = joinPath(input.rootPath, input.relative)
  /** 相对路径只对这个文件夹成立；交给 agent 的必须是主文件夹口径的引用路径 */
  const reference = toAgentPath(absolute, input.agentRoot ?? input.rootPath)
  const items: MenuItem[] = []

  if (input.onAddToComposer) {
    items.push({
      key: 'add-composer',
      label: '添加到对话',
      icon: (
        <Icon
          icon="lucide:message-square-plus"
          className="size-4"
        />
      ),
      onSelect() {
        input.onAddToComposer?.(reference)
      }
    })
    items.push({ key: 'divider-composer', type: 'divider' })
  }

  items.push(
    {
      key: 'reveal-system',
      label: '在资源管理器中打开',
      shortcut: 'Shift+Alt+R',
      icon: (
        <Icon
          icon="lucide:folder-symlink"
          className="size-4"
        />
      ),
      onSelect() {
        revealInSystemExplorer(absolute)
      }
    },
    { key: 'divider-reveal', type: 'divider' },
    {
      key: 'copy-path',
      label: '复制路径',
      shortcut: 'Shift+Alt+C',
      icon: (
        <Icon
          icon="lucide:clipboard-copy"
          className="size-4"
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
          className="size-4"
        />
      ),
      onSelect() {
        copyText(input.relative, '已复制相对路径')
      }
    }
  )

  return items
}

function toastAttached(relative: string) {
  toast.success(`已引用 ${findBaseName(relative)}`)
}

export {
  ASIDE_PATH_TRIGGER,
  buildAsidePathMenuItems,
  findAsidePathAttrs,
  toastAttached
}
export type { AsidePathAttrs, AsidePathMenuInput }
