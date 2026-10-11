import type Konva from 'konva'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'

import { findKonvaByID } from '@/features/capture/components/graphics/geometry'
import type { GraphicsProps } from '@/features/capture/components/graphics/types'

interface TextEditorProps {
  editingID: string
  editValue: string
  annotation: GraphicsProps | undefined
  stageRef: RefObject<Konva.Stage | null>
  onChangeValue: (value: string) => void
  onCommit: (value: string) => void
  onCancel: () => void
  onClose: () => void
}

interface EditorLayout {
  style: CSSProperties
  color: string
}

function TextEditor(props: TextEditorProps) {
  const {
    editingID,
    editValue,
    annotation,
    stageRef,
    onChangeValue,
    onCommit,
    onCancel,
    onClose
  } = props
  const editTextareaRef = useRef<HTMLTextAreaElement>(null)
  const composingRef = useRef(false)
  const [layout, onUpdateLayout] = useState<EditorLayout | null>(null)

  useEffect(
    function () {
      editTextareaRef.current?.focus()
    },
    [editingID]
  )

  useLayoutEffect(
    function () {
      const frame = requestAnimationFrame(function () {
        if (!annotation || annotation.type !== 'text') {
          onUpdateLayout(null)
          return
        }
        const stage = stageRef.current
        if (!stage) {
          onUpdateLayout(null)
          return
        }
        const group = findKonvaByID(stage, editingID) as Konva.Group | null
        const textNode = group?.findOne<Konva.Text>('Text')
        if (!textNode) {
          onUpdateLayout(null)
          return
        }

        const containerRect = stage.container().getBoundingClientRect()
        const absPos = textNode.absolutePosition()
        const fontSize = annotation.fontSize ?? 16
        const textWidth = textNode.width() || 80
        const textHeight = fontSize * 1.4

        onUpdateLayout({
          color: annotation.color,
          style: {
            position: 'fixed',
            left: `${containerRect.left + absPos.x}px`,
            top: `${containerRect.top + absPos.y}px`,
            minWidth: `${Math.max(textWidth, 80)}px`,
            minHeight: `${textHeight}px`,
            margin: 0,
            padding: '2px 4px',
            fontSize: `${fontSize}px`,
            lineHeight: 1.2,
            fontFamily: 'sans-serif',
            color: annotation.color,
            background: 'rgba(255, 255, 255, 0.92)',
            border: '1px dashed #4080ff',
            outline: 'none',
            resize: 'both',
            boxSizing: 'border-box',
            zIndex: 10000
          }
        })
      })
      return function () {
        cancelAnimationFrame(frame)
      }
    },
    [annotation, editingID, stageRef]
  )

  if (!layout) return null

  return (
    <textarea
      ref={editTextareaRef}
      aria-label="编辑标注文字"
      value={editValue}
      onChange={function (e) {
        onChangeValue(e.target.value)
      }}
      onBlur={function () {
        onCommit(editValue)
        onClose()
      }}
      onCompositionStart={function () {
        composingRef.current = true
      }}
      onCompositionEnd={function () {
        composingRef.current = false
      }}
      onKeyDown={function (e) {
        if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        } else if (e.key === 'Enter' && !e.shiftKey && !composingRef.current) {
          e.preventDefault()
          onCommit(editValue)
          onClose()
        }
      }}
      style={layout.style}
    />
  )
}

export type { TextEditorProps }
export { TextEditor }
