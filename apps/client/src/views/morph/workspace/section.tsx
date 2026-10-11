import { clsx } from 'clsx'
import { AnimatePresence, useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'

import Canvas from '@/views/morph/workspace/canvas/canvas.tsx'
import { TaskWorkbench } from '@/views/morph/workspace/tasks/task-workbench.tsx'
import Toolbar from '@/views/morph/workspace/toolbar/toolbar.tsx'
import styles from '@/views/morph/workspace/section.module.scss'
import { useMorphStore } from '@/stores/morph.ts'

const EASE = [0.22, 1, 0.36, 1] as const
const OFFSET = 8

function Section() {
  const isReducedMotion = useReducedMotion()
  const activeOperation = useMorphStore(function (s) {
    return s.activeOperation
  })

  const pane = activeOperation ?? 'canvas'
  const offset = isReducedMotion ? 0 : OFFSET
  const transition = {
    ease: EASE,
    duration: isReducedMotion ? 0 : 0.2
  }

  return (
    <div className={clsx(styles.section, styles.root)}>
      <Toolbar />
      <div className={styles.stage}>
        <AnimatePresence
          mode="wait"
          initial={false}>
          <m.div
            key={pane}
            className={styles.pane}
            initial={{
              opacity: isReducedMotion ? 1 : 0,
              y: offset
            }}
            animate={{
              opacity: 1,
              y: 0
            }}
            exit={{
              opacity: isReducedMotion ? 1 : 0,
              y: -offset * 0.5
            }}
            transition={transition}>
            {pane === 'canvas' ? <Canvas /> : <TaskWorkbench />}
          </m.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

export { Section }
export default Section
