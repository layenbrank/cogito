import type { Editor as Composer } from '@tiptap/react'
import { clsx } from 'clsx'

import type { ComposerToolbarState } from './composer-toolbar-state.ts'

interface ToolbarAction {
  key: string
  label: string
  isActive?: (state: ComposerToolbarState) => boolean
  isDisabled?: (state: ComposerToolbarState) => boolean
  onClick: (composer: Composer) => void
}

const TOOLBAR_ACTIONS: ToolbarAction[] = [
  {
    key: 'bold',
    label: 'Bold',
    isActive: function (state) {
      return state.isBold
    },
    isDisabled: function (state) {
      return !state.canBold
    },
    onClick: function (composer) {
      composer.chain().focus().toggleBold().run()
    }
  },
  {
    key: 'italic',
    label: 'Italic',
    isActive: function (state) {
      return state.isItalic
    },
    isDisabled: function (state) {
      return !state.canItalic
    },
    onClick: function (composer) {
      composer.chain().focus().toggleItalic().run()
    }
  },
  {
    key: 'strike',
    label: 'Strike',
    isActive: function (state) {
      return state.isStrike
    },
    isDisabled: function (state) {
      return !state.canStrike
    },
    onClick: function (composer) {
      composer.chain().focus().toggleStrike().run()
    }
  },
  {
    key: 'code',
    label: 'Code',
    isActive: function (state) {
      return state.isCode
    },
    isDisabled: function (state) {
      return !state.canCode
    },
    onClick: function (composer) {
      composer.chain().focus().toggleCode().run()
    }
  },
  {
    key: 'clear-marks',
    label: 'Clear marks',
    onClick: function (composer) {
      composer.chain().focus().unsetAllMarks().run()
    }
  },
  {
    key: 'clear-nodes',
    label: 'Clear nodes',
    onClick: function (composer) {
      composer.chain().focus().clearNodes().run()
    }
  },
  {
    key: 'paragraph',
    label: 'Paragraph',
    isActive: function (state) {
      return state.isParagraph
    },
    onClick: function (composer) {
      composer.chain().focus().setParagraph().run()
    }
  },
  {
    key: 'h1',
    label: 'H1',
    isActive: function (state) {
      return state.isHeading1
    },
    onClick: function (composer) {
      composer.chain().focus().toggleHeading({ level: 1 }).run()
    }
  },
  {
    key: 'h2',
    label: 'H2',
    isActive: function (state) {
      return state.isHeading2
    },
    onClick: function (composer) {
      composer.chain().focus().toggleHeading({ level: 2 }).run()
    }
  },
  {
    key: 'h3',
    label: 'H3',
    isActive: function (state) {
      return state.isHeading3
    },
    onClick: function (composer) {
      composer.chain().focus().toggleHeading({ level: 3 }).run()
    }
  },
  {
    key: 'h4',
    label: 'H4',
    isActive: function (state) {
      return state.isHeading4
    },
    onClick: function (composer) {
      composer.chain().focus().toggleHeading({ level: 4 }).run()
    }
  },
  {
    key: 'h5',
    label: 'H5',
    isActive: function (state) {
      return state.isHeading5
    },
    onClick: function (composer) {
      composer.chain().focus().toggleHeading({ level: 5 }).run()
    }
  },
  {
    key: 'h6',
    label: 'H6',
    isActive: function (state) {
      return state.isHeading6
    },
    onClick: function (composer) {
      composer.chain().focus().toggleHeading({ level: 6 }).run()
    }
  },
  {
    key: 'bullet',
    label: 'Bullet list',
    isActive: function (state) {
      return state.isBulletList
    },
    onClick: function (composer) {
      composer.chain().focus().toggleBulletList().run()
    }
  },
  {
    key: 'ordered',
    label: 'Ordered list',
    isActive: function (state) {
      return state.isOrderedList
    },
    onClick: function (composer) {
      composer.chain().focus().toggleOrderedList().run()
    }
  },
  {
    key: 'code-block',
    label: 'Code block',
    isActive: function (state) {
      return state.isCodeBlock
    },
    onClick: function (composer) {
      composer.chain().focus().toggleCodeBlock().run()
    }
  },
  {
    key: 'blockquote',
    label: 'Blockquote',
    isActive: function (state) {
      return state.isBlockquote
    },
    onClick: function (composer) {
      composer.chain().focus().toggleBlockquote().run()
    }
  },
  {
    key: 'hr',
    label: 'Horizontal rule',
    onClick: function (composer) {
      composer.chain().focus().setHorizontalRule().run()
    }
  },
  {
    key: 'hard-break',
    label: 'Hard break',
    onClick: function (composer) {
      composer.chain().focus().setHardBreak().run()
    }
  },
  {
    key: 'undo',
    label: 'Undo',
    isDisabled: function (state) {
      return !state.canUndo
    },
    onClick: function (composer) {
      composer.chain().focus().undo().run()
    }
  },
  {
    key: 'redo',
    label: 'Redo',
    isDisabled: function (state) {
      return !state.canRedo
    },
    onClick: function (composer) {
      composer.chain().focus().redo().run()
    }
  }
]

interface ComposerToolbarActionsProps {
  composer: Composer
  state: ComposerToolbarState
}

function ComposerToolbarActions(props: ComposerToolbarActionsProps) {
  return (
    <div className="button-group">
      {TOOLBAR_ACTIONS.map(function (action) {
        const isActive = action.isActive?.(props.state) ?? false
        const isDisabled = action.isDisabled?.(props.state) ?? false
        return (
          <button
            key={action.key}
            type="button"
            disabled={isDisabled}
            className={clsx(isActive && 'is-active')}
            onClick={function () {
              action.onClick(props.composer)
            }}>
            {action.label}
          </button>
        )
      })}
    </div>
  )
}

export { ComposerToolbarActions }
