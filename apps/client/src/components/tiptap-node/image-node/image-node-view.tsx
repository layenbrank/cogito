// @ts-nocheck
import { useCallback, useEffect, useEffectEvent } from 'react'
import type { Editor, NodeViewProps } from '@tiptap/react'
import { NodeViewWrapper, NodeViewContent } from '@tiptap/react'

import { isValidPosition } from '@/lib/tiptap-utils.ts'
import { useMarkdownStore } from '@/stores/markdown'
import { findImageSrc } from '@/views/markdown/lib/image-src.ts'

import { ImageResizeHandles } from './image-resize-handles.tsx'
import { useImageResize } from './use-image-resize.ts'
import './image-node-view.scss'

export interface ResizeParams {
  handleUsed: 'left' | 'right'
  initialWidth: number
  initialClientX: number
}

export interface ResizableImageProps extends React.HTMLAttributes<HTMLDivElement> {
  src: string
  alt?: string
  editor?: Editor
  minWidth?: number
  maxWidth?: number
  align?: 'left' | 'center' | 'right'
  initialWidth?: number
  showCaption?: boolean
  hasContent?: boolean
  onImageResize?: (width?: number) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onUpdateAttributes?: (attrs: Record<string, any>) => void
  getPos: () => number | undefined
  nodeSize?: number
}

export function ImageNodeView(props: NodeViewProps) {
  const { editor, node, updateAttributes, getPos } = props
  const hasContent = node.content.size > 0
  // markdown 里存的是相对路径（assets/xxx），渲染时按当前文档目录解析成 asset 协议 URL
  const activePath = useMarkdownStore(function (state) {
    return state.activePath
  })

  return (
    <ResizableImage
      src={findImageSrc(node.attrs.src, activePath)}
      alt={node.attrs.alt || ''}
      editor={editor}
      align={node.attrs['data-align']}
      initialWidth={node.attrs.width}
      showCaption={node.attrs.showCaption}
      hasContent={hasContent}
      nodeSize={node.nodeSize}
      onImageResize={function (width) {
        updateAttributes({ width })
      }}
      onUpdateAttributes={updateAttributes}
      getPos={getPos}
    />
  )
}

export function ResizableImage({
  src,
  alt = '',
  editor,
  minWidth = 96,
  maxWidth = 800,
  align = 'left',
  initialWidth,
  showCaption = false,
  hasContent = false,
  nodeSize,
  onImageResize,
  onUpdateAttributes,
  getPos
}: ResizableImageProps) {
  const resize = useImageResize({
    editor,
    align,
    minWidth,
    maxWidth,
    initialWidth,
    getPos,
    onImageResize
  })

  const onSelectionUpdate = useEffectEvent(function () {
    if (!editor || !showCaption) return
    const pos = getPos()
    if (!isValidPosition(pos) || !nodeSize) return
    const { from, to } = editor.state.selection
    const nodeStart = pos
    const nodeEnd = pos + nodeSize
    const isOutsideNode = to < nodeStart || from > nodeEnd
    if (isOutsideNode && !hasContent && onUpdateAttributes) {
      onUpdateAttributes({ showCaption: false })
    }
  })

  useEffect(
    function () {
      if (!editor || !showCaption) return
      function handleSelectionUpdate() {
        onSelectionUpdate()
      }
      editor.on('selectionUpdate', handleSelectionUpdate)
      return function () {
        editor.off('selectionUpdate', handleSelectionUpdate)
      }
    },
    [editor, showCaption]
  )

  const handleImageClick = useCallback(
    function (event: React.MouseEvent) {
      if (!editor || !getPos || resize.resizeParams) return
      event.preventDefault()
      event.stopPropagation()
      const pos = getPos()
      if (isValidPosition(pos)) {
        editor.chain().focus().setNodeSelection(pos).run()
      }
    },
    [editor, getPos, resize.resizeParams]
  )

  function wrapperMouseEnterHandler() {
    if (editor?.isEditable) resize.setShowHandles(true)
  }

  function wrapperMouseLeaveHandler(event: React.MouseEvent<HTMLDivElement>) {
    if (
      event.relatedTarget === resize.leftResizeHandleRef.current ||
      event.relatedTarget === resize.rightResizeHandleRef.current ||
      resize.resizeParams
    ) {
      return
    }
    if (editor?.isEditable) resize.setShowHandles(false)
  }

  function wrapperTouchStartHandler() {
    if (editor?.isEditable) resize.setShowHandles(true)
  }

  const shouldShowCaption = showCaption || hasContent

  return (
    <NodeViewWrapper
      onMouseEnter={wrapperMouseEnterHandler}
      onMouseLeave={wrapperMouseLeaveHandler}
      onTouchStart={wrapperTouchStartHandler}
      data-align={align}
      data-width={resize.width}
      className="tiptap-image">
      <div
        ref={resize.wrapperRef}
        className="tiptap-image-container"
        style={{ width: resize.width ? `${resize.width}px` : 'fit-content' }}>
        <div className="tiptap-image-content">
          <button
            type="button"
            className="tiptap-image-img-button"
            onClick={handleImageClick}
            disabled={!editor?.isEditable}
            style={{
              display: 'contents',
              cursor: editor?.isEditable ? 'pointer' : 'default'
            }}>
            <img
              src={src}
              alt={alt}
              className="tiptap-image-img"
              contentEditable={false}
              draggable={false}
            />
          </button>

          {resize.showHandles && editor?.isEditable ? (
            <ImageResizeHandles
              leftRef={resize.leftResizeHandleRef}
              rightRef={resize.rightResizeHandleRef}
              onStartResize={resize.startResize}
            />
          ) : null}
        </div>

        {editor?.isEditable && shouldShowCaption ? (
          <NodeViewContent
            as="div"
            className="tiptap-image-caption"
            data-placeholder="Add a caption..."
          />
        ) : null}
      </div>
    </NodeViewWrapper>
  )
}
