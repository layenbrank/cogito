import { useCallback, useEffect, useState } from 'react'
import { type Editor } from '@tiptap/react'
import { SHORTCUT_COMMAND, findShortcutDefault } from '@/keyboard/definitions'
import { useShortcut } from '@/keyboard/react'

// --- Hooks ---
import { useTiptapEditor } from '@/hooks/use-tiptap-editor.ts'

// --- Lib ---
import {
  isMarkInSchema,
  isNodeTypeSelected,
  selectCurrentBlockContent
} from '@/lib/tiptap-utils.ts'

// --- Icons ---
import { TextColorSmallIcon } from '@/components/tiptap-icons/text-color-small-icon.tsx'
import { t } from '@/views/knowledge/locale.ts'

export const COLOR_TEXT_SHORTCUT_KEY = findShortcutDefault(SHORTCUT_COMMAND.EDITOR_COLOR_TEXT)
export const TEXT_COLORS = [
  {
    label: t('EDITOR_DEFAULT_TEXT'),
    value: 'var(--tt-color-text)',
    border: 'var(--tt-color-text-contrast)'
  },
  {
    label: t('EDITOR_GRAY_TEXT'),
    value: 'var(--tt-color-text-gray)',
    border: 'var(--tt-color-text-gray-contrast)'
  },
  {
    label: t('EDITOR_BROWN_TEXT'),
    value: 'var(--tt-color-text-brown)',
    border: 'var(--tt-color-text-brown-contrast)'
  },
  {
    label: t('EDITOR_ORANGE_TEXT'),
    value: 'var(--tt-color-text-orange)',
    border: 'var(--tt-color-text-orange-contrast)'
  },
  {
    label: t('EDITOR_YELLOW_TEXT'),
    value: 'var(--tt-color-text-yellow)',
    border: 'var(--tt-color-text-yellow-contrast)'
  },
  {
    label: t('EDITOR_GREEN_TEXT'),
    value: 'var(--tt-color-text-green)',
    border: 'var(--tt-color-text-green-contrast)'
  },
  {
    label: t('EDITOR_BLUE_TEXT'),
    value: 'var(--tt-color-text-blue)',
    border: 'var(--tt-color-text-blue-contrast)'
  },
  {
    label: t('EDITOR_PURPLE_TEXT'),
    value: 'var(--tt-color-text-purple)',
    border: 'var(--tt-color-text-purple-contrast)'
  },
  {
    label: t('EDITOR_PINK_TEXT'),
    value: 'var(--tt-color-text-pink)',
    border: 'var(--tt-color-text-pink-contrast)'
  },
  {
    label: t('EDITOR_RED_TEXT'),
    value: 'var(--tt-color-text-red)',
    border: 'var(--tt-color-text-red-contrast)'
  }
]

/**
 * Configuration for the color text functionality
 */
export interface UseColorTextConfig {
  /**
   * The Tiptap editor instance.
   */
  editor?: Editor | null
  /**
   * The text color to apply.
   * Can be any valid CSS color value.
   */
  textColor: string
  /**
   * Optional text to display alongside the icon.
   */
  label: string
  /**
   * Whether the button should hide when the mark is not available.
   * @default false
   */
  hideWhenUnavailable?: boolean
  /**
   * Called when the text color is applied.
   */
  onApplied?: ({ color, label }: { color: string; label: string }) => void
}

/**
 * Checks if text color can be toggled in the current editor state
 */
export function canColorText(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable) return false
  if (
    !isMarkInSchema('textStyle', editor) ||
    isNodeTypeSelected(editor, ['image'])
  )
    return false

  try {
    return editor.can().setMark('textStyle', { color: 'currentColor' })
  } catch {
    return false
  }
}

/**
 * Checks if text color is active in the current selection
 */
export function isColorTextActive(
  editor: Editor | null,
  textColor: string
): boolean {
  if (!editor || !editor.isEditable) return false
  return editor.isActive('textStyle', { color: textColor })
}

/**
 * Determines if the color text button should be shown
 */
export function shouldShowButton(props: {
  editor: Editor | null
  hideWhenUnavailable: boolean
}): boolean {
  const { editor, hideWhenUnavailable } = props

  if (!editor || !editor.isEditable) return false
  if (!isMarkInSchema('textStyle', editor)) return false

  if (hideWhenUnavailable && !editor.isActive('code')) {
    return canColorText(editor)
  }

  return true
}

/**
 * Custom hook that provides color text functionality for Tiptap editor
 *
 * @example
 * ```tsx
 * // Simple usage with required textColor
 * function MySimpleTextColorButton() {
 *   const { isVisible, handleColorText, isActive } = useColorText({
 *     textColor: "red",
 *     label: "Red Text",
 *   })
 *
 *   if (!isVisible) return null
 *
 *   return (
 *     <button
 *       onClick={handleColorText}
 *       style={{ color: isActive ? "red" : "inherit" }}
 *     >
 *       Red Text
 *     </button>
 *   )
 * }
 *
 * // Advanced usage
 * function MyAdvancedTextColorButton() {
 *   const { isVisible, handleColorText, label, isActive } = useColorText({
 *     editor: myEditor,
 *     textColor: "#ff0000",
 *     label: "Apply Red",
 *     hideWhenUnavailable: true,
 *     onApplied: ({ color }) => console.log("Applied:", color),
 *   })
 *
 *   if (!isVisible) return null
 *
 *   return (
 *     <MyButton
 *       onClick={handleColorText}
 *       aria-label={label}
 *       data-active={isActive}
 *     >
 *       Apply Text Color
 *     </MyButton>
 *   )
 * }
 * ```
 */
export function useColorText(config: UseColorTextConfig) {
  const {
    editor: providedEditor,
    label,
    textColor,
    hideWhenUnavailable = false,
    onApplied
  } = config

  const { editor } = useTiptapEditor(providedEditor)
  const [isVisible, setIsVisible] = useState<boolean>(true)
  const canColorTextState = canColorText(editor)
  const isActive = isColorTextActive(editor, textColor)

  useEffect(() => {
    if (!editor) return

    const handleSelectionUpdate = () => {
      setIsVisible(shouldShowButton({ editor, hideWhenUnavailable }))
    }

    handleSelectionUpdate()

    editor.on('selectionUpdate', handleSelectionUpdate)

    return () => {
      editor.off('selectionUpdate', handleSelectionUpdate)
    }
  }, [editor, hideWhenUnavailable])

  const handleColorText = useCallback((): boolean => {
    if (!editor || !canColorTextState) return false

    if (editor.state.storedMarks) {
      const textStyleMarkType = editor.schema.marks.textStyle
      if (textStyleMarkType) {
        editor.view.dispatch(
          editor.state.tr.removeStoredMark(textStyleMarkType)
        )
      }
    }

    setTimeout(() => {
      selectCurrentBlockContent(editor)

      const success = editor
        .chain()
        .focus()
        .toggleMark('textStyle', { color: textColor })
        .run()
      if (success) {
        onApplied?.({ color: textColor, label })
      }
    }, 0)
    return true
  }, [editor, canColorTextState, textColor, onApplied, label])

  useShortcut(
    SHORTCUT_COMMAND.EDITOR_COLOR_TEXT,
    () => {
      handleColorText()
    },
    {
      enabled: () => isVisible && canColorTextState
    }
  )

  return {
    isVisible,
    isActive,
    handleColorText,
    canColorText: canColorTextState,
    label: label || t('EDITOR_COLOR_TEXT_TO', { color: textColor }),
    shortcutKeys: COLOR_TEXT_SHORTCUT_KEY,
    Icon: TextColorSmallIcon
  }
}
