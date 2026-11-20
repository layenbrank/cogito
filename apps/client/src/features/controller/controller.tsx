'use client'
import clsx from 'clsx'
import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { ContextMenu } from '@/components/contextmenu'
import { useScrollFx } from '@/features/controller/hooks/use-scroll-fx'
import { resetMirrorScroll } from '@/features/controller/lib/scroll-fx'
import { bindSortable, reorder, type SortableSession } from '@/features/controller/lib/sortable'
import { registerMirrorSwitch } from '@/features/controller/mirror-switch'
import styles from '@/features/controller/controller.module.scss'
import '@/features/controller/selection.css'
import { useTileSelection } from '@/features/controller/use-tile-selection.ts'
import { Reflection } from '@/features/controller/reflection.tsx'
import {
  createCollection,
  deleteTiles,
  leaveCollection,
  moveToCollection,
  openBookmarkLibrary
} from '@/features/magnetic-tile/collection-actions.ts'
import { CollectionDialog } from '@/features/magnetic-tile/collection-dialog.tsx'
import { CLASS_NAMES } from '@/features/magnetic-tile/layout-menu/constants'
import { buildItems, buildWallItems } from '@/features/magnetic-tile/layout-menu/items'
import { DURATION_MS } from '@/features/magnetic-tile/enter-motion'
import { hasWallEntered, markWallEntered } from '@/features/magnetic-tile/enter-wall'
import { MagneticTile } from '@/features/magnetic-tile/magnetic-tile.tsx'
import {
  bindMirrorTransition,
  findMirrorDirection,
  type MirrorDirection
} from '@/lib/mirror-transition'
import { useCollectionStore } from '@/stores/collection'
import { useMirrorStore } from '@/stores/mirror.ts'

interface MirrorProps {
  children: ReactNode
}

/** 磁贴行类型：文件里的 `MagneticTile` 标识了同名组件，全局命名空间取不到，改从 store 推导 */
type WallTile = ReturnType<typeof useMirrorStore.getState>['magneticTiles'][number]

/** 没有磁贴时的稳定空数组：传字面量 `[]` 每次都是新引用，会把 WallTiles 的 memo 打穿 */
const NO_TILES: WallTile[] = []

/** 按 id 找到磁贴节点并开关选中属性（id 含特殊字符也不怕） */
function toggleSelected(grid: HTMLElement, id: string, isOn: boolean): void {
  const node = grid.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)
  node?.toggleAttribute('data-selected', isOn)
}

/**
 * 磁贴墙主体。**必须 memo**：
 * 父层自己还会因选中集 / 弹窗开关 / 入场波次重渲染，而磁贴内部每家都要跑 cn（twMerge）+
 * Tooltip 上下文 + 入场 motion —— 重建一遍 n 个磁贴是纯粹的浪费。
 */
