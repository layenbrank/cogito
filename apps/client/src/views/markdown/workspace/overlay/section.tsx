import { Separator } from '@i-thinking/design/components/separator'
import {
  EditorContext as ComposerContext,
  EditorContent as ComposerMarkdown,
  type Editor
} from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { cn } from 'cn'

import { Fallback } from '@/components/fallback/index.ts'
import { Glide } from '@/components/glide/glide'
import { TableCellHandleMenu } from '@/components/tiptap-node/table-node/ui/table-cell-handle-menu/table-cell-handle-menu.tsx'
import { TableExtendRowColumnButtons } from '@/components/tiptap-node/table-node/ui/table-extend-row-column-button/table-extend-row-column-button.tsx'
import { TableHandle } from '@/components/tiptap-node/table-node/ui/table-handle/table-handle.tsx'
import { TableSelectionOverlay } from '@/components/tiptap-node/table-node/ui/table-selection-overlay/table-selection-overlay.tsx'
import { TableTriggerButton } from '@/components/tiptap-node/table-node/ui/table-trigger-button/table-trigger-button.tsx'
import { BlockquoteButton } from '@/components/tiptap-ui/blockquote-button/blockquote-button.tsx'
import { CodeBlockButton } from '@/components/tiptap-ui/code-block-button/code-block-button.tsx'
import { ColorHighlightPopover } from '@/components/tiptap-ui/color-highlight-popover/color-highlight-popover.tsx'
import { ColorTextPopover } from '@/components/tiptap-ui/color-text-popover/color-text-popover.tsx'
import { DragContextMenu } from '@/components/tiptap-ui/drag-context-menu/drag-context-menu.tsx'
import { HeadingDropdownMenu } from '@/components/tiptap-ui/heading-dropdown-menu/heading-dropdown-menu.tsx'
import { ImageUploadButton } from '@/components/tiptap-ui/image-upload-button/image-upload-button.tsx'
import { LinkPopover } from '@/components/tiptap-ui/link-popover/link-popover.tsx'
import { ListButton } from '@/components/tiptap-ui/list-button/list-button.tsx'
import { ListDropdownMenu } from '@/components/tiptap-ui/list-dropdown-menu/list-dropdown-menu.tsx'
import { MarkButton } from '@/components/tiptap-ui/mark-button/mark-button.tsx'
import { SlashDropdownMenu } from '@/components/tiptap-ui/slash-dropdown-menu/slash-dropdown-menu.tsx'
import { TextAlignButton } from '@/components/tiptap-ui/text-align-button/text-align-button.tsx'
import { TextButton } from '@/components/tiptap-ui/text-button/text-button.tsx'
import { TurnIntoDropdown } from '@/components/tiptap-ui/turn-into-dropdown/turn-into-dropdown.tsx'
import { UndoRedoButton } from '@/components/tiptap-ui/undo-redo-button/undo-redo-button.tsx'
import { useMarkdownStore } from '@/stores/markdown'

import '@/components/tiptap-node/blockquote-node/blockquote-node.scss'
import '@/components/tiptap-node/code-block-node/code-block-node.scss'
import '@/components/tiptap-node/heading-node/heading-node.scss'
import '@/components/tiptap-node/horizontal-rule-node/horizontal-rule-node.scss'
import '@/components/tiptap-node/image-node/image-node.scss'
import '@/components/tiptap-node/image-upload-node/image-upload-node.scss'
import '@/components/tiptap-node/list-node/list-node.scss'
import '@/components/tiptap-node/paragraph-node/paragraph-node.scss'
import '@/components/tiptap-node/table-node/styles/prosemirror-table.scss'
import '@/components/tiptap-node/table-node/styles/table-node.scss'
import '@/styles/markdown-animations.scss'
import '@/styles/markdown-composer.scss'
import '@/styles/markdown-variables.scss'
import '@/views/markdown/workspace/token-bridge.scss'

import styles from '@/views/markdown/workspace/overlay/section.module.scss'

interface SectionProps {
  composer: Editor | null
  isToolbarHidden?: boolean
  onScrollRatio?(ratio: number): void
  scrollHostRef?: React.RefObject<HTMLDivElement | null>
}

