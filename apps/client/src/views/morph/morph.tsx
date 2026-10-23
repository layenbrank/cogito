import { Spinner } from '@cogito/design/components/spinner'
import { Suspense, lazy } from 'react'

import { Decorations } from '@/components/decorations/index.ts'
import { Caption } from '@/views/morph/workspace/caption.tsx'
import styles from '@/views/morph/morph.module.scss'

const MorphWorkspace = lazy(function () {
  return import('@/views/morph/workspace/workspace.tsx')
})

export default function Morph() {
  return (
    <Decorations
      begin={<Caption />}
      scrollable={false}>
      <Suspense
        fallback={
          <div className={styles.root}>
            <Spinner className="size-5 text-muted-foreground" />
          </div>
        }>
        <MorphWorkspace />
      </Suspense>
    </Decorations>
  )
}