const WallTiles = memo(function WallTiles(props: {
  tiles: WallTile[]
  shouldEnter: boolean
}) {
  return (
    <>
      {props.tiles.map(function (value, index) {
        const Component = Reflection[value.component]
        // 旧库存量行的 component 可能不在白名单中，兜底跳过避免渲染崩溃
        if (!Component) return null

        return (
          <MagneticTile.Enter
            key={value.id}
            index={index}
            isActive={props.shouldEnter}>
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
    </>
  )
})

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
        if (viewIdRef.current === activeId) return
        // 以前只在 viewId 为空时同步一次 —— 之后走了「没有动画通道」的切换
        // （`requestMirrorSwitch` 的 store 直达路径），墙会一直停在旧镜像上。
        setViewId(activeId)
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
    /**
     * Ctrl 只用来「暂时禁掉拖拽」，不进状态：
     * 用 `useKeyModifier` 会让每一下 Ctrl 都重渲染整墙（每个磁贴内部都有 cn/twMerge + Tooltip），
     * 而它只是在给 sortable 开关 —— 直接命令式写 ref + 通知 session。
     */
    const controlRef = useRef(false)
    const tilesRef = useRef(magneticTiles)
    const selection = useTileSelection(mirrorId)
    /** 从「加入集合 ▸ 新建集合…」进来的待移入项；建完集合后移到新集合里 */
    const [pendingJoinIDs, setPendingJoinIDs] = useState<string[] | null>(null)
    const [isCollectionOpen, setCollectionOpen] = useState(false)
    /** 冷启动入场波次；播完关掉，避免整墙永久挂 Motion */
    const [shouldEnter, updateShouldEnter] = useState(function () {
      return !hasWallEntered(mirrorId)
    })

    tilesRef.current = magneticTiles

    useEffect(function () {
      function syncModifier(): void {
        sortableRef.current?.disable(controlRef.current)
      }
      function onKey(event: KeyboardEvent): void {
        // 直接读 ctrlKey：漏掉的 keyup（窗口失焦等）下一次按键就能自愈
        if (controlRef.current === event.ctrlKey) return
        controlRef.current = event.ctrlKey
        syncModifier()
      }
      function onBlur(): void {
        if (!controlRef.current) return
        controlRef.current = false
        syncModifier()
      }
      window.addEventListener('keydown', onKey, true)
      window.addEventListener('keyup', onKey, true)
      window.addEventListener('blur', onBlur)
      return function () {
        window.removeEventListener('keydown', onKey, true)
        window.removeEventListener('keyup', onKey, true)
        window.removeEventListener('blur', onBlur)
      }
    }, [])

    /**
     * 选区落到 DOM 属性上，高亮交给 selection.css（不必把 isSelected 透传进每个磁贴组件）。
     * 只动「成员变了」的节点：Ctrl+单击只会影响 1～2 个磁贴，不必扫整墙重写 n 个属性。
     */
    const appliedSelectionRef = useRef<ReadonlySet<string>>(new Set<string>())
    const appliedTilesRef = useRef<WallTile[] | null>(null)

    useEffect(
      function () {
        const grid = gridRef.current
        if (!grid) return
        const next = selection.selected

        // 磁贴换了一批（增删 / 刷新）：整墙重贴一次
        if (appliedTilesRef.current !== magneticTiles) {
          appliedTilesRef.current = magneticTiles
          for (const node of grid.querySelectorAll<HTMLElement>('[data-id]')) {
            node.toggleAttribute('data-selected', next.has(node.dataset.id ?? ''))
          }
          appliedSelectionRef.current = next
          return
        }

        const prev = appliedSelectionRef.current
        for (const id of prev) {
          if (!next.has(id)) toggleSelected(grid, id, false)
        }
        for (const id of next) {
          if (!prev.has(id)) toggleSelected(grid, id, true)
        }
        appliedSelectionRef.current = next
      },
      [selection.selected, magneticTiles]
    )

    useEffect(
      function () {
        markWallEntered(mirrorId)
        if (!shouldEnter) return
        const timer = window.setTimeout(function () {
          updateShouldEnter(false)
        }, DURATION_MS + 200)
        return function () {
          window.clearTimeout(timer)
        }
      },
      [mirrorId, shouldEnter]
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
          const prevById = new Map(
            prev.map(function (tile) {
              return [tile.id, tile]
            })
          )
          const store = useMirrorStore.getState()
          store.toUpdateMagneticTiles(moved)

          const updates = moved
            .filter(function (tile) {
              return prevById.get(tile.id)?.index !== tile.index
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
            .catch(function (error) {
              console.warn('[overview] 磁贴排序保存失败:', error)
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

    /** 书签库是建网址的主入口（收藏/整理都在那里） */
    async function openBookmarks() {
      try {
        await openBookmarkLibrary()
      } catch (error) {
        console.error(error)
        toast.error('无法打开书签库')
      }
    }

    async function onSubmitCollection(title: string) {
      if (!mirrorId) return
      const joinIDs = pendingJoinIDs
      try {
        const collectionID = await createCollection({ mirrorID: mirrorId, title })
        // 选中项建完就移进去（没有待移入项时只是建一个空集合）
        if (collectionID && joinIDs && joinIDs.length > 0) {
          await moveToCollection(joinIDs, collectionID)
          toast.success(`已新建集合「${title}」，并移入 ${joinIDs.length} 项`)
          selection.clear()
        } else {
          toast.success(`已新建集合「${title}」`)
        }
      } catch (error) {
        console.error('[controller] 新建集合失败', error)
        toast.error(joinIDs?.length ? '新建集合或移入失败' : '新建集合失败')
      } finally {
        setPendingJoinIDs(null)
      }
    }

    /** 菜单里的「新建集合…」：`ids` 非空 = 建完把这几种移进去 */
    function onCreateCollection(ids: string[] | null) {
      setPendingJoinIDs(ids)
      setCollectionOpen(true)
    }

    async function onDeleteTiles(ids: string[]) {
      try {
        // 删集合会先把成员移出集合，避免留下指向已删父级的孤儿
        await deleteTiles(ids)
        useCollectionStore.getState().toBumpRevision()
        selection.clear()
        toast.success(`已删除 ${ids.length} 项`)
      } catch (error) {
        console.error('[controller] 删除磁贴失败', error)
        toast.error('删除磁贴失败')
      }
    }

    function reportError(fallback: string) {
      return function (error: unknown) {
        console.error('[controller]', fallback, error)
        toast.error(fallback)
      }
    }

    return (
      <>
        <ContextMenu
          trigger=".magnetic-tile"
          classNames={CLASS_NAMES}
          findItems={function (el) {
            const id = el.getAttribute('data-id')
            const tiles = tilesRef.current ?? []
            // 空白处：只剩「新建 / 去建网址」两件事
            if (!id) {
              return buildWallItems({
                onCreateCollection: onCreateCollection,
                onOpenBookmarks: function () {
                  void openBookmarks()
                }
              })
            }
            const tile = tiles.find(function (item) {
              return item.id === id
            })
            if (!tile) return []
            // 右键没落在选区里：先把选区收成它自己（与桌面 / VS Code 一致）
            const targets = selection.selected.has(id)
              ? tiles.filter(function (item) {
                  return selection.selected.has(item.id)
                })
              : [tile]
            return buildItems({
              tile,
              targets,
              collections: tiles.filter(function (item) {
                return item.component === 'collection'
              }),
              onCreateCollection: onCreateCollection,
              onMoveToCollection: function (collectionID, ids) {
                void moveToCollection(ids, collectionID).catch(
                  reportError('加入集合失败')
                )
                selection.clear()
              },
              onLeaveCollection: function (ids) {
                void leaveCollection(ids).catch(reportError('移出集合失败'))
                selection.clear()
              },
              onDelete: function (ids) {
                void onDeleteTiles(ids)
              }
            })
          }}>
          <div
            ref={gridRef}
            className={clsx([styles.controller, styles['magnetic-tile']])}
            onClickCapture={function (event) {
              const target = (event.target as HTMLElement).closest('[data-id]')
              const id = target?.getAttribute('data-id')
              if (!id) return
              if (!event.ctrlKey && !event.metaKey) {
                // 普通点击：有选区先清掉，再走磁贴自己的激活逻辑
                if (selection.selected.size > 0) selection.clear()
                return
              }
              // Ctrl+单击 = 多选；拦掉磁贴自己的点击（会开网址 / 进集合）
              event.preventDefault()
              event.stopPropagation()
              selection.toggle(id)
            }}
            onClick={function (event) {
              // 点空白处清空选区
              if (event.target === event.currentTarget) selection.clear()
            }}
            onContextMenuCapture={function (event) {
              // 右键落在选区外：菜单只会作用于那一块，高亮也得跟着收成它（与桌面 / VS Code 一致）
              const id = (event.target as HTMLElement)
                .closest('[data-id]')
                ?.getAttribute('data-id')
              if (selection.selected.size === 0) return
              if (id && selection.selected.has(id)) return
              selection.clear()
            }}>
            <WallTiles
              tiles={magneticTiles ?? NO_TILES}
              shouldEnter={shouldEnter}
            />
          </div>
        </ContextMenu>

        <CollectionDialog
          open={isCollectionOpen}
          onOpenChange={setCollectionOpen}
          onConfirm={onSubmitCollection}
        />
      </>
    )
  }
}

export default Controller
