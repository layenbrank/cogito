/**
 * 磁贴种类表：`component` → 运行时能力（能否在扩展里打开、图标、文案）。
 *
 * ## 为什么要有这张表
 *
 * client 有 19 种磁贴，扩展会一种一种补上来。如果把 `tile.component === 'xxx'` 散落在
 * 渲染层、激活层、菜单里，每加一种要改三四遍，而且最容易漏的是「点击后去哪」——
 * 漏了的表现是「点了没反应」或「被送到 /overview」。
 *
 * 所以这里是唯一事实源：**新增一种磁贴 = 在这张表里加一行 + 写它的组件**。
 * `path: null` 不是「缺省」，而是明确表态「这种能力只有桌面端有」，激活时如实提示。
 */

import type { ComponentProps } from 'react'

import type { Glyph } from '@/features/shell/glyph.tsx'

type GlyphName = ComponentProps<typeof Glyph>['name']

interface TileKind {
  /** 扩展内路由；`null` = 这种磁贴要靠桌面端打开 */
  path: string | null
  icon: GlyphName
  label: string
}

/** 尚未补齐的桌面端磁贴：统一走「桌面端打开」的提示，而不是假装成普通链接 */
function findDesktopOnlyKind(label: string): TileKind {
  return { path: null, icon: 'grid', label }
}

const TILE_KINDS: Partial<Record<MagneticTile.Component, TileKind>> = {
  agent: { path: '/agent/chat', icon: 'sparkles', label: '对话' },
  bookmark: { path: '/bookmarks', icon: 'bookmark', label: '书签' },
  settings: { path: '/settings', icon: 'settings', label: '设置' },
  // 下面这些是 client 已有、扩展还没做的：先如实标注，别渲染成能点但没用
  knowledge: { ...findDesktopOnlyKind('知识库'), icon: 'library' },
  clock: { path: '/clock', icon: 'grid', label: '时钟' },
  calendar: { path: '/calendar', icon: 'grid', label: '日历' },
  countdown: { path: '/countdown', icon: 'grid', label: '倒计时' },
  signboard: findDesktopOnlyKind('看板'),
  directive: findDesktopOnlyKind('指令'),
  gallery: { path: '/gallery', icon: 'grid', label: '图库' },
  capture: findDesktopOnlyKind('截屏'),
  wallpaper: { path: '/wallpaper', icon: 'grid', label: '壁纸库' },
  code: { ...findDesktopOnlyKind('代码'), icon: 'terminal' },
  morph: findDesktopOnlyKind('Morph'),
  clipchamp: findDesktopOnlyKind('剪辑'),
  marketplace: { path: '/marketplace', icon: 'grid', label: '商店' },
  example: findDesktopOnlyKind('示例')
}

/** 查表；未收录的种类按「桌面端能力」处理（不猜路由） */
function findTileKind(component: MagneticTile.Component): TileKind {
  return TILE_KINDS[component] ?? findDesktopOnlyKind('桌面端磁贴')
}

interface CreatableKind {
  component: MagneticTile.Component
  label: string
  hint: string
}

/**
 * 扩展里**能新建**的磁贴种类：磁贴库（挑选面板）与新建对话框共用这一份。
 *
 * 只列真能打开 / 真能渲染的：列一个点进去没反应的，比不列更糟。
 * 加一种磁贴 = 这里加一行 + `TILE_KINDS` 加一行 + 写它的组件。
 */
const TILE_CREATABLE: readonly CreatableKind[] = [
  { component: 'navigation', label: '网址', hint: '双击打开链接' },
  { component: 'agent', label: '对话', hint: '打开 Cogito 对话' },
  { component: 'calendar', label: '日历', hint: '当月日历，今天高亮' },
  { component: 'bookmark', label: '书签', hint: '浏览器书签' },
  { component: 'settings', label: '设置', hint: '外观与账号' }
]

/** 扩展内能直接打开的种类（菜单 / 添加入口用） */
function findOpenableKinds(): Array<{ component: MagneticTile.Component; kind: TileKind }> {
  const openable: Array<{ component: MagneticTile.Component; kind: TileKind }> = []
  for (const [component, kind] of Object.entries(TILE_KINDS)) {
    if (!kind || kind.path === null) continue
    openable.push({ component: component as MagneticTile.Component, kind })
  }
  return openable
}

export { TILE_CREATABLE, TILE_KINDS, findOpenableKinds, findTileKind }
export type { CreatableKind, TileKind }
