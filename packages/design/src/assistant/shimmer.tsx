/* motion 组件按标签缓存在模块级 Map 里（同一个 tag 只 create 一次），React 编译器规则看不到缓存。 */
/* eslint-disable react-hooks/static-components */
import type { MotionProps } from 'motion/react'
import { cn } from 'cn'
import { motion } from 'motion/react'
import type { CSSProperties, ElementType, JSX } from 'react'
import { memo, useMemo } from 'react'

type MotionHTMLProps = MotionProps & Record<string, unknown>

// Cache motion components at module level to avoid creating during render
const motionComponentCache = new Map<
  keyof JSX.IntrinsicElements,
  React.ComponentType<MotionHTMLProps>
>()

const getMotionComponent = (element: keyof JSX.IntrinsicElements) => {
  let component = motionComponentCache.get(element)
  if (!component) {
    component = motion.create(element)
    motionComponentCache.set(element, component)
  }
  return component
}

export interface TextShimmerProps {
  children: string
  as?: ElementType
  className?: string
  duration?: number
  spread?: number
}

const ShimmerComponent = ({
  children,
  as: Component = 'p',
  className,
  duration = 2,
  spread = 2
}: TextShimmerProps) => {
  // 同一 tag 复用模块级缓存的 motion 组件（create 只发生一次，memo 让引用稳定）
  const MotionComponent = useMemo(
    () => getMotionComponent(Component as keyof JSX.IntrinsicElements),
    [Component]
  )

  const dynamicSpread = useMemo(() => (children?.length ?? 0) * spread, [children, spread])

  return (
    <MotionComponent
      animate={{ backgroundPosition: '0% center' }}
      className={cn(
        'relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent',
        '[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--color-background),#0000_calc(50%+var(--spread)))] [background-repeat:no-repeat,padding-box]',
        className
      )}
      initial={{ backgroundPosition: '100% center' }}
      style={
        {
          '--spread': `${dynamicSpread}px`,
          backgroundImage:
            'var(--bg), linear-gradient(var(--color-muted-foreground), var(--color-muted-foreground))'
        } as CSSProperties
      }
      transition={{
        duration,
        ease: 'linear',
        repeat: Number.POSITIVE_INFINITY
      }}>
      {children}
    </MotionComponent>
  )
}

export const Shimmer = memo(ShimmerComponent)
