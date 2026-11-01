import {
  Splitter,
  SplitterHandle,
  SplitterPane
} from '@cogito/design/components/splitter'
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
        <Splitter
          id="morph-workspace"
          orientation="horizontal"
          className={styles.splitter}>
          <SplitterPane
            id="morph-nav"
            defaultSize="20%"
            min={200}
            max="30%"
            className="overflow-hidden">
            <Navigation />
          </SplitterPane>
          <SplitterHandle />
          <SplitterPane
            id="morph-section"
            className="overflow-hidden">
            <Section />
          </SplitterPane>
        </Splitter>

        {summaryVisible ? <Summary /> : null}
      </div>

      <StatusBar />
    </div>
  )
}