function Section(props: SectionProps) {
  const contentMaxWidth = useMarkdownStore(function (state) {
    return state.contentMaxWidth
  })
  const fontSize = useMarkdownStore(function (state) {
    return state.fontSize
  })
  const isFocusMode = useMarkdownStore(function (state) {
    return state.isFocusMode
  })

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      {!props.isToolbarHidden && !isFocusMode ? (
        <Glide.X
          classNames={{
            root: cn(
              styles.toolbar,
              'w-full shrink-0 border-b border-border/50 bg-background/75 backdrop-blur-md'
            ),
            inner: styles.toolbarTrack
          }}>
          <UndoRedoButton
            editor={props.composer}
            action="undo"
            tooltip="撤销"
            hideWhenUnavailable={false}
          />
          <UndoRedoButton
            editor={props.composer}
            action="redo"
            tooltip="重做"
            hideWhenUnavailable={false}
          />
          <Separator
            orientation="vertical"
            className="mx-0.5 h-auto shrink-0 self-stretch"
          />
          {props.composer ? (
            <HeadingDropdownMenu
              editor={props.composer}
              hideWhenUnavailable
              portal
            />
          ) : null}
          {props.composer ? (
            <TurnIntoDropdown
              editor={props.composer}
              hideWhenUnavailable
              portal
            />
          ) : null}
          <MarkButton
            editor={props.composer}
            type="bold"
            tooltip="加粗"
            hideWhenUnavailable
          />
          <MarkButton
            editor={props.composer}
            type="italic"
            tooltip="斜体"
            hideWhenUnavailable
          />
          <MarkButton
            editor={props.composer}
            type="strike"
            tooltip="删除线"
            hideWhenUnavailable
          />
          <MarkButton
            editor={props.composer}
            type="code"
            tooltip="行内代码"
            hideWhenUnavailable
          />
          <MarkButton
            editor={props.composer}
            type="underline"
            tooltip="下划线"
            hideWhenUnavailable
          />
          {props.composer ? (
            <LinkPopover
              editor={props.composer}
              hideWhenUnavailable
            />
          ) : null}
          <ColorHighlightPopover
            editor={props.composer}
            hideWhenUnavailable
          />
          {props.composer ? (
            <ColorTextPopover
              editor={props.composer}
              hideWhenUnavailable
            />
          ) : null}
          <Separator
            orientation="vertical"
            className="mx-0.5 h-auto shrink-0 self-stretch"
          />
          <ListButton
            editor={props.composer}
            type="bulletList"
            tooltip="无序列表"
            hideWhenUnavailable
          />
          <ListButton
            editor={props.composer}
            type="orderedList"
            tooltip="有序列表"
            hideWhenUnavailable
          />
          <ListButton
            editor={props.composer}
            type="taskList"
            tooltip="任务列表"
            hideWhenUnavailable
          />
          {props.composer ? (
            <ListDropdownMenu
              editor={props.composer}
              types={['bulletList', 'orderedList', 'taskList']}
              hideWhenUnavailable
              portal
            />
          ) : null}
          <BlockquoteButton
            editor={props.composer}
            tooltip="块引用"
            hideWhenUnavailable
          />
          <CodeBlockButton
            editor={props.composer}
            tooltip="代码块"
            hideWhenUnavailable
          />
          <TableTriggerButton editor={props.composer} />
          {props.composer ? (
            <ImageUploadButton
              editor={props.composer}
              hideWhenUnavailable
            />
          ) : null}
          <Separator
            orientation="vertical"
            className="mx-0.5 h-auto shrink-0 self-stretch"
          />
          <TextAlignButton
            editor={props.composer}
            align="left"
            tooltip="左对齐"
            hideWhenUnavailable
          />
          <TextAlignButton
            editor={props.composer}
            align="center"
            tooltip="居中对齐"
            hideWhenUnavailable
          />
          <TextAlignButton
            editor={props.composer}
            align="right"
            tooltip="右对齐"
            hideWhenUnavailable
          />
          <TextButton
            editor={props.composer}
            tooltip="清除格式"
            hideWhenUnavailable
          />
        </Glide.X>
      ) : null}

      <ComposerContext value={{ editor: props.composer }}>
        <div
          ref={props.scrollHostRef}
          className={cn(styles.composer, styles.markdown, 'relative')}
          style={{ fontSize }}
          onScroll={function (event) {
            const target = event.currentTarget
            const max = target.scrollHeight - target.clientHeight
            props.onScrollRatio?.(max <= 0 ? 0 : target.scrollTop / max)
          }}>
          <div
            className="mx-auto w-full"
            style={{ maxWidth: contentMaxWidth }}>
            <ComposerMarkdown
              editor={props.composer}
              role="presentation"
            />
          </div>
          {props.composer ? (
            <BubbleMenu
              editor={props.composer}
              className="flex items-center gap-0.5 rounded-md border border-border bg-popover p-1 shadow-md">
              <MarkButton
                editor={props.composer}
                type="bold"
                hideWhenUnavailable
                showShortcut={false}
              />
              <MarkButton
                editor={props.composer}
                type="italic"
                hideWhenUnavailable
                showShortcut={false}
              />
              <LinkPopover
                editor={props.composer}
                hideWhenUnavailable
              />
              <ColorHighlightPopover
                editor={props.composer}
                hideWhenUnavailable
              />
              <TurnIntoDropdown
                editor={props.composer}
                hideWhenUnavailable
                portal
              />
            </BubbleMenu>
          ) : null}
          {props.composer ? <SlashDropdownMenu editor={props.composer} /> : null}
          <Fallback.ErrorBoundary
            compact
            title="表格工具暂时不可用">
            <TableHandle editor={props.composer} />
            <TableSelectionOverlay
              editor={props.composer}
              showResizeHandles
              cellMenu={function (menuProps) {
                return (
                  <TableCellHandleMenu
                    editor={menuProps.editor}
                    onMouseDown={function (event) {
                      menuProps.onResizeStart?.('br')(event)
                    }}
                  />
                )
              }}
            />
            <TableExtendRowColumnButtons editor={props.composer} />
          </Fallback.ErrorBoundary>
          <DragContextMenu
            editor={props.composer}
            withSlashCommandTrigger
          />
        </div>
      </ComposerContext>
    </div>
  )
}

export default Section
