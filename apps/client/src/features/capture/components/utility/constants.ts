import { type GraphicsEnum } from '@/features/capture/components/graphics'

interface UtilityOption {
  type: GraphicsEnum
  label: string
  icon: string
}

/** 支持「填充」开关的形状（仅闭合矩形/椭圆） */
const FILLABLE_GRAPHICS = new Set<GraphicsEnum>(['rect', 'ellipse'])
/** 支持「字号」滑块的形状 */
const FONTSIZE_GRAPHICS = new Set<GraphicsEnum>(['text', 'index'])
/** 不参与透明度调整的形状（模糊/马赛克/聚光灯的视觉语义不应被改） */
const NON_OPACITY_GRAPHICS = new Set<GraphicsEnum>(['mosaic', 'blur', 'spotlight'])
/** 主题主色锚点：取应用默认主色（与 capture 默认标注色一致） */
const THEME_PRIMARY = '#4080ff'

const UTILITIES: UtilityOption[] = [
  { type: 'rect', label: '矩形', icon: 'mdi:rectangle-outline' },
  { type: 'ellipse', label: '圆形', icon: 'mdi:circle-outline' },
  { type: 'arrow', label: '箭头', icon: 'mdi:arrow-top-right-thin' },
  { type: 'line', label: '线条', icon: 'mdi:minus' },
  { type: 'text', label: '文字', icon: 'mdi:format-text' },
  { type: 'freehand', label: '画笔', icon: 'mdi:draw' },
  { type: 'mosaic', label: '马赛克', icon: 'mdi:meteor' },
  { type: 'index', label: '序号', icon: 'mdi:numeric' },
  { type: 'highlight', label: '荧光笔', icon: 'mdi:marker' },
  { type: 'blur', label: '模糊', icon: 'mdi:blur' },
  { type: 'spotlight', label: '聚光灯', icon: 'mdi:spotlight' }
]

export type { UtilityOption }
export {
  FILLABLE_GRAPHICS,
  FONTSIZE_GRAPHICS,
  NON_OPACITY_GRAPHICS,
  THEME_PRIMARY,
  UTILITIES
}
