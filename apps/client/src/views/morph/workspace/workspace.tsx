import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from '@cogito/design/components/resizable'
import { clsx } from 'clsx'

import Navigation from '@/views/morph/workspace/navigation.tsx'
import Section from '@/views/morph/workspace/section.tsx'
import StatusBar from '@/views/morph/workspace/statusbar.tsx'
import Summary from '@/views/morph/workspace/summary.tsx'
import { useMorphStore } from '@/stores/morph.ts'

import styles from '@/views/morph/workspace/workspace.module.scss'

export default function Workspace() {
  const summaryVisible = useMorphStore(function (s) {
    return s.summaryVisible
  })

  return (
    <div className={clsx(styles.root)}>
      <div className={styles.panes}>
        <ResizablePanelGroup
          orientation="horizontal"
          className={styles.splitter}>
          <ResizablePanel
            defaultSize="20%"
            minSize={200}
            maxSize="30%"
            className="overflow-hidden">
            <Navigation />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel className="overflow-hidden">
            <Section />
          </ResizablePanel>
        </ResizablePanelGroup>

        {summaryVisible ? <Summary /> : null}
      </div>

      <StatusBar />
    </div>
  )
}
