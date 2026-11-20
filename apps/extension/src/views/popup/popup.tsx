import { Button } from '@cogito/design/components/button'
import { clsx } from 'clsx'
import { useEffect } from 'react'

import { ClipAction } from '@/features/clip-bridge/clip-action.tsx'
import { pinSite } from '@/features/mirror/pin-site.ts'
import { useMirrorStore } from '@/features/mirror/store.ts'
import { Notice } from '@/features/shell/notice.tsx'
import { openSite } from '@/features/shell/open-site.ts'

function openSideSurface(): void {
  const windowId = chrome.windows.WINDOW_ID_CURRENT
  void chrome.sidePanel.open({ windowId }).catch(function (error: unknown) {
    console.error('[side] 打开失败', error)
  })
}

/** 工具栏弹窗：固定当前页、打开书签侧栏、打开墙上的链接 */
export default function Popup() {
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
    <div className={clsx('flex w-80 flex-col gap-3 bg-background p-3 text-foreground')}>
      <header className={clsx('text-sm font-semibold')}>Cogito</header>
      <Button
        type="button"
        onClick={function () {
          void chrome.tabs.query({ active: true, currentWindow: true }).then(function ([tab]) {
            return pinSite(tab?.url, tab?.title ?? '')
          })
        }}>
        固定当前标签
      </Button>
      <Button
        type="button"
        variant="secondary"
        onClick={openSideSurface}>
        打开书签侧栏
      </Button>
      <ul className={clsx('flex max-h-64 flex-col gap-1 overflow-y-auto overscroll-y-contain')}>
        {links.length === 0 ? (
          <li className={clsx('px-2 py-1 text-sm text-muted-foreground')}>墙上还没有链接</li>
        ) : null}
        {links.slice(0, 8).map(function (tile) {
          return (
            <li key={tile.id}>
              <button
                type="button"
                className={clsx('block w-full truncate rounded-md px-2 py-1 text-left text-sm hover:bg-muted')}
                onClick={function () {
                  if (tile.url) openSite(tile.url, 'tab')
                }}>
                {tile.title}
              </button>
            </li>
          )
        })}
      </ul>
      <Notice />
      <ClipAction />
    </div>
  )
}
