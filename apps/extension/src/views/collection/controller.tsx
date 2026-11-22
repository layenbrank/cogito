import { useMemo, useState } from 'react'

import Collection from '@/features/magnetic-tiles/collection/collection.tsx'
import Navigation from '@/features/magnetic-tiles/navigation/navigation.tsx'
import styles from '@/views/collection/controller.module.scss'

interface ControllerProps {
  magneticTiles: readonly MagneticTile[]
  onPick?: (id: string) => void
  onPrevent?: React.MouseEventHandler<HTMLDivElement>
  onRemove?: (id: string) => void
  density?: 'comfortable' | 'compact'
}

function Controller(props: ControllerProps) {
  const density = props.density ?? 'comfortable'
  const size: Mirror.Size = 1
  const shape: Mirror.Shape = 'square'
  const direction: Mirror.Direction = 'vertical'
  const [menu, updateMenu] = useState<{ x: number; y: number; id: string } | null>(null)

  function pickFromEvent(event: React.SyntheticEvent<HTMLDivElement>, allowed: boolean): void {
    if (!allowed) return
    const closest = (event.target as HTMLElement).closest<HTMLElement>('.magnetic-tile')
    if (!closest) return
    const id = closest.getAttribute('data-id')
    if (id) props.onPick?.(id)
  }

  const ordered = useMemo(
    function () {
      return [...props.magneticTiles].toSorted(function (a, b) {
        if (a.component !== b.component) {
          return a.component === 'collection' ? -1 : 1
        }
        return a.index - b.index
      })
    },
    [props.magneticTiles]
  )

  return (
    <div
      role="toolbar"
      aria-label="集合内容"
      data-density={density}
      className={styles.magneticTile}
      onClick={function (event) {
        updateMenu(null)
        pickFromEvent(event, Boolean(props.onPick))
      }}
      onContextMenu={function (event) {
        const closest = (event.target as HTMLElement).closest<HTMLElement>('.magnetic-tile')
        const id = closest?.getAttribute('data-id')
        if (!id || !props.onRemove) return
        event.preventDefault()
        updateMenu({ x: event.clientX, y: event.clientY, id })
      }}
      onKeyDown={function (event) {
        if (event.key !== 'Enter' && event.key !== ' ') return
        pickFromEvent(event, Boolean(props.onPick))
      }}>
      {ordered.map(function (value) {
        if (value.component === 'collection') {
          return (
            <Collection
              {...value}
              key={value.id}
              size={size}
              shape={shape}
              direction={direction}
              onDoubleClick={
                props.onPick
                  ? function (event) {
                      event.stopPropagation()
                      event.preventDefault()
                      props.onPick?.(value.id)
                    }
                  : undefined
              }
            />
          )
        }

        return (
          <Navigation
            {...value}
            key={value.id}
            size={size}
            shape={shape}
            direction={direction}
            onPrevent={props.onPrevent}
          />
        )
      })}
      {menu ? (
        <div
          className="fixed z-50 min-w-32 rounded-lg border border-border bg-popover p-1 text-sm shadow-md"
          style={{ left: menu.x, top: menu.y }}>
          <button
            type="button"
            className="w-full rounded-md px-2 py-1.5 text-left text-destructive hover:bg-muted"
            onClick={function (event) {
              event.stopPropagation()
              props.onRemove?.(menu.id)
              updateMenu(null)
            }}>
            移出集合
          </button>
        </div>
      ) : null}
    </div>
  )
}

export { Controller }
export type { ControllerProps }
