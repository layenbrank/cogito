import { clsx } from 'clsx'

import styles from '@/views/collection/controller.module.scss'
import Navigation from '@/features/magnetic-tiles/navigation/navigation.tsx'

interface ControllerProps {
  magneticTiles: readonly MagneticTile[]
  /** 根节点是 <button>，故鼠标/键盘事件都按 button 元素声明 */
  onClick?: React.MouseEventHandler<HTMLButtonElement>
  onPrevent?: React.MouseEventHandler<HTMLDivElement>
}

function Controller(props: ControllerProps) {
  const size: Mirror.Size = 1
  const shape: Mirror.Shape = 'rectangle'
  const direction: Mirror.Direction = 'horizontal'

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    props.onClick?.(event as unknown as React.MouseEvent<HTMLButtonElement>)
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
