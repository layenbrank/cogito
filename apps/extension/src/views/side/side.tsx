import { Button } from '@cogito/design/components/button'
import { clsx } from 'clsx'
import { useEffect } from 'react'

import { pinSite } from '@/features/mirror/pin-site.ts'
import { useMirrorStore } from '@/features/mirror/store.ts'
import { Notice } from '@/features/shell/notice.tsx'
import { openSite } from '@/features/shell/open-site.ts'
import Bookmarks from '@/views/bookmarks/bookmarks.tsx'

/**
 * 侧栏：当前页固定 + 墙上的链接 + 浏览器书签。
 *
 * 工具栏弹窗现在归剪藏（`apps/clipper` 的 `popup.html`），原先弹窗里的「墙上的链接」
 * 一并并到这里 —— 侧栏才是看墙的地方，弹窗只做一次剪藏。
 */
export default function Side() {
  const tiles = useMirrorStore(function (state) {
    return state.tiles
  })
  const initialize = useMirrorStore(function (state) {
    return state.initialize
  })

  useEffect(
    function () {
      initialize()
    },
    [initialize]
  )

  const links = tiles.filter(function (tile) {
    return Boolean(tile.url)
  })

  return (
    <div className={clsx('flex h-full min-h-0 flex-col gap-3 bg-background p-3 text-foreground')}>
      <header className={clsx('flex items-center justify-between gap-2')}>
        <span className={clsx('text-sm font-semibold')}>书签</span>
        <Button
          type="button"
          size="sm"
          onClick={function () {
            void chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(function ([tab]) {
              return pinSite(tab?.url, tab?.title ?? '')
            })
          }}>
          固定当前页
        </Button>
      </header>

      <section className={clsx('flex flex-col gap-1')}>
        <h2 className={clsx('text-xs font-medium tracking-wide text-muted-foreground')}>墙上的链接</h2>
        <ul className={clsx('flex max-h-40 flex-col gap-1 overflow-y-auto overscroll-y-contain')}>
          {links.length === 0 ? (
            <li className={clsx('px-2 py-1 text-sm text-muted-foreground')}>墙上还没有链接</li>
          ) : null}
          {links.map(function (tile) {
            return (
              <li key={tile.id}>
                <Button
                  type="button"
                  variant="ghost"
                  className={clsx(
                    'h-auto w-full justify-start truncate px-2 py-1 text-sm font-normal'
                  )}
                  onClick={function () {
                    if (tile.url) openSite(tile.url, 'tab')
                  }}>
                  {tile.title}
                </Button>
              </li>
            )
          })}
        </ul>
      </section>

      <Bookmarks />
      <Notice />
    </div>
  )
}
