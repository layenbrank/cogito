import { clsx } from 'clsx'
import * as m from 'motion/react-m'
import { forwardRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'

import type { MenuClassNames, MenuMotionSlot } from '@/components/contextmenu/menu'

interface PanelProps {
  level: number
  classNames?: MenuClassNames
  surfaceStyle: CSSProperties
  motion: MenuMotionSlot
  flipX: boolean
  flipY: boolean
  onMouseEnter: () => void
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  children: ReactNode
}

const Panel = forwardRef<HTMLDivElement, PanelProps>(function Panel(props, ref) {
  return (
    <m.div
      ref={ref}
      className={clsx(
        'contextmenu-surface',
        props.level === 0 && 'is-root',
        props.classNames?.surface,
        props.level > 0 && props.classNames?.submenu
      )}
      style={props.surfaceStyle}
      role="menu"
      tabIndex={-1}
      data-region="false"
      initial={props.motion.initial}
      animate={props.motion.animate}
      exit={props.motion.exit}
      transition={props.motion.transition}
      onMouseEnter={props.onMouseEnter}
      onKeyDown={props.onKeyDown}
      data-flip-x={props.flipX ? 'true' : 'false'}
      data-flip-y={props.flipY ? 'true' : 'false'}>
      {props.children}
    </m.div>
  )
})

export { Panel }
export type { PanelProps }
