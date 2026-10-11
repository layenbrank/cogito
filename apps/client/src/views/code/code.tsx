import { Suspense, lazy } from 'react'

import { Decorations } from '@/components/decorations/index.ts'
import { findComponentLabel } from '@/constants/marketplace/tile-hints'
import styles from '@/views/code/code.module.scss'

const CodeWorkspace = lazy(function () {
  return import('@/views/code/workspace/code.tsx')
})

export default function Code() {
  return (
    <Decorations
      summary={findComponentLabel('code')}
      scrollable={false}>
      <div className={styles.workspace}>
        <Suspense fallback={null}>
          <CodeWorkspace />
        </Suspense>
      </div>
    </Decorations>
  )
}
