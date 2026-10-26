/**
 * @description Magnetic Tiles（磁贴）
 */
interface MagneticTile {
  id: string
  index: number
  title: string
  url: string | null
  round: string | null
  mark: string | null
  size: MagneticTile.Size
  shape: MagneticTile.Shape
  direction: MagneticTile.Direction
  mirrorID: string
  updatedAt: number
  createdAt: number
  textColor: string | null
  component: MagneticTile.Component
  description: string
  collectionID: string | null
  downloadCount: number
  background: MagneticTile.Background | null
  backdrop: MagneticTile.Backdrop | null
  archivedAt: number | null
}

declare namespace MagneticTile {
  type Collection = Omit<MagneticTile, 'mirrorID'>

  /**
   * @description 组件布局方向
   */
  type Direction = 'horizontal' | 'vertical'

  /**
   * @description 组件形状
   */
  type Shape = 'square' | 'circle' | 'rectangle'

  /**
   * @description 组件尺寸
   */
  type Size = 1 | 2 | 3 | 4
  // type Size = 1 | 2 | 3 | 4 | 5 | 6 | 7

  /**
   * @description 组件名称
   */
  type Component =
    | 'bookmark'
    | 'code'
    | 'clock'
    | 'countdown'
    | 'calendar'
    | 'clipchamp'
    | 'collection'
    | 'knowledge' // 知识库（原 markdown 磁贴）
    | 'morph'
    | 'settings'
    | 'navigation'
    | 'marketplace'
    | 'developer'
    | 'signboard'
    | 'gallery' // 图库
    | 'capture' // 截屏
    | 'directive' // 指令
    | 'agent' // 智能体（原 intelligence）
    | 'example'

  interface Backdrop {
    blur?: string
    brightness?: string
    contrast?: string
    dropShadow?: string
    grayscale?: string
    hueRotate?: string
    opacity?: string
    saturate?: string
    sepia?: string
    url?: string
  }

  interface Background {
    color?: string
    image?: string
    repeat?: string
    size?: string
    position?: string
    attachment?: string
    clip?: string
    blendMode?: string
    origin?: string
  }

  /**
   * 写入参数：不含自动生成的 id / createdAt / updatedAt
   * Rust Write 结构体中无 downloadCount，此处同步排除
   */
  type Write = Omit<MagneticTile, 'id' | 'createdAt' | 'updatedAt' | 'downloadCount' | 'archivedAt'>

  /** 查询过滤参数：仅限 Rust Read 结构体暴露的字段 */
  type Read = Partial<
    Pick<
      MagneticTile,
      | 'id'
      | 'title'
      | 'url'
      | 'description'
      | 'mirrorID'
      | 'downloadCount'
      | 'size'
      | 'shape'
      | 'direction'
      | 'updatedAt'
      | 'collectionID'
    >
  >

  /** 更新变更字段：除 id 外所有字段均可选 */
  type Change = Partial<Omit<MagneticTile, 'id'>>

  /** 更新请求体 */
  interface Update {
    key: string
    change: MagneticTile.Change
  }
}
