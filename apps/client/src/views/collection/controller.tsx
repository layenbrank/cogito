import Navigation from '@/features/magnetic-tiles/navigation/navigation.tsx'
import styles from '@/views/collection/controller.module.scss'

interface ControllerProps {
  magneticTiles: readonly MagneticTile[]
  /** 抽屉选贴：点击卡片回调 */
  onPick?: (id: string) => void
  /** 阻止 navigation Section 双击开窗（抽屉选贴） */
  onPrevent?: React.MouseEventHandler<HTMLDivElement>
  /** 成员移出集合 */
  onRemove?: (id: string) => void
}

function Controller(props: ControllerProps) {
  // 集合内用 1×1 方块，窄抽屉也能整齐两列对齐
  const size: Mirror.Size = 1
  const shape: Mirror.Shape = 'square'
  const direction: Mirror.Direction = 'vertical'

  return (
    <div
      role="list"
      className={styles.magneticTile}
      onClick={function (event) {
        if (!props.onPick) return
        const closest = (event.target as HTMLElement).closest<HTMLElement>('.magnetic-tile')
        if (!closest) return
        const id = closest.getAttribute('data-id')
        if (id) props.onPick(id)
      }}>
      {props.magneticTiles.map(function (value) {
        return (
          <Navigation
            {...value}
            key={value.id}
            size={size}
            shape={shape}
            direction={direction}
            onPrevent={props.onPick ? props.onPrevent : undefined}
            onTrash={
              props.onRemove
                ? function (event) {
                    event.stopPropagation()
                    event.preventDefault()
                    props.onRemove?.(value.id)
                  }
                : undefined
            }
          />
        )
      })}
    </div>
  )
}

export { Controller }
export type { ControllerProps }
