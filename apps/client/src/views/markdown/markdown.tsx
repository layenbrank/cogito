import { Suspense, lazy, useEffect, useState } from 'react'

import { Decorations } from '@/components/decorations/index.ts'
import { findComponentLabel } from '@/constants/marketplace/tile-hints'
import { useMarkdownStore } from '@/stores/markdown'
import { findDisplayTitle } from '@/views/markdown/lib/fs.ts'
import styles from '@/views/markdown/markdown.module.scss'

const MarkdownWorkspace = lazy(function () {
  return import('@/views/markdown/workspace/markdown.tsx')
})

function MarkdownSkeleton() {
  return (
    <div className="flex h-full min-h-0 animate-pulse flex-col gap-2 p-3">
      <div className="h-8 rounded-md bg-muted" />
      <div className="flex min-h-0 flex-1 gap-2">
        <div className="w-40 rounded-md bg-muted" />
        <div className="flex-1 rounded-md bg-muted" />
        <div className="w-32 rounded-md bg-muted" />
      </div>
      <div className="h-7 rounded-md bg-muted" />
    </div>
  )
}

export default function Markdown() {
  const activePath = useMarkdownStore(function (state) {
    return state.activePath
  })
  const isDirty = useMarkdownStore(function (state) {
    return state.isDirty
  })
  const [summary, setSummary] = useState(findComponentLabel('markdown'))

  useEffect(
    function () {
      if (!activePath && !isDirty) {
        setSummary(findComponentLabel('markdown'))
        return
      }
      setSummary(findDisplayTitle(activePath, isDirty))
    },
    [activePath, isDirty]
  )

  return (
    <Decorations
      summary={summary}
      scrollable={false}>
      <div className={styles.workspace}>
        <Suspense fallback={<MarkdownSkeleton />}>
          <MarkdownWorkspace />
        </Suspense>
      </div>
    </Decorations>
  )
}
