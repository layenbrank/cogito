/**
 * 编辑器内的链接点击路由。
 *
 * - `[[页面]]`：按标题在当前空间找页并打开；不存在时给带「创建该页」动作的提示，
 *   创建复用 Page Links 面板那套 `insertMissingWikiPage`（写 `wiki/<slug>.md` + frontmatter），
 *   保证「点断链建页」与「侧栏断链一键建页」结果一致。
 * - 普通外链：`Link` 扩展是 `openOnClick: false`，以前点了没任何反应，现在交给系统浏览器。
 *   只放行 http/https/mailto —— 其他 scheme（`file:` / 自定义协议）不代用户打开。
 */
import { openUrl } from '@tauri-apps/plugin-opener'
import { toast } from 'sonner'

import { canUseTauriIpc } from '@/features/window/shell-mode'
import { useSpacesStore } from '@/stores/spaces'
import { findSpaceDocByTitle, openSpaceDoc } from '@/views/knowledge/lib/open-space-doc.ts'
import { insertMissingWikiPage } from '@/views/knowledge/lib/page-links.ts'

function findActiveRootPath(): string | null {
  const state = useSpacesStore.getState()
  const space = state.spaces.find(function (item) {
    return item.id === state.activeSpaceID
  })
  return space?.rootPath ?? null
}

/** 建页后重扫并打开；失败只告警，不递归重试 */
async function createWikiPage(title: string): Promise<void> {
  const rootPath = findActiveRootPath()
  if (!rootPath) return
  try {
    const relative = await insertMissingWikiPage({ rootPath, title })
    await useSpacesStore.getState().rescan()
    if (!openSpaceDoc(relative)) {
      toast.error('页面已创建，但没能打开', { description: relative })
    }
  } catch (error) {
    console.error('[wikilink] create page failed', error)
    toast.error('创建页面失败', {
      description: error instanceof Error ? error.message : String(error)
    })
  }
}

function openWikiLink(rawTitle: string): void {
  const title = rawTitle.trim()
  if (!title) return
  const hit = findSpaceDocByTitle(title)
  if (hit) {
    openSpaceDoc(hit.relPath)
    return
  }
  toast.warning(`页面不存在：${title}`, {
    description: '可以直接建一个骨架页，或让助手起草后到「待发布区」确认。',
    action: {
      label: '创建该页',
      onClick: function () {
        void createWikiPage(title)
      }
    }
  })
}

/** 只认能交给系统浏览器的 scheme；相对路径/锚点不在此列 */
function isExternalHref(href: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(href.trim())
}

async function openExternalLink(href: string): Promise<void> {
  const target = href.trim()
  if (!isExternalHref(target)) return
  if (!canUseTauriIpc()) {
    window.open(target, '_blank', 'noopener,noreferrer')
    return
  }
  try {
    await openUrl(target)
  } catch (error) {
    console.error('[knowledge] open external link failed', error)
    toast.error('打不开这个链接', { description: target })
  }
}

export { isExternalHref, openExternalLink, openWikiLink }
