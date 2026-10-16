/**
 * 笔记工作区的命令表：标题栏应用菜单与快捷键都落到这里，键位在 `keyboard/definitions` 按 id 关联。
 */
import { toast } from 'sonner'
import { type Editor } from '@tiptap/react'

import { SHORTCUT_COMMAND } from '@/keyboard/definitions'
import { useCommands } from '@/keyboard/react'
import { useMarkdownStore } from '@/stores/markdown'
import { exportHtmlDocument, printDocument } from '@/views/markdown/lib/export.ts'
import { serializeHtmlToMarkdown } from '@/views/markdown/lib/serialize-markdown.ts'
import { t } from '@/views/markdown/locale.ts'

export function useMarkdownCommands(input: {
  composerRef: { current: Editor | null }
  onSave: () => void | Promise<void>
  onOpenFile: () => void | Promise<void>
  onOpenFolder: () => void | Promise<void>
  onNew: () => void
  onToggleFocus: () => void
  onExitFocus: () => void
  onFind: (withReplace: boolean) => void
}) {
  const { composerRef } = input

  useCommands([
    {
      id: SHORTCUT_COMMAND.MARKDOWN_SAVE,
      title: '笔记：保存',
      keywords: 'save',
      group: '笔记',
      run: input.onSave
    },
    {
      id: SHORTCUT_COMMAND.MARKDOWN_OPEN_FILE,
      title: '笔记：打开文件…',
      keywords: 'open file',
      group: '笔记',
      run: input.onOpenFile
    },
    {
      id: SHORTCUT_COMMAND.MARKDOWN_OPEN_FOLDER,
      title: '笔记：打开文件夹…',
      keywords: 'open folder workspace',
      group: '笔记',
      run: input.onOpenFolder
    },
    {
      id: SHORTCUT_COMMAND.MARKDOWN_NEW,
      title: '笔记：新建',
      keywords: 'new',
      group: '笔记',
      run: input.onNew
    },
    {
      id: SHORTCUT_COMMAND.MARKDOWN_FIND,
      title: '笔记：查找',
      keywords: 'find',
      group: '笔记',
      run: function () {
        input.onFind(false)
      }
    },
    {
      id: SHORTCUT_COMMAND.MARKDOWN_FIND_REPLACE,
      title: '笔记：查找并替换',
      keywords: 'replace',
      group: '笔记',
      run: function () {
        input.onFind(true)
      }
    },
    {
      id: SHORTCUT_COMMAND.MARKDOWN_PRINT,
      title: '笔记：打印',
      keywords: 'print',
      group: '笔记',
      run: function () {
        const state = useMarkdownStore.getState()
        printDocument(
          state.activePath?.split(/[/\\]/).pop() ?? t('UNTITLED'),
          composerRef.current?.getHTML() ?? state.html
        )
      }
    },
    {
      id: SHORTCUT_COMMAND.MARKDOWN_MODE_LIVE,
      title: '笔记：实时预览',
      keywords: 'live preview',
      group: '笔记',
      run: function () {
        useMarkdownStore.getState().toSetViewMode('live')
      }
    },
    {
      id: SHORTCUT_COMMAND.MARKDOWN_MODE_SOURCE,
      title: '笔记：源码模式',
      keywords: 'source',
      group: '笔记',
      run: function () {
        useMarkdownStore.getState().toSetViewMode('source')
      }
    },
    {
      id: SHORTCUT_COMMAND.MARKDOWN_MODE_SPLIT,
      title: '笔记：分屏模式',
      keywords: 'split',
      group: '笔记',
      run: function () {
        useMarkdownStore.getState().toSetViewMode('split')
      }
    },
    {
      id: SHORTCUT_COMMAND.MARKDOWN_FOCUS_TOGGLE,
      title: '笔记：专注模式',
      keywords: 'focus',
      group: '笔记',
      run: input.onToggleFocus
    },
    {
      id: SHORTCUT_COMMAND.MARKDOWN_FOCUS_EXIT,
      title: '笔记：关闭查找 / 退出专注',
      keywords: 'exit focus escape',
      group: '笔记',
      run: function () {
        const state = useMarkdownStore.getState()
        if (state.isFindOpen) {
          state.toSetFindOpen(false)
          return
        }
        if (state.isFocusMode) input.onExitFocus()
      }
    },
    {
      id: SHORTCUT_COMMAND.MARKDOWN_EXPORT_HTML,
      title: '笔记：导出 HTML',
      keywords: 'export html',
      group: '笔记',
      run: function () {
        const state = useMarkdownStore.getState()
        void exportHtmlDocument({
          activePath: state.activePath,
          html: composerRef.current?.getHTML() ?? state.html
        })
      }
    },
    {
      id: SHORTCUT_COMMAND.MARKDOWN_COPY_MARKDOWN,
      title: '笔记：复制 Markdown',
      keywords: 'copy markdown',
      group: '笔记',
      run: function () {
        const state = useMarkdownStore.getState()
        const md = serializeHtmlToMarkdown(
          composerRef.current?.getHTML() ?? state.html,
          state.frontMatter
        )
        return navigator.clipboard.writeText(md).then(function () {
          toast.success(t('COPY_MD'))
        })
      }
    },
    {
      id: SHORTCUT_COMMAND.MARKDOWN_COPY_HTML,
      title: '笔记：复制 HTML',
      keywords: 'copy html',
      group: '笔记',
      run: function () {
        const htmlContent = composerRef.current?.getHTML() ?? useMarkdownStore.getState().html
        return navigator.clipboard.writeText(htmlContent).then(function () {
          toast.success(t('COPY_HTML'))
        })
      }
    }
  ])
}
