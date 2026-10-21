import { cn } from 'cn'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'

import { useAppReducedMotion } from '@i-thinking/design/hooks/use-app-reduced-motion'
import { DIGIT_OFFSET, DIGIT_TRANSITION } from '@i-thinking/design/lib/motion'

interface AnimatedDigitsProps {
  /** 变化时作为 AnimatePresence key；未变则不动效 */
  value: string | number
  children: ReactNode
  /** 翻页方向：1 向后（从下入），-1 向前 */
  slideDir?: 1 | -1
  /** 错落入场延迟（秒），仅进场 */
  delay?: number
  className?: string
}

/**
 * 单段数字 / 文案切换：进出叠化，时长跟 `DIGIT_TRANSITION`。
 * 多段日期请拆开各自挂本组件，避免整串一起翻。
 * 减动效时直接切内容。
 */
function AnimatedDigits(props: AnimatedDigitsProps) {
  const isReduced = useAppReducedMotion()
  const dir = props.slideDir ?? 1
  const delay = props.delay ?? 0
  const offset = DIGIT_OFFSET

  if (isReduced) {
    return <span className={cn('tabular-nums', props.className)}>{props.children}</span>
  }

  return (
    <span
      className={cn(
        'relative inline-flex h-[1.25em] items-center justify-center overflow-hidden tabular-nums',
        props.className
      )}>
      <AnimatePresence
        mode="popLayout"
        initial={false}>
        <motion.span
          key={String(props.value)}
          initial={{ opacity: 0, y: dir * offset }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: dir * -offset }}
          transition={{
            y: { ...DIGIT_TRANSITION, delay },
            // 透明度略快收尾，避免进出叠化发糊
            opacity: { ...DIGIT_TRANSITION, duration: 0.24, delay }
          }}
          className="inline-block leading-none will-change-transform">
          {props.children}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

export { AnimatedDigits }
export type { AnimatedDigitsProps }
