import { Button } from '@cogito/design/components/button'
import { clsx } from 'clsx'

import { pinSite } from '@/features/mirror/pin-site.ts'
import { Notice } from '@/features/shell/notice.tsx'
import Bookmarks from '@/views/bookmarks/bookmarks.tsx'

/** 侧栏：当前页固定 + 浏览器书签 */
export default function Side() {
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
      <Bookmarks />
      <Notice />
    </div>
  )
}
