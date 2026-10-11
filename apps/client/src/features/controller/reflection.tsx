import React from 'react'

const Bookmark = React.lazy(function () {
  return import('@/features/magnetic-tiles/bookmark/bookmark.tsx')
})
const Calendar = React.lazy(function () {
  return import('@/features/magnetic-tiles/calendar/calendar.tsx')
})
const Clock = React.lazy(function () {
  return import('@/features/magnetic-tiles/clock/clock.tsx')
})
const Countdown = React.lazy(function () {
  return import('@/features/magnetic-tiles/countdown/countdown.tsx')
})
const Collection = React.lazy(function () {
  return import('@/features/magnetic-tiles/collection/collection.tsx')
})
const Code = React.lazy(function () {
  return import('@/features/magnetic-tiles/code/code.tsx')
})
const Developer = React.lazy(function () {
  return import('@/features/magnetic-tiles/developer/developer.tsx')
})
const Example = React.lazy(function () {
  return import('@/features/magnetic-tiles/example/example.tsx')
})
const Agent = React.lazy(function () {
  return import('@/features/magnetic-tiles/agent/agent.tsx')
})
const Morph = React.lazy(function () {
  return import('@/features/magnetic-tiles/morph/morph.tsx')
})
const Markdown = React.lazy(function () {
  return import('@/features/magnetic-tiles/markdown/markdown.tsx')
})
const Navigation = React.lazy(function () {
  return import('@/features/magnetic-tiles/navigation/navigation.tsx')
})
const Settings = React.lazy(function () {
  return import('@/features/magnetic-tiles/settings/settings.tsx')
})
const Clipchamp = React.lazy(function () {
  return import('@/features/magnetic-tiles/clipchamp/clipchamp.tsx')
})
const Marketplace = React.lazy(function () {
  return import('@/features/magnetic-tiles/marketplace/marketplace.tsx')
})

const Gallery = React.lazy(function () {
  return import('@/features/magnetic-tiles/gallery/gallery.tsx')
})
const Signboard = React.lazy(function () {
  return import('@/features/magnetic-tiles/signboard/signboard.tsx')
})
const Capture = React.lazy(function () {
  return import('@/features/magnetic-tiles/capture/capture.tsx')
})
const Directive = React.lazy(function () {
  return import('@/features/magnetic-tiles/directive/directive.tsx')
})

const Reflection: Readonly<MagneticTile.Reflection> = {
  bookmark: Bookmark,
  calendar: Calendar,
  code: Code,
  clipchamp: Clipchamp,
  clock: Clock,
  countdown: Countdown,
  agent: Agent,
  settings: Settings,
  navigation: Navigation,
  markdown: Markdown,
  morph: Morph,
  marketplace: Marketplace,
  developer: Developer,
  example: Example,
  collection: Collection,
  gallery: Gallery,
  signboard: Signboard,
  capture: Capture,
  directive: Directive
}

export {
  Bookmark,
  Calendar,
  Capture,
  Clipchamp,
  Clock,
  Code,
  Collection,
  Countdown,
  Developer,
  Directive,
  Example,
  Gallery,
  Agent,
  Markdown,
  Marketplace,
  Navigation,
  Reflection,
  Settings,
  Signboard
}

// const Applications = import.meta.glob<(props: ProviderProps) => JSX.Element>(
// 	'@/features/magnetic-tiles/*/index.tsx',
// 	{
// 		eager: true,
// 		import: 'default'
// 	}
// )
// console.log('Applications', Applications)
// const Reflection: Readonly<MagneticTile.Reflection> = Object.entries(Applications).reduce(
// 	(ref, [, component]) => {
// 		const name = component.name.toLowerCase() as keyof MagneticTile.Reflection
// 		ref[name] = component
// 		return ref
// 	},
// 	{} as MagneticTile.Reflection
// )
// console.log('Reflection', Reflection)
