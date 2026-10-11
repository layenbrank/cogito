const ABORT_TIMEOUT_MS = 1000
const DEFAULT_SKELETON_MIN_MS = 200
const DEFAULT_SKELETON_FADE_MS = 200

/** 与 MagneticTile.Component 同步；IPC 字符串校验用 */
const MAGNETIC_TILE_COMPONENTS = [
  'bookmark',
  'code',
  'clock',
  'countdown',
  'calendar',
  'clipchamp',
  'collection',
  'markdown',
  'morph',
  'settings',
  'agent',
  'navigation',
  'marketplace',
  'developer',
  'signboard',
  'gallery',
  'capture',
  'directive',
  'example'
] as const satisfies readonly MagneticTile.Component[]

function isMagneticTileComponent(value: string): value is MagneticTile.Component {
  return (MAGNETIC_TILE_COMPONENTS as readonly string[]).includes(value)
}

export {
  ABORT_TIMEOUT_MS,
  DEFAULT_SKELETON_FADE_MS,
  DEFAULT_SKELETON_MIN_MS,
  MAGNETIC_TILE_COMPONENTS,
  isMagneticTileComponent
}
