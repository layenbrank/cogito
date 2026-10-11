import type { Editor as Composer } from '@tiptap/react'

interface ComposerToolbarState {
  isBold: boolean
  canBold: boolean
  isItalic: boolean
  canItalic: boolean
  isStrike: boolean
  canStrike: boolean
  isCode: boolean
  canCode: boolean
  canClearMarks: boolean
  isParagraph: boolean
  isHeading1: boolean
  isHeading2: boolean
  isHeading3: boolean
  isHeading4: boolean
  isHeading5: boolean
  isHeading6: boolean
  isBulletList: boolean
  isOrderedList: boolean
  isCodeBlock: boolean
  isBlockquote: boolean
  canUndo: boolean
  canRedo: boolean
}

function findComposerToolbarState(composer: Composer): ComposerToolbarState {
  return {
    isBold: composer.isActive('bold') ?? false,
    canBold: composer.can().chain().toggleBold().run() ?? false,
    isItalic: composer.isActive('italic') ?? false,
    canItalic: composer.can().chain().toggleItalic().run() ?? false,
    isStrike: composer.isActive('strike') ?? false,
    canStrike: composer.can().chain().toggleStrike().run() ?? false,
    isCode: composer.isActive('code') ?? false,
    canCode: composer.can().chain().toggleCode().run() ?? false,
    canClearMarks: composer.can().chain().unsetAllMarks().run() ?? false,
    isParagraph: composer.isActive('paragraph') ?? false,
    isHeading1: composer.isActive('heading', { level: 1 }) ?? false,
    isHeading2: composer.isActive('heading', { level: 2 }) ?? false,
    isHeading3: composer.isActive('heading', { level: 3 }) ?? false,
    isHeading4: composer.isActive('heading', { level: 4 }) ?? false,
    isHeading5: composer.isActive('heading', { level: 5 }) ?? false,
    isHeading6: composer.isActive('heading', { level: 6 }) ?? false,
    isBulletList: composer.isActive('bulletList') ?? false,
    isOrderedList: composer.isActive('orderedList') ?? false,
    isCodeBlock: composer.isActive('codeBlock') ?? false,
    isBlockquote: composer.isActive('blockquote') ?? false,
    canUndo: composer.can().chain().undo().run() ?? false,
    canRedo: composer.can().chain().redo().run() ?? false
  }
}

export { findComposerToolbarState }
export type { ComposerToolbarState }
