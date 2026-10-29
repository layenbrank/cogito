'use client'

import { useCallback } from 'react'
import type { Editor } from '@tiptap/react'

// --- Icons ---
import { CodeBlockIcon } from '@/components/tiptap-icons/code-block-icon.tsx'
import { HeadingOneIcon } from '@/components/tiptap-icons/heading-one-icon.tsx'
import { HeadingTwoIcon } from '@/components/tiptap-icons/heading-two-icon.tsx'
import { HeadingThreeIcon } from '@/components/tiptap-icons/heading-three-icon.tsx'
import { ImageIcon } from '@/components/tiptap-icons/image-icon.tsx'
import { ListIcon } from '@/components/tiptap-icons/list-icon.tsx'
import { ListOrderedIcon } from '@/components/tiptap-icons/list-ordered-icon.tsx'
import { BlockquoteIcon } from '@/components/tiptap-icons/blockquote-icon.tsx'
import { ListTodoIcon } from '@/components/tiptap-icons/list-todo-icon.tsx'
import { AiSparklesIcon } from '@/components/tiptap-icons/ai-sparkles-icon.tsx'
import { MinusIcon } from '@/components/tiptap-icons/minus-icon.tsx'
import { TypeIcon } from '@/components/tiptap-icons/type-icon.tsx'
import { AtSignIcon } from '@/components/tiptap-icons/at-sign-icon.tsx'
import { SmilePlusIcon } from '@/components/tiptap-icons/smile-plus-icon.tsx'
import { TableIcon } from '@/components/tiptap-icons/table-icon.tsx'

// --- Lib ---
import { isExtensionAvailable, isNodeInSchema } from '@/lib/tiptap-utils.ts'
import {
  findSelectionPosition,
  hasContentAbove
} from '@/lib/tiptap-advanced-utils.ts'

// --- Tiptap UI ---
import type { SuggestionItem } from '@/components/tiptap-ui-utils/suggestion-menu/suggestion-menu-types.ts'
import { addEmojiTrigger } from '@/components/tiptap-ui/emoji-trigger-button/use-emoji-trigger.ts'
import { addMentionTrigger } from '@/components/tiptap-ui/mention-trigger-button/use-mention-trigger.ts'
import { t } from '@/views/knowledge/locale.ts'

export interface SlashMenuConfig {
  enabledItems?: SlashMenuItemType[]
  customItems?: SuggestionItem[]
  itemGroups?: {
    [key in SlashMenuItemType]?: string
  }
  showGroups?: boolean
}

