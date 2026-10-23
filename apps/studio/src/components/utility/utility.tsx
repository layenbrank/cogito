import { Button } from '@cogito/design/components/button'
import { Icon } from '@iconify/react/offline'
import { clsx } from 'clsx'
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react'

import styles from './utility.module.scss'

/** 余下的 button 属性一律透传给底层按钮：下拉/工具提示触发器要把自己的 aria/data-state 挂在它身上 */
interface UtilityButtonProps extends Omit<
  ComponentPropsWithoutRef<'button'>,
  'aria-label' | 'title'
> {
  /** 离线 Iconify 图标名；不传则渲染 `children`（头像这类非图形内容） */
  icon?: string
  /** 无障碍标签与原生 title */
  label: string
}

/**
 * 标题栏图标按钮：方形、与标题栏同高，且必须在拖拽区之外（data-region=false）。
 *
 * 显式 `forwardRef`：`render` 触发器要拿到真实 DOM 节点当锚点（见 `tooltip-icon-button`）。
 */
const UtilityButton = forwardRef<HTMLButtonElement, UtilityButtonProps>(function (props, ref) {
  const { icon, label, className, children, ...rest } = props

  return (
    <Button
      variant="ghost"
      size="icon"
      data-region="false"
      className={clsx(styles.button, className)}
      aria-label={label}
      title={label}
      ref={ref}
      {...rest}>
      {icon ? <Icon icon={icon}></Icon> : children}
    </Button>
  )
})

interface UtilityProps {
  /** 本窗口的动作按钮 —— 每个窗口的操作各不相同，故由调用方传入 */
  children?: ReactNode
  className?: string
}

/**
 * 无边框窗口标题栏的通用外壳：整条是拖拽区（`data-region="true"`），
 * 左侧放调用方传入的动作按钮。**组件自身不含任何动作**。
 *
 * 高度取 `env(titlebar-area-height)`（对齐 window 插件的 `titleBarOverlay`），
 * 右侧 padding 给原生窗口控制按钮让位；要换纵向填充高度就在祖先元素上覆写
 * `--utility-height`。
 */
function Utility(props: UtilityProps) {
  return (
    <header
      data-region="true"
      className={clsx(styles.utility, props.className)}>
      <div className={styles.group}>{props.children}</div>
    </header>
  )
}

export { UtilityButton }
export default Utility
export type { UtilityButtonProps }
