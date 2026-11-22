import { createContext, useContext, useMemo, type ReactNode } from 'react'

type EnterValue = {
  isActive: boolean
  index: number
}

const ENTER_IDLE: EnterValue = {
  isActive: false,
  index: 0
}

const EnterContext = createContext<EnterValue>(ENTER_IDLE)

type EnterProps = {
  children: ReactNode
  /** 装配序号。入场不再按序号错开，视口内的磁贴同时播放 */
  index?: number
  /** 默认 true；冷启动后置 false 跳过入场 */
  isActive?: boolean
}

/**
 * 磁贴入场唯一入口：由 Controller 等装配层声明，Section surface 消费。
 * 包一层即启用；未包则默认无入场（浮层等复用方不受影响）。
 */
function Enter(props: EnterProps) {
  const isActive = props.isActive ?? true
  const value = useMemo(
    function () {
      return {
        isActive,
        index: props.index ?? 0
      } satisfies EnterValue
    },
    [props.index, isActive]
  )
  return <EnterContext value={value}>{props.children}</EnterContext>
}

function useEnter() {
  return useContext(EnterContext)
}

export { Enter, EnterContext, useEnter }
export type { EnterProps, EnterValue }
