import { z } from 'zod'

import type { ChannelOfDomain } from '@/shared/ipc/channels'
import { CHANNELS } from '@/shared/ipc/channels'
import type { ChannelSpec } from '@/shared/ipc/spec'

/** 表面样式（背景/景深），镜像与磁贴共用结构 */
const Background = z.object({
  color: z.string().optional(),
  image: z.string().optional(),
  repeat: z.string().optional(),
  size: z.string().optional(),
  position: z.string().optional(),
  attachment: z.string().optional(),
  clip: z.string().optional(),
  blendMode: z.string().optional(),
  origin: z.string().optional()
})

const Backdrop = z.object({
  blur: z.string().optional(),
  brightness: z.string().optional(),
  contrast: z.string().optional(),
  dropShadow: z.string().optional(),
  grayscale: z.string().optional(),
  hueRotate: z.string().optional(),
  opacity: z.string().optional(),
  saturate: z.string().optional(),
  sepia: z.string().optional(),
  url: z.string().optional()
})

// ===== mirror（镜像桌面） =====

/** 完整镜像实体（时间戳为毫秒整数，与 Rust/Tauri 版一致） */
const Mirror = z.object({
  id: z.string(),
  title: z.string(),
  index: z.number().int(),
  mark: z.string(),
  updatedAt: z.number(),
  createdAt: z.number(),
  description: z.string(),
  background: Background.nullable(),
  backdrop: Backdrop.nullable(),
  overlay: z.string(),
  archivedAt: z.number().nullable()
})

/** 查询过滤（对齐 shared `Mirror.Read`） */
const MirrorRead = z
  .object({
    id: z.string().optional(),
    title: z.string().optional(),
    mark: z.string().optional()
  })
  .optional()

/** 写入参数：不含自动生成的 id / createdAt / updatedAt / archivedAt */
const MirrorWrite = z.object({
  title: z.string(),
  index: z.number().int(),
  mark: z.string(),
  description: z.string(),
  background: Background.nullable(),
  backdrop: Backdrop.nullable(),
  overlay: z.string()
})

/** 更新参数：除 id 外所有字段可选（studio 域风格 `{ id, ...partial }`） */
const MirrorUpdate = z.object({
  id: z.string(),
  title: z.string().optional(),
  index: z.number().int().optional(),
  mark: z.string().optional(),
  description: z.string().optional(),
  background: Background.nullable().optional(),
  backdrop: Backdrop.nullable().optional(),
  overlay: z.string().optional()
})

const MirrorRemove = z.object({ id: z.string() })

// ===== mirror.tile（磁贴，挂在镜像下） =====

/** 尺寸档位（对齐 shared `MagneticTile.Size`；未来扩 5-7 时同步上探） */
const SIZE = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])

const SHAPE = z.enum(['square', 'circle', 'rectangle'])

const DIRECTION = z.enum(['horizontal', 'vertical'])

/** 组件名白名单（与 constants/magnetic-tile/components 同步） */
const COMPONENT = z.enum([
  'bookmark',
  'code',
  'clock',
  'countdown',
  'calendar',
  'clipchamp',
  'collection',
  'knowledge',
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
])

/** 完整磁贴实体 */
const Tile = z.object({
  id: z.string(),
  index: z.number().int(),
  title: z.string(),
  url: z.string().nullable(),
  round: z.string().nullable(),
  mark: z.string().nullable(),
  size: SIZE,
  shape: SHAPE,
  direction: DIRECTION,
  mirrorID: z.string(),
  updatedAt: z.number(),
  createdAt: z.number(),
  textColor: z.string().nullable(),
  component: COMPONENT,
  description: z.string(),
  collectionID: z.string().nullable(),
  downloadCount: z.number().int(),
  background: Background.nullable(),
  backdrop: Backdrop.nullable(),
  archivedAt: z.number().nullable()
})

/** 查询过滤（对齐 shared `MagneticTile.Read`，含 `mirrorID` 以支持多镜像桌面） */
const TileRead = z
  .object({
    id: z.string().optional(),
    title: z.string().optional(),
    url: z.string().nullable().optional(),
    description: z.string().optional(),
    mirrorID: z.string().optional(),
    downloadCount: z.number().int().optional(),
    size: SIZE.optional(),
    shape: SHAPE.optional(),
    direction: DIRECTION.optional(),
    updatedAt: z.number().optional(),
    collectionID: z.string().nullable().optional()
  })
  .optional()

/** 写入参数：不含自动生成的 id / createdAt / updatedAt / downloadCount / archivedAt */
const TileWrite = z.object({
  index: z.number().int(),
  title: z.string(),
  url: z.string().nullable(),
  round: z.string().nullable(),
  mark: z.string().nullable(),
  size: SIZE,
  shape: SHAPE,
  direction: DIRECTION,
  mirrorID: z.string(),
  textColor: z.string().nullable(),
  component: COMPONENT,
  description: z.string(),
  collectionID: z.string().nullable(),
  background: Background.nullable(),
  backdrop: Backdrop.nullable()
})

/** 更新参数：除 id 外所有字段可选 */
const TileUpdate = z.object({
  id: z.string(),
  index: z.number().int().optional(),
  title: z.string().optional(),
  url: z.string().nullable().optional(),
  round: z.string().nullable().optional(),
  mark: z.string().nullable().optional(),
  size: SIZE.optional(),
  shape: SHAPE.optional(),
  direction: DIRECTION.optional(),
  mirrorID: z.string().optional(),
  textColor: z.string().nullable().optional(),
  component: COMPONENT.optional(),
  description: z.string().optional(),
  collectionID: z.string().nullable().optional(),
  downloadCount: z.number().int().optional(),
  background: Background.nullable().optional(),
  backdrop: Backdrop.nullable().optional(),
  archivedAt: z.number().nullable().optional()
})

const TileRemove = z.object({ id: z.string() })

export const mirrorSpecs = {
  [CHANNELS.MIRROR.READ]: { in: MirrorRead, out: z.array(Mirror) },
  [CHANNELS.MIRROR.WRITE]: { in: MirrorWrite, out: Mirror },
  [CHANNELS.MIRROR.UPDATE]: { in: MirrorUpdate, out: Mirror },
  [CHANNELS.MIRROR.REMOVE]: { in: MirrorRemove, out: z.void() },
  [CHANNELS.MIRROR.TILE.READ]: { in: TileRead, out: z.array(Tile) },
  [CHANNELS.MIRROR.TILE.WRITE]: { in: TileWrite, out: Tile },
  [CHANNELS.MIRROR.TILE.UPDATE]: { in: TileUpdate, out: Tile },
  [CHANNELS.MIRROR.TILE.REMOVE]: { in: TileRemove, out: z.void() }
} as const satisfies Record<ChannelOfDomain<'mirror'>, ChannelSpec>

export {
  Backdrop,
  Background,
  COMPONENT,
  DIRECTION,
  Mirror,
  MirrorRead,
  MirrorRemove,
  MirrorUpdate,
  MirrorWrite,
  SHAPE,
  SIZE,
  Tile,
  TileRead,
  TileRemove,
  TileUpdate,
  TileWrite
}
