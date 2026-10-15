import { Suspense, lazy } from 'react'

import { Decorations } from '@/components/decorations/index.ts'
import { CodeCaptionBegin } from '@/views/code/caption/begin.tsx'
import { CodeCaptionFinal } from '@/views/code/caption/final.tsx'
import Summary from '@/views/code/workspace/overlay/summary.tsx'
import styles from '@/views/code/code.module.scss'

const CodeWorkspace = lazy(function () {
  return import('@/views/code/workspace/code.tsx')
})

export default function Code() {
  return (
    <Decorations
      begin={<CodeCaptionBegin />}
      final={<CodeCaptionFinal />}
      section={<Summary />}
      sectionClassName="justify-stretch gap-0 border-border/50 bg-background/70 p-0 backdrop-blur-md"
      scrollable={false}>
      <div className={styles.workspace}>
        <Suspense fallback={null}>
          <CodeWorkspace />
        </Suspense>
      </div>
    </Decorations>
  )
}
