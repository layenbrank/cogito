import { Spinner } from '@cogito/design/components/spinner'
import { Suspense, lazy } from 'react'

import { Decorations } from '@/components/decorations/index.ts'
import { ClipchampCaptionBegin } from '@/views/clipchamp/caption/begin.tsx'
import { ClipchampCaptionFinal } from '@/views/clipchamp/caption/final.tsx'

const ClipchampWorkspace = lazy(function () {
  return import('@/views/clipchamp/workspace/workspace.tsx')
})

/**
 * Clipchamp 磁贴窗壳（对齐 Markdown / Code）：
 * - begin / final 仅填业务控件，窗拖拽与窗口键由 Decorations → components/caption 负责
 * - scrollable=false：工作区自管滚动
 */
export default function Clipchamp() {
  return (
    <Decorations
      begin={<ClipchampCaptionBegin />}
      final={<ClipchampCaptionFinal />}
      scrollable={false}>
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center">
            <Spinner className="size-5 text-muted-foreground" />
          </div>
        }>
        <ClipchampWorkspace />
      </Suspense>
    </Decorations>
  )
}
