import * as m from 'motion/react-m'

import { Surface } from '@/components/contextmenu/surface'
import { VIEWPORT_PADDING, type Point } from '@/components/contextmenu/position'
import type {
  MenuClassNames,
  MenuMotion,
  MenuSelectInfo,
  MenuStyles,
  ParsedMenuItem
} from '@/components/contextmenu/menu'
import type { ContextMenuProps } from '@/components/contextmenu/contextmenu'

const SHELL_MOTION = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.12 }
}

interface LayerState {
  anchor: Point
  items: ParsedMenuItem[]
}

interface MenuLayerProps {
  layer: LayerState
  path: string[]
  activeKey?: string
  classNames?: MenuClassNames
  styles?: MenuStyles
  motion?: MenuMotion
  offset?: [number, number]
  submenuOffset?: [number, number]
  boundaryPadding?: number
  expandDelay?: number
  collapseDelay?: number
  container: HTMLElement
  renderItem?: ContextMenuProps['renderItem']
  renderSurface?: ContextMenuProps['renderSurface']
  onUpdatePath: (path: string[]) => void
  onUpdateActive: (key: string | undefined) => void
  onSelect: (info: MenuSelectInfo) => void
  onClose: () => void
}

function MenuLayer(props: MenuLayerProps) {
  return (
    <m.div
      className="contextmenu-root"
      initial={SHELL_MOTION.initial}
      animate={SHELL_MOTION.animate}
      exit={SHELL_MOTION.exit}
      transition={SHELL_MOTION.transition}>
      <Surface
        items={props.layer.items}
        level={0}
        keyPath={[]}
        path={props.path}
        activeKey={props.activeKey}
        classNames={props.classNames}
        styles={props.styles}
        motion={props.motion}
        offset={props.offset}
        submenuOffset={props.submenuOffset}
        boundaryPadding={props.boundaryPadding ?? VIEWPORT_PADDING}
        expandDelay={props.expandDelay}
        collapseDelay={props.collapseDelay}
        container={props.container}
        anchor={props.layer.anchor}
        placement="pointer"
        renderItem={props.renderItem}
        renderSurface={props.renderSurface}
        onpathChange={props.onUpdatePath}
        onUpdateActive={props.onUpdateActive}
        onSelect={props.onSelect}
        onClose={props.onClose}
      />
    </m.div>
  )
}

export type { LayerState, MenuLayerProps }
export { MenuLayer }