const texts = {
  // AI
  continue_writing: {
    title: t('EDITOR_CONTINUE_WRITING'),
    subtext: t('EDITOR_SLASH_CONTINUE_SUB'),
    keywords: ['continue', 'write', 'continue writing', 'ai', '继续', '写作'],
    badge: AiSparklesIcon,
    group: t('EDITOR_GROUP_AI')
  },
  ai_ask_button: {
    title: t('EDITOR_ASK_AI'),
    subtext: t('EDITOR_SLASH_ASK_AI_SUB'),
    keywords: ['ai', 'ask', 'generate', '询问', '生成'],
    badge: AiSparklesIcon,
    group: t('EDITOR_GROUP_AI')
  },

  // Style
  text: {
    title: t('EDITOR_TEXT'),
    subtext: t('EDITOR_SLASH_TEXT_SUB'),
    keywords: ['p', 'paragraph', 'text', '正文', '段落'],
    badge: TypeIcon,
    group: t('EDITOR_GROUP_STYLE')
  },
  heading_1: {
    title: t('EDITOR_HEADING_1'),
    subtext: t('EDITOR_SLASH_H1_SUB'),
    keywords: ['h', 'heading1', 'h1', '标题'],
    badge: HeadingOneIcon,
    group: t('EDITOR_GROUP_STYLE')
  },
  heading_2: {
    title: t('EDITOR_HEADING_2'),
    subtext: t('EDITOR_SLASH_H2_SUB'),
    keywords: ['h2', 'heading2', 'subheading'],
    badge: HeadingTwoIcon,
    group: t('EDITOR_GROUP_STYLE')
  },
  heading_3: {
    title: t('EDITOR_HEADING_3'),
    subtext: t('EDITOR_SLASH_H3_SUB'),
    keywords: ['h3', 'heading3', 'subheading'],
    badge: HeadingThreeIcon,
    group: t('EDITOR_GROUP_STYLE')
  },
  bullet_list: {
    title: t('EDITOR_BULLET_LIST'),
    subtext: t('EDITOR_SLASH_BULLET_SUB'),
    keywords: ['ul', 'li', 'list', 'bulletlist', 'bullet list', '无序', '列表'],
    badge: ListIcon,
    group: t('EDITOR_GROUP_STYLE')
  },
  ordered_list: {
    title: t('EDITOR_NUMBERED_LIST'),
    subtext: t('EDITOR_SLASH_NUMBERED_SUB'),
    keywords: ['ol', 'li', 'list', 'numberedlist', 'numbered list', '有序', '编号'],
    badge: ListOrderedIcon,
    group: t('EDITOR_GROUP_STYLE')
  },
  task_list: {
    title: t('EDITOR_TASK_LIST'),
    subtext: t('EDITOR_SLASH_TASK_SUB'),
    keywords: ['tasklist', 'task list', 'todo', 'checklist', '任务', '待办'],
    badge: ListTodoIcon,
    group: t('EDITOR_GROUP_STYLE')
  },
  quote: {
    title: t('EDITOR_BLOCKQUOTE'),
    subtext: t('EDITOR_SLASH_QUOTE_SUB'),
    keywords: ['quote', 'blockquote', '引用'],
    badge: BlockquoteIcon,
    group: t('EDITOR_GROUP_STYLE')
  },
  code_block: {
    title: t('EDITOR_CODE_BLOCK'),
    subtext: t('EDITOR_SLASH_CODE_SUB'),
    keywords: ['code', 'pre', '代码'],
    badge: CodeBlockIcon,
    group: t('EDITOR_GROUP_STYLE')
  },

  // Insert
  mention: {
    title: t('EDITOR_MENTION'),
    subtext: t('EDITOR_SLASH_MENTION_SUB'),
    keywords: ['mention', 'user', 'item', 'tag'],
    badge: AtSignIcon,
    group: t('EDITOR_GROUP_INSERT')
  },
  emoji: {
    title: t('EDITOR_EMOJI'),
    subtext: t('EDITOR_SLASH_EMOJI_SUB'),
    keywords: ['emoji', 'emoticon', 'smiley'],
    badge: SmilePlusIcon,
    group: t('EDITOR_GROUP_INSERT')
  },
  table: {
    title: t('EDITOR_TABLE'),
    subtext: t('EDITOR_SLASH_TABLE_SUB'),
    aliases: ['table', 'insertTable'],
    badge: TableIcon,
    group: t('EDITOR_GROUP_INSERT')
  },
  divider: {
    title: t('EDITOR_SEPARATOR'),
    subtext: t('EDITOR_SLASH_SEPARATOR_SUB'),
    keywords: ['hr', 'horizontalRule', 'line', 'separator'],
    badge: MinusIcon,
    group: t('EDITOR_GROUP_INSERT')
  },

  // Upload
  image: {
    title: t('EDITOR_IMAGE'),
    subtext: t('EDITOR_SLASH_IMAGE_SUB'),
    keywords: [
      'image',
      'imageUpload',
      'upload',
      'img',
      'picture',
      'media',
      'url'
    ],
    badge: ImageIcon,
    group: t('EDITOR_GROUP_UPLOAD')
  }
}

export type SlashMenuItemType = keyof typeof texts

