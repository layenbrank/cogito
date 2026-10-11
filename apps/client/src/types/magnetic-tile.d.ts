import type { JSX } from 'react'

declare global {
  namespace MagneticTile {
    // interface ComponentProps extends Partial<MagneticTile> {
    // draggable: boolean
    // className: ClassValue
    // }

    // type Reflection = Record<Component, (props: ComponentProps) => JSX.Element>
    /**
     * 组件 → 渲染器。Partial：个别组件尚未接入时跳过
     * （消费侧已按 undefined 兜底，不再要求补齐全量键）。
     */
    type Reflection = Partial<
      Record<
        MagneticTile.Component,
        React.LazyExoticComponent<(props: ProviderProps) => JSX.Element>
      >
    >
  }
}
