import { Icon } from '@iconify/react/offline'
import type { CSSProperties } from 'react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

import { cn } from 'cn'

/**
 * 正文样式：`git commit` / 构建这类操作的输出动辄十几行，提示不封顶会被撑到半屏高。
 * 这里给正文加高度上限，超出的部分在框内滚动 —— 信息不丢，版面也不塌。
 * `whitespace-pre-wrap` 让原始换行生效，否则多行输出会挤成一大段。
 */
const TOAST_BODY_CLASS = 'max-h-40 overflow-y-auto whitespace-pre-wrap break-words'

/**
 * Toaster —— 通知层（替代 antd 的 `message` / `notification`）。
 *
 * - 颜色走本仓 token（`--popover` / `--border` / `--radius`），随 `.dark` 自动切换
 * - 不引入 next-themes，也不注入主题状态：颜色已由 token 决定，`theme` 交给消费方按需传
 */
function Toaster({ className, toastOptions, ...props }: ToasterProps) {
  return (
    <Sonner
      className={cn('toaster group', className)}
      icons={{
        success: (
          <Icon
            icon="lucide:circle-check"
            className="size-4"
          />
        ),
        info: (
          <Icon
            icon="lucide:info"
            className="size-4"
          />
        ),
        warning: (
          <Icon
            icon="lucide:triangle-alert"
            className="size-4"
          />
        ),
        error: (
          <Icon
            icon="lucide:octagon-x"
            className="size-4"
          />
        ),
        loading: (
          <Icon
            icon="lucide:loader-circle"
            className="size-4 animate-spin"
          />
        )
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)'
        } as CSSProperties
      }
      toastOptions={{
        ...toastOptions,
        classNames: {
          title: TOAST_BODY_CLASS,
          description: TOAST_BODY_CLASS,
          ...toastOptions?.classNames
        }
      }}
      {...props}
    />
  )
}

export { Toaster }
