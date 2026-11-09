import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode
} from 'react'

import type { CaptionProps } from '@/features/window-shell/caption'

interface ShellSlots {
  begin?: ReactNode
  /** 中列（应用窗居中搜索等）；有值时 Caption 走三列 grid */
  center?: ReactNode
  final?: ReactNode
  section?: ReactNode
  sectionClassName?: string
  summary?: string
  /** 内容区是否由外壳统一滚动；默认 true */
  scrollable?: boolean
  controls?: CaptionProps['controls']
  /** 内容列额外 class */
  className?: string
}

interface ShellSlotsStore {
  subscribe: (onStoreChange: () => void) => () => void
  findSlots: () => ShellSlots
  writeSlots: (next: ShellSlots | null, owner: symbol) => void
}

const EMPTY_SLOTS: ShellSlots = {}

function buildShellSlotsStore(): ShellSlotsStore {
  let slots: ShellSlots = EMPTY_SLOTS
  let owner: symbol | null = null
  const listeners = new Set<() => void>()

  function emit() {
    for (const listener of listeners) listener()
  }

  return {
    subscribe: function (onStoreChange) {
      listeners.add(onStoreChange)
      return function () {
        listeners.delete(onStoreChange)
      }
    },
    findSlots: function () {
      return slots
    },
    writeSlots: function (next, nextOwner) {
      if (next) {
        const prev = slots
        owner = nextOwner
        slots = next
        // 同引用字段则跳过通知，避免页重渲带动 Caption 订阅抖动
        if (
          prev.begin === next.begin &&
          prev.center === next.center &&
          prev.final === next.final &&
          prev.section === next.section &&
          prev.summary === next.summary &&
          prev.scrollable === next.scrollable &&
          prev.sectionClassName === next.sectionClassName &&
          prev.className === next.className &&
          prev.controls === next.controls
        ) {
          return
        }
        emit()
        return
      }
      if (owner !== nextOwner) return
      owner = null
      // 保留 slots，避免切页空一帧；回墙时 Frame 忽略 app slots
    }
  }
}

const ShellSlotsStoreContext = createContext<ShellSlotsStore | null>(null)

function ShellSlotsProvider(props: { children: ReactNode }) {
  const storeRef = useRef<ShellSlotsStore | null>(null)
  if (!storeRef.current) storeRef.current = buildShellSlotsStore()

  return (
    <ShellSlotsStoreContext.Provider value={storeRef.current}>
      {props.children}
    </ShellSlotsStoreContext.Provider>
  )
}

function useShellSlotsStore(): ShellSlotsStore {
  const store = useContext(ShellSlotsStoreContext)
  if (!store) {
    throw new Error('[window-shell] useShellSurface 须在 ShellSlotsProvider 内')
  }
  return store
}

/** 只读当前槽（仅 Caption / section 订阅，避免带动页面重渲死循环） */
function useShellSlots(): ShellSlots {
  const store = useContext(ShellSlotsStoreContext)
  return useSyncExternalStore(
    store?.subscribe ??
      function () {
        return function () {}
      },
    store?.findSlots ??
      function () {
        return EMPTY_SLOTS
      },
    function () {
      return EMPTY_SLOTS
    }
  )
}

/**
 * 页/布局申报操作栏槽；挂载期间同步，卸载时释放所有权。
 * 嵌套路由须单一写手，禁止父子同时写。
 */
function useShellSurface(slots: ShellSlots) {
  const store = useShellSlotsStore()
  const ownerRef = useRef(Symbol('shell-surface'))

  useLayoutEffect(function () {
    store.writeSlots(slots, ownerRef.current)
  })

  useEffect(
    function () {
      const owner = ownerRef.current
      return function () {
        store.writeSlots(null, owner)
      }
    },
    [store]
  )
}

export { ShellSlotsProvider, useShellSlots, useShellSurface }
export type { ShellSlots }