const findItemImplementations = () => {
  return {
    // AI
    continue_writing: {
      check: (editor: Editor) => {
        const { hasContent } = hasContentAbove(editor)
        const extensionsReady = isExtensionAvailable(editor, [
          'ai',
          'aiAdvanced'
        ])
        return extensionsReady && hasContent
      },
      action: ({ editor }: { editor: Editor }) => {
        const editorChain = editor.chain().focus()

        const nodeSelectionPosition = findSelectionPosition({ editor })

        if (nodeSelectionPosition !== null) {
          editorChain.setNodeSelection(nodeSelectionPosition)
        }

        editorChain.run()

        editor.chain().focus().aiGenerationShow().run()

        requestAnimationFrame(() => {
          const { hasContent, content } = hasContentAbove(editor)

          const snippet =
            content.length > 500 ? `...${content.slice(-500)}` : content

          const prompt = hasContent
            ? `Context: ${snippet}\n\nContinue writing from where the text above ends. Write ONLY ONE SENTENCE. DONT REPEAT THE TEXT.`
            : 'Start writing a new paragraph. Write ONLY ONE SENTENCE.'

          // AI 扩展可选；命令由 TipTap AI 包注入
          const chain = editor.chain().focus() as unknown as {
            aiTextPrompt: (opts: {
              stream: boolean
              format: string
              text: string
            }) => { run: () => boolean }
          }
          chain
            .aiTextPrompt({
              stream: true,
              format: 'rich-text',
              text: prompt
            })
            .run()
        })
      }
    },
    ai_ask_button: {
      check: (editor: Editor) =>
        isExtensionAvailable(editor, ['ai', 'aiAdvanced']),
      action: ({ editor }: { editor: Editor }) => {
        const editorChain = editor.chain().focus()

        const nodeSelectionPosition = findSelectionPosition({ editor })

        if (nodeSelectionPosition !== null) {
          editorChain.setNodeSelection(nodeSelectionPosition)
        }

        editorChain.run()

        editor.chain().focus().aiGenerationShow().run()
      }
    },

    // Style
    text: {
      check: (editor: Editor) => isNodeInSchema('paragraph', editor),
      action: ({ editor }: { editor: Editor }) => {
        editor.chain().focus().setParagraph().run()
      }
    },
    heading_1: {
      check: (editor: Editor) => isNodeInSchema('heading', editor),
      action: ({ editor }: { editor: Editor }) => {
        editor.chain().focus().toggleHeading({ level: 1 }).run()
      }
    },
    heading_2: {
      check: (editor: Editor) => isNodeInSchema('heading', editor),
      action: ({ editor }: { editor: Editor }) => {
        editor.chain().focus().toggleHeading({ level: 2 }).run()
      }
    },
    heading_3: {
      check: (editor: Editor) => isNodeInSchema('heading', editor),
      action: ({ editor }: { editor: Editor }) => {
        editor.chain().focus().toggleHeading({ level: 3 }).run()
      }
    },
    bullet_list: {
      check: (editor: Editor) => isNodeInSchema('bulletList', editor),
      action: ({ editor }: { editor: Editor }) => {
        editor.chain().focus().toggleBulletList().run()
      }
    },
    ordered_list: {
      check: (editor: Editor) => isNodeInSchema('orderedList', editor),
      action: ({ editor }: { editor: Editor }) => {
        editor.chain().focus().toggleOrderedList().run()
      }
    },
    task_list: {
      check: (editor: Editor) => isNodeInSchema('taskList', editor),
      action: ({ editor }: { editor: Editor }) => {
        editor.chain().focus().toggleTaskList().run()
      }
    },
    quote: {
      check: (editor: Editor) => isNodeInSchema('blockquote', editor),
      action: ({ editor }: { editor: Editor }) => {
        editor.chain().focus().toggleBlockquote().run()
      }
    },
    code_block: {
      check: (editor: Editor) => isNodeInSchema('codeBlock', editor),
      action: ({ editor }: { editor: Editor }) => {
        editor.chain().focus().toggleNode('codeBlock', 'paragraph').run()
      }
    },

    // Insert
    mention: {
      check: (editor: Editor) =>
        isExtensionAvailable(editor, ['mention', 'mentionAdvanced']),
      action: ({ editor }: { editor: Editor }) => addMentionTrigger(editor)
    },
    emoji: {
      check: (editor: Editor) =>
        isExtensionAvailable(editor, ['emoji', 'emojiPicker']),
      action: ({ editor }: { editor: Editor }) => addEmojiTrigger(editor)
    },
    divider: {
      check: (editor: Editor) => isNodeInSchema('horizontalRule', editor),
      action: ({ editor }: { editor: Editor }) => {
        editor.chain().focus().setHorizontalRule().run()
      }
    },
    table: {
      check: (editor: Editor) => isNodeInSchema('table', editor),
      action: ({ editor }: { editor: Editor }) => {
        editor
          .chain()
          .focus()
          .insertTable({
            rows: 3,
            cols: 3,
            withHeaderRow: false
          })
          .run()
      }
    },

    // Upload
    image: {
      check: (editor: Editor) => isNodeInSchema('image', editor),
      action: ({ editor }: { editor: Editor }) => {
        editor
          .chain()
          .focus()
          .insertContent({
            type: 'imageUpload'
          })
          .run()
      }
    }
  }
}

function organizeItemsByGroups(
  items: SuggestionItem[],
  showGroups: boolean
): SuggestionItem[] {
  if (!showGroups) {
    return items.map((item) => ({ ...item, group: '' }))
  }

  const groups: { [groupLabel: string]: SuggestionItem[] } = {}

  // Group items
  items.forEach((item) => {
    const groupLabel = item.group || ''
    if (!groups[groupLabel]) {
      groups[groupLabel] = []
    }
    groups[groupLabel].push(item)
  })

  // Flatten groups in order (this maintains the visual order for keyboard navigation)
  const organizedItems: SuggestionItem[] = []
  Object.entries(groups).forEach(([, groupItems]) => {
    organizedItems.push(...groupItems)
  })

  return organizedItems
}

/**
 * Custom hook for slash dropdown menu functionality
 */
export function useSlashDropdownMenu(config?: SlashMenuConfig) {
  const findSlashMenuItems = useCallback(
    (editor: Editor) => {
      const items: SuggestionItem[] = []

      const enabledItems =
        config?.enabledItems || (Object.keys(texts) as SlashMenuItemType[])
      const showGroups = config?.showGroups !== false

      const itemImplementations = findItemImplementations()

      enabledItems.forEach((itemType) => {
        const itemImpl = itemImplementations[itemType]
        const itemText = texts[itemType]

        if (itemImpl && itemText && itemImpl.check(editor)) {
          const item: SuggestionItem = {
            onSelect: ({ editor }) => itemImpl.action({ editor }),
            ...itemText
          }

          if (config?.itemGroups?.[itemType]) {
            item.group = config.itemGroups[itemType]
          } else if (!showGroups) {
            item.group = ''
          }

          items.push(item)
        }
      })

      if (config?.customItems) {
        items.push(...config.customItems)
      }

      // Reorganize items by groups to ensure keyboard navigation works correctly
      return organizeItemsByGroups(items, showGroups)
    },
    [config]
  )

  return {
    findSlashMenuItems,
    config
  }
}
