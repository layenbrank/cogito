import { AnimatePresence } from 'motion/react'
import { useCallback, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

import type { ContextMenuProps } from '@/components/contextmenu/contextmenu'
import { findBody } from '@/components/contextmenu/find-body'
import { MenuLayer } from '@/components/contextmenu/menu-layer'
import { findFocusable, parseMenuItems, useDismiss } from '@/components/contextmenu/menu'
import type { MenuItem, MenuSelectInfo, ParsedMenuItem } from '@/components/contextmenu/menu'
import { VIEWPORT_PADDING, type Point } from '@/components/contextmenu/position'

type HostConfig = Omit<ContextMenuProps, 'children' | 'items' | 'visible' | 'onUpdateVisible'> & {
  items?: MenuItem[]
}

/** 命令式打开菜单的入参 */
interface PresentInput extends HostConfig {
  x: number
  y: number
  items: MenuItem[]
}

interface StoreState {
  visible: boolean
  session: number
  anchor: Point
  items: ParsedMenuItem[]
  config: HostConfig
}

type Listener = () => void

const LISTENERS = new Set<Listener>()

let STORE: StoreState = {
  visible: false,
  session: 0,
  anchor: { x: 0, y: 0 },
  items: [],
  config: {}
}

function emit() {
  for (const listener of LISTENERS) {
    listener()
  }
}

function subscribe(listener: Listener) {
  LISTENERS.add(listener)
  return function () {
    LISTENERS.delete(listener)
  }
}

function findSnapshot() {
  return STORE
}

function presentMenu(input: PresentInput) {
  const { x, y, items, ...config } = input
  const parsed = parseMenuItems(items)
  STORE = {
    visible: true,
    session: STORE.session + 1,
    anchor: { x, y },
    items: parsed,
    config
  }
  emit()
}

function dismissMenu() {
  if (!STORE.visible) return
  STORE = {
    ...STORE,
    visible: false
  }
  emit()
}

function resetMenu() {
  STORE = {
    visible: false,
    session: STORE.session,
    anchor: { x: 0, y: 0 },
    items: [],
    config: {}
  }
  emit()
}

function useContextMenu() {
  const present = useCallback(function (input: PresentInput) {
    presentMenu(input)
  }, [])

  const dismiss = useCallback(function () {
    dismissMenu()
  }, [])

  return { present, dismiss }
}

interface HostSessionProps {
  state: StoreState
  container: HTMLElement
}

/** session 作 key：每次打开重置 path / 焦点，避免 effect 里同步 setState */
function HostSession(props: HostSessionProps) {
  const { state, container } = props
  const focusable = findFocusable(state.items)
  const [path, onUpdatePath] = useState<string[]>([])
  const [activeKey, onUpdateActive] = useState<string | undefined>(focusable[0]?.key)

  function onSelect(info: MenuSelectInfo) {
    state.config.onSelect?.(info)
    dismissMenu()
  }

  return (
    <MenuLayer
      layer={{ anchor: state.anchor, items: state.items }}
      path={path}
      activeKey={activeKey}
      classNames={state.config.classNames}
      styles={state.config.styles}
      motion={state.config.motion}
      offset={state.config.offset}
      submenuOffset={state.config.submenuOffset}
      boundaryPadding={state.config.boundaryPadding ?? VIEWPORT_PADDING}
      expandDelay={state.config.expandDelay}
      collapseDelay={state.config.collapseDelay}
      container={container}
      renderItem={state.config.renderItem}
      renderSurface={state.config.renderSurface}
      onUpdatePath={onUpdatePath}
      onUpdateActive={onUpdateActive}
      onSelect={onSelect}
      onClose={dismissMenu}
    />
  )
}

function Host() {
  const state = useSyncExternalStore(subscribe, findSnapshot, findSnapshot)
  const container = (state.config.onTeleport ?? findBody)()

  useDismiss({
    visible: state.visible,
    onClose: dismissMenu
  })

  return createPortal(
    <AnimatePresence
      onExitComplete={function () {
        if (STORE.visible) return
        resetMenu()
      }}>
      {state.visible ? (
        <HostSession
          key={state.session}
          state={state}
          container={container}
        />
      ) : null}
    </AnimatePresence>,
    container
  )
}

export { dismissMenu, Host, presentMenu, resetMenu, useContextMenu }
export type { HostConfig, PresentInput }
