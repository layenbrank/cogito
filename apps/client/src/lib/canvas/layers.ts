/** 共享画布固定四层（自下而上），业务不得打乱层序 */

const LAYER_BACKGROUND = 'layer-background'
const LAYER_MEDIA = 'layer-media'
const LAYER_CONTENT = 'layer-content'
const LAYER_INTERACTION = 'layer-interaction'

const CANVAS_LAYERS = [
  LAYER_BACKGROUND,
  LAYER_MEDIA,
  LAYER_CONTENT,
  LAYER_INTERACTION
] as const

type CanvasLayerName = (typeof CANVAS_LAYERS)[number]

export type { CanvasLayerName }
export {
  LAYER_BACKGROUND,
  LAYER_MEDIA,
  LAYER_CONTENT,
  LAYER_INTERACTION,
  CANVAS_LAYERS
}
