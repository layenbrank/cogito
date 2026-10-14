import type { AnyExtension } from '@tiptap/react'
import { Image } from '@/components/tiptap-node/image-node/image-node-extension'
import { TableKit } from '@/components/tiptap-node/table-node/extensions/table-node-extension'
import { NodeAlignment } from '@/components/tiptap-extension/node-alignment-extension.ts'
import { NodeBackground } from '@/components/tiptap-extension/node-background-extension.ts'
import { UiState } from '@/components/tiptap-extension/ui-state-extension'
import HorizontalRule from '@/components/tiptap-node/horizontal-rule-node/horizontal-rule-node-extension.ts'
import { TableHandleExtension } from '@/components/tiptap-node/table-node/extensions/table-handle/table-handle.ts'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { Highlight } from '@tiptap/extension-highlight'
import { Link } from '@tiptap/extension-link'
import { Placeholder } from '@tiptap/extension-placeholder'
import { Subscript } from '@tiptap/extension-subscript'
import { Superscript } from '@tiptap/extension-superscript'
import { TaskItem } from '@tiptap/extension-task-item'
import { TaskList } from '@tiptap/extension-task-list'
import { TextAlign } from '@tiptap/extension-text-align'
import { TextStyleKit } from '@tiptap/extension-text-style'
import { Typography } from '@tiptap/extension-typography'
import StarterKit from '@tiptap/starter-kit'
import css from 'highlight.js/lib/languages/css'
import js from 'highlight.js/lib/languages/javascript'
import ts from 'highlight.js/lib/languages/typescript'
import html from 'highlight.js/lib/languages/xml'
import { all, createLowlight } from 'lowlight'

import { MathBlock, MathInline } from '@/views/markdown/workspace/math-extension.ts'
import { MermaidBlock } from '@/views/markdown/workspace/mermaid-extension.ts'
import { t } from '@/views/markdown/locale.ts'

const lowlight = createLowlight(all)
lowlight.register('html', html)
lowlight.register('css', css)
lowlight.register('js', js)
lowlight.register('ts', ts)

function findMarkdownExtensions(options: {
  isTypographyEnabled: boolean
}): AnyExtension[] {
  const extensions: AnyExtension[] = [
    TextStyleKit,
    StarterKit.configure({
      horizontalRule: false,
      codeBlock: false
    }),
    CodeBlockLowlight.configure({ lowlight }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    HorizontalRule,
    Highlight.configure({ multicolor: true }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      defaultProtocol: 'https'
    }),
    Placeholder.configure({
      placeholder: t('PLACEHOLDER')
    }),
    UiState,
    TaskList,
    TaskItem.configure({ nested: true }),
    Superscript,
    Subscript,
    TableKit.configure({
      table: { resizable: true }
    }),
    TableHandleExtension,
    NodeAlignment,
    NodeBackground,
    Image.configure({
      HTMLAttributes: { class: 'custom-image-class' },
      resize: {
        enabled: true,
        alwaysPreserveAspectRatio: true
      }
    }),
    MathBlock,
    MathInline,
    MermaidBlock
  ]

  if (options.isTypographyEnabled) {
    extensions.push(Typography)
  }

  return extensions
}

export { findMarkdownExtensions, lowlight }
