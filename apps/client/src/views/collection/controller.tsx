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

  /** 卡片自身已处理点击，这里只靠事件委托按 data-id 选贴；Enter/空格与点击等价 */
  function pickFromEvent(
    event: React.SyntheticEvent<HTMLUListElement>,
    allowed: boolean
  ): void {
    if (!allowed) return
    const closest = (event.target as HTMLElement).closest<HTMLElement>('.magnetic-tile')
    if (!closest) return
    const id = closest.getAttribute('data-id')
    if (id) props.onPick?.(id)
  }

  return (
    <ul
      role="toolbar"
      aria-label="集合内容"
      className={styles.magneticTile}
      onClick={function (event) {
        pickFromEvent(event, Boolean(props.onPick))
      }}
      onKeyDown={function (event) {
        if (event.key !== 'Enter' && event.key !== ' ') return
        pickFromEvent(event, Boolean(props.onPick))
      }}>
      {props.magneticTiles.map(function (value) {
        return (
          <li
            key={value.id}
            className="contents">
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
          </li>
        )
      })}
    </ul>
  )
}

export { Controller }
export type { ControllerProps }
