import { useEffect, useRef, useSyncExternalStore } from 'react'
import { Transformer } from 'react-konva'
import type Konva from 'konva'

interface CanvasTransformerProps {
  /**
   * 从 ref/map 读取当前附着节点。须在节点未变时返回同一数组引用，
   * 以便 useSyncExternalStore 跳过更新。
   */
  getNodes: () => Konva.Node[]
  /** 节点 map / 选中项变化时通知；返回 unsubscribe */
  subscribeNodes: (onStoreChange: () => void) => () => void
  enabledAnchors?: string[]
  rotateEnabled?: boolean
  borderStroke?: string
  anchorStroke?: string
  anchorFill?: string
  anchorSize?: number
  boundBoxFunc?: Konva.TransformerConfig['boundBoxFunc']
  onTransformEnd?: (event: Konva.KonvaEventObject<Event>) => void
}

/** 固定挂在 interaction 层；选区更新在 Konva reconciler 内完成，不抬升 Stage 宿主 setState */
function CanvasTransformer(props: CanvasTransformerProps) {
  const {
    getNodes,
    subscribeNodes,
    enabledAnchors,
    rotateEnabled = true,
    borderStroke = '#3b82f6',
    anchorStroke = '#3b82f6',
    anchorFill = '#fff',
    anchorSize = 8,
    boundBoxFunc,
    onTransformEnd
  } = props

  const trRef = useRef<Konva.Transformer>(null)
  const nodes = useSyncExternalStore(subscribeNodes, getNodes, getNodes)

  useEffect(
    function () {
      const tr = trRef.current
      if (!tr) return
      tr.nodes(nodes)
      tr.getLayer()?.batchDraw()
    },
    [nodes]
  )

  return (
    <Transformer
      ref={trRef}
      enabledAnchors={enabledAnchors}
      rotateEnabled={rotateEnabled}
      borderStroke={borderStroke}
      anchorStroke={anchorStroke}
      anchorFill={anchorFill}
      anchorSize={anchorSize}
      boundBoxFunc={boundBoxFunc}
      onTransformEnd={onTransformEnd}
      visible={nodes.length > 0}
      listening={nodes.length > 0}
    />
  )
}

export type { CanvasTransformerProps }
export { CanvasTransformer }
