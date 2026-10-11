import { Suspense, lazy } from 'react'

import { Decorations } from '@/components/decorations/index.ts'
import { findComponentLabel } from '@/constants/marketplace/tile-hints'
import styles from '@/views/example/example.module.scss'

const ExampleWorkspace = lazy(function () {
  return import('@/views/example/workspace/example.tsx')
})

export default function Example() {
  return (
    <Decorations
      summary={findComponentLabel('example')}
      scrollable={false}>
      <div className={styles.workspace}>
        <Suspense fallback={null}>
          <ExampleWorkspace />
        </Suspense>
      </div>
    </Decorations>
  )
}
