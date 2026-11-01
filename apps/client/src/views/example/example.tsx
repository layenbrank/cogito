import { findComponentLabel } from '@/constants/marketplace/tile-hints'
import { useShellSurface } from '@/features/window-shell/slots'
import ExampleWorkspace from '@/views/example/workspace/example.tsx'
import styles from '@/views/example/example.module.scss'

export default function Example() {
  useShellSurface({
    summary: findComponentLabel('example'),
    scrollable: false
  })

  return (
    <div className={styles.workspace}>
      <ExampleWorkspace />
    </div>
  )
}
