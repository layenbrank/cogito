// @ts-nocheck
import { useCallback, useEffect, useState } from 'react'
import { isNodeSelection, type Editor } from '@tiptap/react'
import { SHORTCUT_COMMAND, findShortcutDefault } from '@/keyboard/definitions'
import { useShortcut } from '@/keyboard/react'

// --- Lib ---
import { isExtensionAvailable, isNodeTypeSelected } from '@/lib/tiptap-utils.ts'

// --- Hooks ---
import { useTiptapEditor } from '@/hooks/use-tiptap-editor.ts'

// --- Icons ---
import { AiSparklesIcon } from '@/components/tiptap-icons/ai-sparkles-icon.tsx'

export interface UseAiAskConfig {
  /**
   * The Tiptap editor instance.
   */
  editor?: Editor | null
  /**
   * Whether the button should hide when blockquote is not available.
   * @default false
   */
  hideWhenUnavailable?: boolean
  /**
   * Callback function called after AI ask is successfully triggered
   */
  onAiAsked?: () => void
}

export const AI_ASK_SHORTCUT_KEY = findShortcutDefault(SHORTCUT_COMMAND.EDITOR_AI_ASK)
export const AI_EXTENSIONS = ['aiGeneration', 'ai']
export const EXCLUDED_SELECTION_TYPES = ['codeBlock', 'image', 'imageUpload']

export const canPerformAiAsk = (editor: Editor | null): boolean => {
  if (!editor || !editor.isEditable) return false
  // TODO: Wait until AI extensions support for image
  if (
    !isExtensionAvailable(editor, AI_EXTENSIONS) ||
    isNodeTypeSelected(editor, ['image', 'horizontalRule'])
  )
    return false

  const { selection } = editor.state
  if (!selection || selection.empty) return false

  if (isNodeSelection(selection)) {
    const selectedNode = selection.node
    if (EXCLUDED_SELECTION_TYPES.includes(selectedNode.type.name)) {
      return false
    }
  }

  return true
}

export function shouldShowButton(props: {
  editor: Editor | null
  hideWhenUnavailable: boolean
}): boolean {
  const { editor, hideWhenUnavailable } = props

  if (!editor || !editor.isEditable) return false
  if (!isExtensionAvailable(editor, AI_EXTENSIONS)) return false

  if (hideWhenUnavailable && !editor.isActive('code')) {
    return canPerformAiAsk(editor)
  }

  return true
}

/**
 * Custom hook that provides AI ask functionality for Tiptap editor
 *
 * @example
 * ```tsx
 * // Simple usage
 * function MyAiButton() {
 *   const { isVisible, handleAiAsk } = useAiAsk()
 *   if (!isVisible) return null
 *   return <button onClick={handleAiAsk}>Ask AI</button>
 * }
 *
 * // Advanced usage with configuration
 * function MyAdvancedAiButton() {
 *   const { isVisible, handleAiAsk, label } = useAiAsk({
 *     editor: myEditor,
 *     hideWhenUnavailable: true,
 *     onAiAsked: () => console.log('AI triggered!')
 *   })
 *
 *   return isVisible ? (
 *     <button onClick={handleAiAsk} aria-label={label}>
 *       Ask AI Assistant
 *     </button>
 *   ) : null
 * }
 * ```
 */
export function useAiAsk(config: UseAiAskConfig = {}) {
  const {
    editor: providedEditor,
    hideWhenUnavailable = false,
    onAiAsked
  } = config

  const { editor } = useTiptapEditor(providedEditor)
  const [isVisible, setIsVisible] = useState<boolean>(true)
  const canAiAsk = canPerformAiAsk(editor)

  const handleAiAsk = useCallback((): boolean => {
    if (!editor || !canAiAsk) return false

    const success = editor.chain().focus().aiGenerationShow().run()
    if (success) {
      onAiAsked?.()
    }
    return success
  }, [canAiAsk, editor, onAiAsked])

  useEffect(() => {
    if (!editor) {
      setIsVisible(false)
      return
    }

    const updateVisibility = () => {
      setIsVisible(shouldShowButton({ editor, hideWhenUnavailable }))
    }

    updateVisibility()

    editor.on('selectionUpdate', updateVisibility)

    return () => {
      editor.off('selectionUpdate', updateVisibility)
    }
  }, [editor, hideWhenUnavailable])

  useShortcut(
    SHORTCUT_COMMAND.EDITOR_AI_ASK,
    () => {
      handleAiAsk()
    },
    {
      enabled: isVisible && canAiAsk
    }
  )

  return {
    isVisible,
    handleAiAsk,
    canAiAsk,
    label: 'Ask AI Assistant',
    shortcutKeys: AI_ASK_SHORTCUT_KEY,
    Icon: AiSparklesIcon
  }
}
