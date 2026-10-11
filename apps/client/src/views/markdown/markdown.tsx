import { Suspense, lazy } from 'react'

import { Decorations } from '@/components/decorations/index.ts'
import { findComponentLabel } from '@/constants/marketplace/tile-hints'
import styles from '@/views/markdown/markdown.module.scss'

const MarkdownWorkspace = lazy(function () {
  return import('@/views/markdown/workspace/markdown.tsx')
})

export default function Markdown() {
  return (
    <Decorations
      summary={findComponentLabel('markdown')}
      scrollable={false}>
      <div className={styles.workspace}>
        <Suspense fallback={null}>
          <MarkdownWorkspace />
        </Suspense>
      </div>
    </Decorations>
  )
}
