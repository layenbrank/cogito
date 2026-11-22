import React, { lazy } from 'react'

const Bookmark = lazy(function () {
  return import('@/features/magnetic-tiles/bookmark/bookmark.tsx')
})
const Calendar = lazy(function () {
  return import('@/features/magnetic-tiles/calendar/calendar.tsx')
})
const Clock = lazy(function () {
  return import('@/features/magnetic-tiles/clock/clock.tsx')
})
const Countdown = lazy(function () {
  return import('@/features/magnetic-tiles/countdown/countdown.tsx')
})
const Collection = lazy(function () {
  return import('@/features/magnetic-tiles/collection/collection.tsx')
})
const Code = lazy(function () {
  return import('@/features/magnetic-tiles/code/code.tsx')
})
const Example = lazy(function () {
  return import('@/features/magnetic-tiles/example/example.tsx')
})
const Agent = lazy(function () {
  return import('@/features/magnetic-tiles/agent/agent.tsx')
})
const Morph = lazy(function () {
  return import('@/features/magnetic-tiles/morph/morph.tsx')
})
const Knowledge = lazy(function () {
  return import('@/features/magnetic-tiles/knowledge/knowledge.tsx')
})
const Navigation = lazy(function () {
  return import('@/features/magnetic-tiles/navigation/navigation.tsx')
})
const Settings = lazy(function () {
  return import('@/features/magnetic-tiles/settings/settings.tsx')
})
const Clipchamp = lazy(function () {
  return import('@/features/magnetic-tiles/clipchamp/clipchamp.tsx')
})
const Marketplace = lazy(function () {
  return import('@/features/magnetic-tiles/marketplace/marketplace.tsx')
})
const Gallery = lazy(function () {
  return import('@/features/magnetic-tiles/gallery/gallery.tsx')
})
const Signboard = lazy(function () {
  return import('@/features/magnetic-tiles/signboard/signboard.tsx')
})
const Capture = lazy(function () {
  return import('@/features/magnetic-tiles/capture/capture.tsx')
})
const Directive = lazy(function () {
  return import('@/features/magnetic-tiles/directive/directive.tsx')
})
const Wallpaper = lazy(function () {
  return import('@/features/magnetic-tiles/wallpaper/wallpaper.tsx')
})

const Reflection: Partial<Record<MagneticTile.Component, React.LazyExoticComponent<React.ComponentType<MagneticTile>>>> = {
  bookmark: Bookmark,
  calendar: Calendar,
  code: Code,
  clipchamp: Clipchamp,
  clock: Clock,
  countdown: Countdown,
  agent: Agent,
  settings: Settings,
  navigation: Navigation,
  knowledge: Knowledge,
  morph: Morph,
  marketplace: Marketplace,
  example: Example,
  collection: Collection,
  gallery: Gallery,
  signboard: Signboard,
  capture: Capture,
  wallpaper: Wallpaper,
  directive: Directive
}

export { Reflection }
