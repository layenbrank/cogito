import { useShellSurface } from '@/features/window-shell/slots'
import { CodeCaptionBegin } from '@/views/code/caption/begin.tsx'
import { CodeCaptionCenter } from '@/views/code/caption/center.tsx'
import { CodeCaptionFinal } from '@/views/code/caption/final.tsx'
import CodeWorkspace from '@/views/code/workspace/code.tsx'
import Summary from '@/views/code/workspace/overlay/summary.tsx'
import styles from '@/views/code/code.module.scss'

export default function Code() {
  useShellSurface({
    begin: <CodeCaptionBegin />,
    center: <CodeCaptionCenter />,
    final: <CodeCaptionFinal />,
    section: <Summary />,
    sectionClassName:
      'justify-stretch gap-0 border-border/50 bg-background/70 p-0 backdrop-blur-md',
    scrollable: false
  })

  return (
    <div className={styles.workspace}>
      <CodeWorkspace />
    </div>
  )
}
