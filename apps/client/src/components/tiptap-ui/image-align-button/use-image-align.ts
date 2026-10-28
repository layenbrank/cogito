import { useCallback, useEffect, useState } from 'react'
import { SHORTCUT_COMMAND, findShortcutDefault } from '@/keyboard/definitions'
import { useShortcut } from '@/keyboard/react'
import { type Editor } from '@tiptap/react'
import { NodeSelection } from '@tiptap/pm/state'

// --- Hooks ---
import { useTiptapEditor } from '@/hooks/use-tiptap-editor.ts'

// --- Lib ---
import { isExtensionAvailable } from '@/lib/tiptap-utils.ts'

// --- Icons ---
import { AlignCenterVerticalIcon } from '@/components/tiptap-icons/align-center-vertical-icon.tsx'
import { AlignEndVerticalIcon } from '@/components/tiptap-icons/align-end-vertical-icon.tsx'
import { AlignStartVerticalIcon } from '@/components/tiptap-icons/align-start-vertical-icon.tsx'
import { t } from '@/views/knowledge/locale.ts'

export type ImageAlign = 'left' | 'center' | 'right'

/**
 * Configuration for the image align functionality
 */
export interface UseImageAlignConfig {
  /**
   * The Tiptap editor instance.
   */
  editor?: Editor | null
  /**
   * The image alignment to apply.
   */
  align: ImageAlign
  /**
   * The name of the image extension to target.
   * @default "image"
   */
  extensionName?: string
  /**
   * The attribute name used for alignment.
   * @default "data-align"
   */
  attributeName?: string
  /**
   * Whether the button should hide when alignment is not available.
   * @default false
   */
  hideWhenUnavailable?: boolean
  /**
   * Callback function called after a successful alignment change.
   */
  onAligned?: () => void
}

export const IMAGE_ALIGN_SHORTCUT_KEYS: Record<ImageAlign, string> = {
  left: findShortcutDefault(SHORTCUT_COMMAND.EDITOR_IMAGE_ALIGN_LEFT),
  center: findShortcutDefault(SHORTCUT_COMMAND.EDITOR_IMAGE_ALIGN_CENTER),
  right: findShortcutDefault(SHORTCUT_COMMAND.EDITOR_IMAGE_ALIGN_RIGHT)
}

/** 对齐方向 → 命令 id：键位分属三个独立条目（可分别展示与查冲突） */
const IMAGE_ALIGN_COMMANDS: Record<ImageAlign, string> = {
  left: SHORTCUT_COMMAND.EDITOR_IMAGE_ALIGN_LEFT,
  center: SHORTCUT_COMMAND.EDITOR_IMAGE_ALIGN_CENTER,
  right: SHORTCUT_COMMAND.EDITOR_IMAGE_ALIGN_RIGHT
}

export const imageAlignIcons = {
  left: AlignStartVerticalIcon,
  center: AlignCenterVerticalIcon,
  right: AlignEndVerticalIcon
}

export const imageAlignLabels: Record<ImageAlign, string> = {
  left: t('EDITOR_IMAGE_ALIGN_LEFT'),
  center: t('EDITOR_IMAGE_ALIGN_CENTER'),
  right: t('EDITOR_IMAGE_ALIGN_RIGHT')
}

/**
 * Checks if image alignment can be performed in the current editor state
 */
export function canSetImageAlign(
  editor: Editor | null,
  align: ImageAlign,
  extensionName: string = 'image',
  attributeName: string = 'data-align'
): boolean {
  if (!editor || !editor.isEditable) return false
  if (!isExtensionAvailable(editor, [extensionName])) return false

  return editor
    .can()
    .updateAttributes(extensionName, { [attributeName]: align })
}

/**
 * Checks if the image alignment is currently active
 */
export function isImageAlignActive(
  editor: Editor | null,
  align: ImageAlign,
  extensionName: string = 'image',
  attributeName: string = 'data-align'
): boolean {
  if (!editor || !editor.isEditable) return false
  if (!isExtensionAvailable(editor, [extensionName])) return false

  const attributes = editor.getAttributes(extensionName)
  const currentAlign = attributes[attributeName] || 'left'
  return currentAlign === align
}

/**
 * Sets image alignment in the editor
 */
