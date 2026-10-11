type GraphicsEnum =
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'text'
  | 'freehand'
  | 'mosaic'
  | 'index'
  | 'highlight'
  | 'spotlight'
  | 'blur'

interface Point {
  x: number
  y: number
}

interface GraphicsProps {
  id: string
  type: GraphicsEnum
  points: Point[]
  color: string
  thickness: number
  text?: string
  fontSize?: number
  /** 文字标注宽度（可通过 Transformer 调整） */
  width?: number
  /** 序号标记的数字 */
  index?: number
  /** 是否填充 */
  filled?: boolean
  /** 透明度（0~1） */
  opacity?: number
  /** 旋转角度（度），由 Transformer 写入 */
  rotation?: number
  /** 锁定后不可点选 / 拖拽（仍可右键解锁） */
  locked?: boolean
  /** 同组标注共享此 id；无则未成组 */
  groupID?: string
  /** 马赛克 / 模糊所需的底图：用于在指定区域采样并应用滤镜 */
  sourceImage?: HTMLImageElement
}

export type { GraphicsEnum, GraphicsProps, Point }
