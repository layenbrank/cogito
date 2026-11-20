import { clsx } from 'clsx'
import { Suspense, useEffect } from 'react'
import { Outlet } from 'react-router-dom'

import wallpaper from '@/assets/wallpaper/r2e391.jpg'
import { useMirrorStore } from '@/features/mirror/store.ts'
import { Notice } from '@/features/shell/notice.tsx'

/** 新标签页外壳：壁纸铺满，磁贴自己承担时钟和入口。 */
export function Frame() {
  const mirror = useMirrorStore(function (state) {
    return state.mirror
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

  const backgroundImage = mirror?.background?.image ?? wallpaper

  return (
    <div
      className={clsx('relative h-full w-full overflow-hidden')}
      style={{
        backgroundImage: `url(${backgroundImage})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center'
      }}>
      <div className={clsx('absolute inset-0 bg-background/25')} />
      <div className={clsx('relative h-full min-h-0')}>
        <Suspense fallback={null}>
          <Outlet />
        </Suspense>
      </div>
      <Notice />
    </div>
  )
}
