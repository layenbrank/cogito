import { Button } from '@cogito/design/components/button'
import { clsx } from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const SIZES: readonly MagneticTile.Size[] = [1, 2, 3, 4]

const SHAPES: readonly { shape: MagneticTile.Shape; direction: MagneticTile.Direction; label: string }[] = [
  { shape: 'square', direction: 'horizontal', label: '方形' },
  { shape: 'circle', direction: 'horizontal', label: '圆形' },
  { shape: 'rectangle', direction: 'horizontal', label: '横条' },
  { shape: 'rectangle', direction: 'vertical', label: '竖条' }
]

interface WallMenuProps {
  x: number
  y: number
  tile: MagneticTile | null
  targets: MagneticTile[]
  collections: MagneticTile[]
  canOpen: boolean
  onClose: () => void
  onOpen: () => void
  onEdit: () => void
  onLayout: (layout: {
    size: MagneticTile.Size
    shape: MagneticTile.Shape
    direction: MagneticTile.Direction
  }) => void
  onAssign: (collectionID: string | null) => void
  onCreateCollection: () => void
  onRemove: () => void
  onAddTile: () => void
  onOpenBookmarks: () => void
  onOpenSettings: () => void
}

function isSameShape(tile: MagneticTile, item: (typeof SHAPES)[number]): boolean {
  if (tile.shape !== item.shape) return false
  if (item.shape !== 'rectangle') return true
  return tile.direction === item.direction
}

/** 镜像右键菜单：打开、布局、集合、删除。空白处则是添加入口。 */
function WallMenu(props: WallMenuProps) {
  const nodeRef = useRef<HTMLDivElement>(null)
  const [point, updatePoint] = useState({ x: props.x, y: props.y })
  const sample = props.targets[0] ?? props.tile
  const joinable = props.targets.some(function (tile) {
    return tile.component !== 'collection'
  })
  const nested = props.targets.some(function (tile) {
    return Boolean(tile.collectionID)
  })

  const closeRef = useRef(props.onClose)
  useEffect(function () {
    closeRef.current = props.onClose
  })

  useEffect(function () {
    function close(event: PointerEvent): void {
      if (nodeRef.current?.contains(event.target as Node)) return
      closeRef.current()
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') closeRef.current()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey)
    return function () {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  useEffect(
    function () {
      const node = nodeRef.current
      if (!node) return
      const box = node.getBoundingClientRect()
      updatePoint({
        x: Math.max(8, Math.min(props.x, window.innerWidth - box.width - 8)),
        y: Math.max(8, Math.min(props.y, window.innerHeight - box.height - 8))
      })
    },
    [props.x, props.y, props.tile, props.targets.length]
  )

  const body = (
    <div
      ref={nodeRef}
      className={clsx(
        'fixed z-50 flex max-h-[70vh] w-52 flex-col gap-1 overflow-y-auto overscroll-contain rounded-lg border bg-popover p-1 text-popover-foreground shadow-md'
      )}
      style={{ left: point.x, top: point.y }}
      onContextMenu={function (event) {
        event.preventDefault()
      }}>
      {props.tile ? (
        <>
          {props.canOpen ? (
            <MenuRow
              label="打开"
              onSelect={props.onOpen}
            />
          ) : null}
          {props.tile.component === 'navigation' || props.tile.component === 'collection' ? (
            <MenuRow
              label={props.tile.component === 'collection' ? '重命名' : '编辑'}
              onSelect={props.onEdit}
            />
          ) : null}
          {sample ? (
            <div className={clsx('flex flex-col gap-1 px-1 py-1')}>
              <span className={clsx('px-1 text-xs text-muted-foreground')}>布局</span>
              <div className={clsx('flex gap-1')}>
                {SIZES.map(function (size) {
                  return (
                    <Button
                      key={size}
                      type="button"
                      size="xs"
                      variant={sample.size === size ? 'default' : 'secondary'}
                      className={clsx('min-w-7 flex-1')}
                      onClick={function () {
                        props.onLayout({ size, shape: sample.shape, direction: sample.direction })
                      }}>
                      {size}
                    </Button>
                  )
                })}
              </div>
              <div className={clsx('grid grid-cols-2 gap-1')}>
                {SHAPES.map(function (item) {
                  return (
                    <Button
                      key={item.label}
                      type="button"
                      size="xs"
                      variant={isSameShape(sample, item) ? 'default' : 'secondary'}
                      onClick={function () {
                        props.onLayout({ size: sample.size, shape: item.shape, direction: item.direction })
                      }}>
                      {item.label}
                    </Button>
                  )
                })}
              </div>
            </div>
          ) : null}
          {joinable ? (
            <div className={clsx('flex flex-col gap-0.5')}>
              <span className={clsx('px-2 text-xs text-muted-foreground')}>加入集合</span>
              {props.collections.length === 0 ? (
                <MenuRow
                  label="新建集合"
                  onSelect={props.onCreateCollection}
                />
              ) : (
                props.collections.map(function (collection) {
                  return (
                    <MenuRow
                      key={collection.id}
                      label={collection.title || '未命名集合'}
                      onSelect={function () {
                        props.onAssign(collection.id)
                      }}
                    />
                  )
                })
              )}
            </div>
          ) : null}
          {nested ? (
            <MenuRow
              label="移出集合"
              onSelect={function () {
                props.onAssign(null)
              }}
            />
          ) : null}
          <div className={clsx('my-0.5 h-px bg-border')} />
          <MenuRow
            label={props.targets.length > 1 ? `删除 ${props.targets.length} 项` : '删除'}
            onSelect={props.onRemove}
          />
        </>
      ) : (
        <>
          <MenuRow
            label="添加磁贴"
            onSelect={props.onAddTile}
          />
          <MenuRow
            label="新建集合"
            onSelect={props.onCreateCollection}
          />
          <MenuRow
            label="书签库"
            onSelect={props.onOpenBookmarks}
          />
          <MenuRow
            label="外观"
            onSelect={props.onOpenSettings}
          />
        </>
      )}
    </div>
  )

  return createPortal(body, document.body)
}

function MenuRow(props: { label: string; onSelect: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={clsx('w-full justify-start font-normal')}
      onClick={props.onSelect}>
      {props.label}
    </Button>
  )
}

export { WallMenu }
