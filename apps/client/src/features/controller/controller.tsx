'use client'
import clsx from 'clsx'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useKeyModifier } from '@reactuses/core'

import { ContextMenu } from '@/components/contextmenu'
import { useScrollFx } from '@/features/controller/hooks/use-scroll-fx'
import { resetMirrorScroll } from '@/features/controller/lib/scroll-fx'
import { bindSortable, reorder, type SortableSession } from '@/features/controller/lib/sortable'
import { registerMirrorSwitch } from '@/features/controller/mirror-switch'
import styles from '@/features/controller/controller.module.scss'
import { Reflection } from '@/features/controller/reflection.tsx'
import { CLASS_NAMES } from '@/features/magnetic-tile/layout-menu/constants'
import { buildItems } from '@/features/magnetic-tile/layout-menu/items'
import { hasWallEntered, markWallEntered } from '@/features/magnetic-tile/enter'
import { MagneticTile } from '@/features/magnetic-tile/magnetic-tile.tsx'
import {
  bindMirrorTransition,
  findMirrorDirection,
  type MirrorDirection
} from '@/lib/mirror-transition'
import { useMirrorStore } from '@/stores/mirror.ts'

interface MirrorProps {
  children: ReactNode
}

const Controller = {
  /**
   * Mirror 滚动视口：切换 active mirror 时先退场再换数据再进场
   */
  Mirror(props: MirrorProps) {
    const mirrors = useMirrorStore((state) => state.mirrors)
    const activeId = useMirrorStore((state) => state.active.mirror?.id ?? null)
    const [viewId, setViewId] = useState(activeId)
    const paneRef = useRef<HTMLDivElement>(null)
    const scrimRef = useRef<HTMLDivElement>(null)
    // 纯工厂，无副作用：用 useState 惰性初始化一次，避免 ref 的可空类型到处补空值判断
    const [transition] = useState(bindMirrorTransition)
    const directionRef = useRef<MirrorDirection>(1)
    const isFirstEnter = useRef(true)
    const mirrorsRef = useRef(mirrors)
    const viewIdRef = useRef(viewId)

    mirrorsRef.current = mirrors
    viewIdRef.current = viewId

    // 外部首次注入 / 同步 active（非 pager 路径）
    useEffect(
      function () {
        if (!activeId) return
        if (viewIdRef.current === null || viewIdRef.current === undefined) {
          setViewId(activeId)
        }
      },
      [activeId]
    )

    useEffect(function () {
      return registerMirrorSwitch(async function (nextId) {
        const currentId = viewIdRef.current
        if (!nextId || nextId === currentId) return

        const direction = findMirrorDirection(mirrorsRef.current, currentId, nextId)
        directionRef.current = direction

        const store = useMirrorStore.getState()
        const payloadPromise = store.toFetchMirrorPayload(nextId)
        const pane = paneRef.current
        const scrim = scrimRef.current
        if (pane) await transition.playExit(pane, direction, scrim)

        const payload = await payloadPromise
        if (!payload) return
        store.toCommitMirrorPayload(payload)
        setViewId(nextId)
      })
    }, [transition])

    useEffect(function () {
      return function () {
        transition.destroy()
      }
    }, [transition])

    // pane remount 后播进场（首次 mount 定格，避免闪一下）
    useLayoutEffect(
      function () {
        const pane = paneRef.current
        if (!pane || !viewId) return

        if (isFirstEnter.current) {
          isFirstEnter.current = false
          return
        }

        const scroller = pane.closest<HTMLElement>('[data-mirror-scroller]')
        resetMirrorScroll(scroller)

        void transition.playEnter(pane, directionRef.current, scrimRef.current)
      },
      [viewId, transition]
    )

    return (
      <div className={clsx(styles.controller, styles.mirror)}>
        <div
          data-mirror-scroller
          className={styles.scroller}>
          <div
            ref={paneRef}
            key={viewId ?? 'empty'}
            data-mirror-pane
            className={styles.pane}>
            {props.children}
          </div>
        </div>
        <div
          ref={scrimRef}
          className={styles.scrim}
          aria-hidden
        />
      </div>
    )
  },
  MagneticTile() {
    const magneticTiles = useMirrorStore((state) => state.magneticTiles)
    const mirrorId = useMirrorStore((state) => state.active.mirror?.id ?? null)
    const gridRef = useRef<HTMLDivElement>(null)
    const sortableRef = useRef<SortableSession | null>(null)
    const control = useKeyModifier('Control')
    const controlRef = useRef(control)
    const tilesRef = useRef(magneticTiles)
    /** 本挂载周期是否播入场：按镜面只冷启动一次，Activity 回墙不重播 */
    const [shouldEnter] = useState(function () {
      return !hasWallEntered(mirrorId)
    })

    controlRef.current = control
    tilesRef.current = magneticTiles

    useEffect(
      function () {
        markWallEntered(mirrorId)
      },
      [mirrorId]
    )

    const scrollFx = useScrollFx(gridRef)

    useEffect(
      function () {
        const gridEl = gridRef.current
        if (!gridEl) return

        let isPersisting = false
        let pendingIds: string[] | null = null

        /** 乐观更新 index 并落库；并发重排进队列 */
        function persistReorder(ids: string[]) {
          const current = tilesRef.current ?? []
          const moved = reorder(current, ids).map(function (tile, index) {
            return { ...tile, index }
          })

          const prev = current
          const store = useMirrorStore.getState()
          store.toUpdateMagneticTiles(moved)

          const updates = moved
            .filter(function (tile) {
              const before = prev.find(function (item) {
                return item.id === tile.id
              })
              return before?.index !== tile.index
            })
            .map(function (tile) {
              return {
                key: tile.id,
                change: { index: tile.index }
              }
            })

          if (!updates.length) {
            isPersisting = false
            if (pendingIds) {
              const next = pendingIds
              pendingIds = null
              persistReorder(next)
            }
            return
          }

          isPersisting = true
          void store
            .toUpdateMagneticTile(updates)
            .catch(function () {
              const mirrorID = useMirrorStore.getState().active.mirror?.id
              if (mirrorID) {
                void useMirrorStore.getState().toReadMirror(mirrorID)
              } else {
                useMirrorStore.getState().toUpdateMagneticTiles(prev)
              }
            })
            .finally(function () {
              isPersisting = false
              if (pendingIds) {
                const next = pendingIds
                pendingIds = null
                persistReorder(next)
              }
            })
        }

        const session = bindSortable(gridEl, {
          isDisabled() {
            return Boolean(controlRef.current)
          },
          onDragStart() {
            scrollFx.pause()
          },
          onDragEnd() {
            scrollFx.resume()
          },
          onReorder(ids) {
            if (isPersisting) {
              pendingIds = ids
              return
            }
            persistReorder(ids)
          }
        })

        sortableRef.current = session
        session.disable(Boolean(controlRef.current))

        return function () {
          session.destroy()
          sortableRef.current = null
        }
      },
      [scrollFx]
    )

    useEffect(
      function () {
        sortableRef.current?.disable(Boolean(control))
      },
      [control]
    )

    return (
      <ContextMenu
        trigger=".magnetic-tile"
        classNames={CLASS_NAMES}
        findItems={function (el) {
          const id = el.getAttribute('data-id')
          if (!id) return []
          const tile = tilesRef.current?.find(function (item) {
            return item.id === id
          })
          return tile ? buildItems(tile) : []
        }}>
        <div
          ref={gridRef}
          className={clsx([styles.controller, styles['magnetic-tile']])}>
          {magneticTiles?.map(function (value, index) {
            const Component = Reflection[value.component]
            // 旧库存量行的 component 可能不在白名单中，兜底跳过避免渲染崩溃
            if (!Component) return null

            return (
              <MagneticTile.Enter
                key={value.id}
                index={index}
                isActive={shouldEnter}>
                <MagneticTile.Suspense
                  id={value.id}
                  size={value.size}
                  shape={value.shape}
                  direction={value.direction}>
                  <Component {...value} />
                </MagneticTile.Suspense>
              </MagneticTile.Enter>
            )
          })}
        </div>
      </ContextMenu>
    )
  }
}

export default Controller
