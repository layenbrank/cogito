import { useMemo } from 'react'

import Collection from '@/features/magnetic-tiles/collection/collection.tsx'
import Navigation from '@/features/magnetic-tiles/navigation/navigation.tsx'
import { ContextMenu } from '@/components/contextmenu'
import type { MenuItem } from '@/components/contextmenu'
import styles from '@/views/collection/controller.module.scss'

interface ControllerProps {
  magneticTiles: readonly MagneticTile[]
  /** 选贴 / 钻入子文件夹：点击卡片回调 */
  onPick?: (id: string) => void
  /** 阻止 navigation Section 双击外跳（选贴模式） */
  onPrevent?: React.MouseEventHandler<HTMLDivElement>
  /** 成员移出集合 */
  onRemove?: (id: string) => void
  /** 主内容区宽松；侧栏选贴用紧凑 */
  density?: 'comfortable' | 'compact'
}

function Controller(props: ControllerProps) {
  const density = props.density ?? 'comfortable'
  // 集合内用 1×1 方块，网格对齐稳定
  const size: Mirror.Size = 1
  const shape: Mirror.Shape = 'square'
  const direction: Mirror.Direction = 'vertical'

  /** 卡片自身已处理点击，这里只靠事件委托按 data-id 选贴；Enter/空格与点击等价 */
  function pickFromEvent(
    event: React.SyntheticEvent<HTMLDivElement>,
    allowed: boolean
  ): void {
    if (!allowed) return
    const closest = (event.target as HTMLElement).closest<HTMLElement>('.magnetic-tile')
    if (!closest) return
    const id = closest.getAttribute('data-id')
    if (id) props.onPick?.(id)
  }

  /** 子集合排最前，其余按 index；只在成员变化时重排（渲染跟着选贴 / 弹窗走，不必每次排） */
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
    <ContextMenu
      trigger=".magnetic-tile"
      findItems={function (el) {
        const id = el.getAttribute('data-id')
        if (!id) return []
        const items: MenuItem[] = []
        if (props.onPick) {
          items.push({
            key: 'open',
            label: '打开',
            onSelect: function () {
              props.onPick?.(id)
            }
          })
        }
        if (props.onRemove) {
          items.push({
            key: 'remove',
            label: '移出集合',
            danger: true,
            onSelect: function () {
              props.onRemove?.(id)
            }
          })
        }
        return items
      }}>
      <div
        role="toolbar"
        aria-label="集合内容"
        data-density={density}
        className={styles.magneticTile}
        onClick={function (event) {
          pickFromEvent(event, Boolean(props.onPick))
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
              // 子文件夹：单击钻入，禁止双击再跳转新页
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
            // 网址仍双击外跳；选贴模式才拦截
            onPrevent={props.onPrevent}
          />
        )
      })}
      </div>
    </ContextMenu>
  )
}

export { Controller }
export type { ControllerProps }
