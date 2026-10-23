import { usePanelRef } from '@cogito/design/components/resizable'
import { useCallback, useEffect, useMemo, useRef } from 'react'

import { useCorexStore } from '@/stores/corex'

import { RUN_MAX } from '@/views/directive/splitter'
import { useRunDockStore } from './run-dock-store'
import { indexStepCounts } from './run-status'

/**
 * 运行台开合卡顿的根因（与 CSS 动效无关）：
 * 1. expand/collapse 触发 Group `onLayoutChanged` → 同步 read/write localStorage
 * 2. 同帧 `onResize` 再打一轮 setState，Directive 整页（含卡片墙）重渲染
 * 3. expand + resize 连续两次改 flex，墙面双重回流
 *
 * 对策：程序化开合静音 onResize；布局存档只在用户拖拽时写；展开到 RUN_MAX。
 * 小窗展开会被邻居 minSize 夹成更小占比，最大化后不会自动回到 RUN_MAX，
 * 所以窗口 resize 时若仍钉在默认占比，再套一次。
 *
 * 开合 / 选中 tab 在 `run-dock-store`：卡片墙与编排台统一，默认收缩。
 */

export function useRunDock() {
  const directives = useCorexStore(function (state) {
    return state.directives
  })
  const runs = useCorexStore(function (state) {
    return state.runs
  })
  const markSeen = useCorexStore(function (state) {
    return state.markSeen
  })
  const initialize = useCorexStore(function (state) {
    return state.initialize
  })
  const focusRunId = useCorexStore(function (state) {
    return state.focusRunId
  })

  const isRunOpen = useRunDockStore(function (state) {
    return state.isRunOpen
  })
  const selectedRunId = useRunDockStore(function (state) {
    return state.selectedRunId
  })
  const selectedName = useRunDockStore(function (state) {
    return state.selectedName
  })
  const isLibraryOpen = useRunDockStore(function (state) {
    return state.isLibraryOpen
  })

  useEffect(
    function () {
      void initialize()
    },
    [initialize]
  )

  const runRef = usePanelRef()
  /** 程序化开合期间忽略 onResize，避免套娃 setState */
  const muteResizeRef = useRef(false)
  /**
   * 展开后钉在 `RUN_MAX`：小窗被夹过的占比，窗口变大时再套回上限。
   * 用户拖过分栏后松开，改跟用户占比走。
   */
  const pinToMaxRef = useRef(true)
  const openRef = useRef(isRunOpen)
  // 供给下面的稳定回调（它们故意不依赖 isRunOpen）：提交后同步，不在渲染期写 ref
  useEffect(
    function () {
      openRef.current = isRunOpen
    },
    [isRunOpen]
  )

  const writeRunOpen = useCallback(function (next: boolean) {
    openRef.current = next
    useRunDockStore.getState().writeRunOpen(next)
  }, [])

  /** 程序化开合期间静音 onResize：下面几个面板操作都要用，故一起稳定下来 */
  const withMutedResize = useCallback(function (task: () => void) {
    muteResizeRef.current = true
    try {
      task()
    } finally {
      globalThis.queueMicrotask(function () {
        muteResizeRef.current = false
      })
    }
  }, [])

  const expandPanel = useCallback(
    function () {
      const panel = runRef.current
      if (!panel) return
      pinToMaxRef.current = true
      withMutedResize(function () {
        panel.resize(RUN_MAX)
      })
    },
    [runRef, withMutedResize]
  )

  const collapsePanel = useCallback(
    function () {
      const panel = runRef.current
      if (!panel) return
      pinToMaxRef.current = true
      withMutedResize(function () {
        panel.collapse()
      })
    },
    [runRef, withMutedResize]
  )

  const applyPinnedMax = useCallback(
    function () {
      if (!openRef.current || !pinToMaxRef.current) return
      const panel = runRef.current
      if (!panel || panel.isCollapsed()) return
      withMutedResize(function () {
        panel.resize(RUN_MAX)
      })
    },
    [runRef, withMutedResize]
  )

  /** 分栏回流完成后再挂台体，避免同帧「改 flex + 挂 Chips/Output」抢主线程 */
  const openAfterResize = useCallback(
    function () {
      globalThis.requestAnimationFrame(function () {
        writeRunOpen(true)
      })
    },
    [writeRunOpen]
  )

  // 守护触发：自动展开运行台并盯住这次输出
  useEffect(
    function () {
      if (!focusRunId) return
      const focused = useCorexStore.getState().runs.find(function (run) {
        return run.id === focusRunId
      })
      useRunDockStore.getState().selectRun(focusRunId, focused?.name ?? null)
      if (!openRef.current) {
        expandPanel()
        openAfterResize()
      }
      useCorexStore.getState().clearFocusRun()
    },
    [focusRunId, expandPanel, openAfterResize]
  )

  // 席位复用换了 id：按指令名把选中钉回同一枚标签
  useEffect(
    function () {
      if (
        runs.some(function (run) {
          return run.id === selectedRunId
        })
      ) {
        return
      }
      const byName = selectedName
        ? runs.find(function (run) {
            return run.name === selectedName
          })
        : null
      if (byName) useRunDockStore.getState().selectRun(byName.id, byName.name)
    },
    [runs, selectedRunId, selectedName]
  )

  // 挂载后按共享态对齐一次
  useEffect(
    function () {
      if (openRef.current) expandPanel()
      else collapsePanel()
    },
    [expandPanel, collapsePanel]
  )

  // 收起：先卸台体（isRunOpen=false），再缩面板
  useEffect(
    function () {
      if (isRunOpen) return
      collapsePanel()
    },
    [isRunOpen, collapsePanel]
  )

  // 窗口最大化 / 缩放：把被小窗夹住的占比重新套回 RUN_MAX
  useEffect(
    function () {
      function onWindowResize() {
        applyPinnedMax()
      }
      window.addEventListener('resize', onWindowResize)
      return function () {
        window.removeEventListener('resize', onWindowResize)
      }
    },
    [applyPinnedMax]
  )

  const startRun = useCallback(
    function (name: string, input: Record<string, unknown>) {
      markSeen(name)
      const id = useCorexStore.getState().startRun(name, input)
      useRunDockStore.getState().selectRun(id, name)
      // 点卡片「运行」只起任务，不掀开模拟终端；要看输出时用户自己展开标题栏
    },
    [markSeen]
  )

  const quickRun = useCallback(
    function (name: string) {
      startRun(name, {})
    },
    [startRun]
  )

  const toggleRun = useCallback(
    function () {
      if (openRef.current) {
        writeRunOpen(false)
        return
      }
      expandPanel()
      openAfterResize()
    },
    [writeRunOpen, expandPanel, openAfterResize]
  )

  const onRunResize = useCallback(
    function () {
      if (muteResizeRef.current) return
      const nextOpen = !(runRef.current?.isCollapsed() ?? false)
      if (nextOpen === openRef.current) return
      writeRunOpen(nextOpen)
    },
    [writeRunOpen, runRef]
  )

  const onRemove = useCallback(function (id: string) {
    useCorexStore.getState().removeRun(id)
    const store = useRunDockStore.getState()
    if (store.selectedRunId === id) store.selectRun(null)
  }, [])

  const onClear = useCallback(function () {
    useCorexStore.getState().clearRuns()
    useRunDockStore.getState().selectRun(null)
  }, [])

  const selectRun = useCallback(function (id: string | null) {
    const name = id
      ? (useCorexStore.getState().runs.find(function (run) {
          return run.id === id
        })?.name ?? null)
      : null
    useRunDockStore.getState().selectRun(id, name)
  }, [])

  const updateLibraryOpen = useCallback(function (next: boolean) {
    useRunDockStore.getState().writeLibraryOpen(next)
  }, [])

  const releaseRunSizePin = useCallback(function () {
    pinToMaxRef.current = false
  }, [])

  const stepCounts = useMemo(
    function () {
      return indexStepCounts(directives)
    },
    [directives]
  )

  const runPanel = useMemo(
    function () {
      return {
        isCollapsed: !isRunOpen,
        selectedId: selectedRunId,
        onToggle: toggleRun,
        onSelect: selectRun,
        onVisible: markSeen,
        onRemove,
        onClear
      }
    },
    [isRunOpen, selectedRunId, toggleRun, selectRun, markSeen, onRemove, onClear]
  )

  return {
    runs,
    stepCounts,
    runRef,
    runPanel,
    isRunOpen,
    startRun,
    quickRun,
    onRunResize,
    isLibraryOpen,
    updateLibraryOpen,
    releaseRunSizePin
  }
}

export type RunDock = ReturnType<typeof useRunDock>
