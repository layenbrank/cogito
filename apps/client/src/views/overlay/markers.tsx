import { lazy, type ComponentType, type ReactNode } from 'react'

import type { MarkerLayout } from '@/features/magnetic-tile/size'

/** overlay 渲染时保证提供：布局 + 内容字段（不污染纯几何 MarkerLayout） */
interface MarkerRenderProps extends MarkerLayout {
  title: string
  mark: string | null
}

type MarkerModule = { default: ComponentType<MarkerRenderProps> }

function lazyMarker(loader: () => Promise<MarkerModule>) {
  return lazy(loader)
}

const BookmarkMarker = lazyMarker(function () {
  return import('@/features/magnetic-tiles/bookmark/marker')
})
const CalendarMarker = lazyMarker(function () {
  return import('@/features/magnetic-tiles/calendar/marker')
})
const ClockMarker = lazyMarker(function () {
  return import('@/features/magnetic-tiles/clock/marker')
})
const CountdownMarker = lazyMarker(function () {
  return import('@/features/magnetic-tiles/countdown/marker')
})
const CodeMarker = lazyMarker(function () {
  return import('@/features/magnetic-tiles/code/marker')
})
const ClipchampMarker = lazyMarker(function () {
  return import('@/features/magnetic-tiles/clipchamp/marker')
})
const CollectionMarker = lazyMarker(function () {
  return import('@/features/magnetic-tiles/collection/marker')
})
const KnowledgeMarker = lazyMarker(function () {
  return import('@/features/magnetic-tiles/knowledge/marker')
})
const MorphMarker = lazyMarker(function () {
  return import('@/features/magnetic-tiles/morph/marker')
})
const SettingsMarker = lazyMarker(function () {
  return import('@/features/magnetic-tiles/settings/marker')
})
const AgentMarker = lazyMarker(function () {
  return import('@/features/magnetic-tiles/agent/marker')
})
const NavigationMarker = lazyMarker(function () {
  return import('@/features/magnetic-tiles/navigation/marker')
})
const MarketplaceMarker = lazyMarker(function () {
  return import('@/features/magnetic-tiles/marketplace/marker')
})
const DeveloperMarker = lazyMarker(function () {
  return import('@/features/magnetic-tiles/developer/marker')
})
const SignboardMarker = lazyMarker(function () {
  return import('@/features/magnetic-tiles/signboard/marker')
})
const GalleryMarker = lazyMarker(function () {
  return import('@/features/magnetic-tiles/gallery/marker')
})
const CaptureMarker = lazyMarker(function () {
  return import('@/features/magnetic-tiles/capture/marker')
})
const DirectiveMarker = lazyMarker(function () {
  return import('@/features/magnetic-tiles/directive/marker')
})
const ExampleMarker = lazyMarker(function () {
  return import('@/features/magnetic-tiles/example/marker')
})

function bindMarker(
  Marker: ReturnType<typeof lazyMarker>
): (props: MarkerRenderProps) => ReactNode {
  return function render(props) {
    return (
      <Marker
        size={props.size}
        shape={props.shape}
        direction={props.direction}
        title={props.title}
        mark={props.mark}
      />
    )
  }
}

/** 浮层 Marker 映射；client 未实现的组件留空，消费侧兜底 */
const MARKERS: Partial<Record<MagneticTile.Component, (props: MarkerRenderProps) => ReactNode>> = {
  bookmark: bindMarker(BookmarkMarker),
  calendar: bindMarker(CalendarMarker),
  clock: bindMarker(ClockMarker),
  countdown: bindMarker(CountdownMarker),
  code: bindMarker(CodeMarker),
  clipchamp: bindMarker(ClipchampMarker),
  collection: bindMarker(CollectionMarker),
  knowledge: bindMarker(KnowledgeMarker),
  morph: bindMarker(MorphMarker),
  settings: bindMarker(SettingsMarker),
  agent: bindMarker(AgentMarker),
  navigation: bindMarker(NavigationMarker),
  marketplace: bindMarker(MarketplaceMarker),
  developer: bindMarker(DeveloperMarker),
  signboard: bindMarker(SignboardMarker),
  gallery: bindMarker(GalleryMarker),
  capture: bindMarker(CaptureMarker),
  directive: bindMarker(DirectiveMarker),
  example: bindMarker(ExampleMarker)
}

function RenderMarker(component: MagneticTile.Component, props: MarkerRenderProps): ReactNode {
  const Marker = MARKERS[component]
  return Marker ? Marker(props) : null
}

export { MARKERS, RenderMarker }
export type { MarkerRenderProps }