export function setImageAlign(
  editor: Editor | null,
  align: ImageAlign,
  extensionName: string = 'image',
  attributeName: string = 'data-align'
): boolean {
  if (!editor?.isEditable) {
    return false
  }

  if (!isExtensionAvailable(editor, [extensionName])) {
    return false
  }

  if (!canSetImageAlign(editor, align, extensionName, attributeName)) {
    return false
  }

  try {
    const { selection } = editor.state
    const isNodeSelection = selection instanceof NodeSelection
    const selectionPosition = isNodeSelection
      ? selection.from
      : selection.$anchor.pos

    const alignmentUpdated = editor
      .chain()
      .focus()
      .updateAttributes(extensionName, { [attributeName]: align })
      .run()

    // Restore node selection if it was originally selected
    // This is the temporary solution as image-node-extension.ts contain content: "inline*"
    if (alignmentUpdated && isNodeSelection) {
      editor.commands.setNodeSelection(selectionPosition)
    }

    return alignmentUpdated
  } catch {
    return false
  }
}

/**
 * Determines if the image align button should be shown
 */
export function shouldShowButton(props: {
  editor: Editor | null
  hideWhenUnavailable: boolean
  align: ImageAlign
  extensionName?: string
  attributeName?: string
}): boolean {
  const {
    editor,
    hideWhenUnavailable,
    align,
    extensionName = 'image',
    attributeName = 'data-align'
  } = props

  if (!editor || !editor.isEditable) return false
  if (!isExtensionAvailable(editor, [extensionName])) return false

  if (hideWhenUnavailable) {
    return canSetImageAlign(editor, align, extensionName, attributeName)
  }

  return true
}

/**
 * Custom hook that provides image align functionality for Tiptap editor
 *
 * @example
 * ```tsx
 * // Simple usage with default "image" extension
 * function MySimpleImageAlignButton() {
 *   const { isVisible, handleImageAlign } = useImageAlign({ align: "center" })
 *
 *   if (!isVisible) return null
 *
 *   return <button onClick={handleImageAlign}>Align Center</button>
 * }
 *
 * // Advanced usage with custom extension name
 * function MyAdvancedImageAlignButton() {
 *   const { isVisible, handleImageAlign, label, isActive } = useImageAlign({
 *     editor: myEditor,
 *     align: "right",
 *     extensionName: "myCustomImage", // Use your custom extension name
 *     hideWhenUnavailable: true,
 *     onAligned: () => console.log('Image aligned!')
 *   })
 *
 *   if (!isVisible) return null
 *
 *   return (
 *     <MyButton
 *       onClick={handleImageAlign}
 *       aria-pressed={isActive}
 *       aria-label={label}
 *     >
 *       Align Right
 *     </MyButton>
 *   )
 * }
 * ```
 */
export function useImageAlign(config: UseImageAlignConfig) {
  const {
    editor: providedEditor,
    align,
    extensionName = 'image',
    attributeName = 'data-align',
    hideWhenUnavailable = false,
    onAligned
  } = config

  const { editor } = useTiptapEditor(providedEditor)
  const [isVisible, setIsVisible] = useState<boolean>(true)
  const canAlign = canSetImageAlign(editor, align, extensionName, attributeName)
  const isActive = isImageAlignActive(
    editor,
    align,
    extensionName,
    attributeName
  )

  useEffect(() => {
    if (!editor) return

    const handleSelectionUpdate = () => {
      setIsVisible(
        shouldShowButton({
          editor,
          align,
          hideWhenUnavailable,
          extensionName,
          attributeName
        })
      )
    }

    handleSelectionUpdate()

    editor.on('selectionUpdate', handleSelectionUpdate)
    return () => {
      editor.off('selectionUpdate', handleSelectionUpdate)
    }
  }, [editor, hideWhenUnavailable, align, extensionName, attributeName])

  const handleImageAlign = useCallback(() => {
    if (!editor) return false

    const success = setImageAlign(editor, align, extensionName, attributeName)
    if (success) {
      onAligned?.()
    }
    return success
  }, [editor, align, extensionName, attributeName, onAligned])

  useShortcut(
    IMAGE_ALIGN_COMMANDS[align],
    () => {
      handleImageAlign()
    },
    {
      enabled: () => isVisible && canAlign
    }
  )

  return {
    isVisible,
    isActive,
    handleImageAlign,
    canAlign,
    label: imageAlignLabels[align],
    shortcutKeys: IMAGE_ALIGN_SHORTCUT_KEYS[align],
    Icon: imageAlignIcons[align]
  }
}
