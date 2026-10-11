import { clsx } from 'clsx'

import styles from '@/views/collection/controller.module.scss'
import Navigation from '@/features/magnetic-tiles/navigation/navigation.tsx'

interface ControllerProps {
  magneticTiles: readonly MagneticTile[]
  onClick?: React.MouseEventHandler<HTMLDivElement>
  onPrevent?: React.MouseEventHandler<HTMLDivElement>
}

function Controller(props: ControllerProps) {
  const size: Mirror.Size = 1
  const shape: Mirror.Shape = 'rectangle'
  const direction: Mirror.Direction = 'horizontal'

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    props.onClick?.(event as unknown as React.MouseEvent<HTMLDivElement>)
  }

  return (
    <button
      type="button"
      onClick={props.onClick}
      onKeyDown={onKeyDown}
      className={clsx([
        styles[`lv${size}`],
        styles[shape],
        styles[direction],
        styles.magneticTile,
        'appearance-none border-0 bg-transparent p-0 text-left'
      ])}>
      {props.magneticTiles?.map(function (value) {
        return (
          <Navigation
            {...value}
            onPrevent={props.onPrevent}
            key={value.id}
            size={size}
            shape={shape}
            direction={direction}
          />
        )
      })}
    </button>
  )
}

export { Controller }
