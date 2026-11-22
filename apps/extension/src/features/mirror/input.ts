/** 新增磁贴时表单 / 固定当前页共用的字段 */
export interface MagneticTileInput {
  title: string
  url: string
  size: MagneticTile.Size
  shape: MagneticTile.Shape
  direction: MagneticTile.Direction
  mark?: string | null
  component?: MagneticTile.Component
}

export interface InsertOptions {
  /** 同一镜像里已有相同链接时跳过（右键固定、书签加入） */
  skipSameUrl?: boolean
}
