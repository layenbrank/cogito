import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Separator } from '@cogito/design/components/separator'
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
import { useKnowledgeStore } from '@/stores/knowledge'
import { useDockStore } from '@/features/agent/dock'

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
import '@/views/knowledge/workspace/token-bridge.scss'

import styles from '@/views/knowledge/workspace/overlay/section.module.scss'

interface SectionProps {
  composer: Editor | null
  isToolbarHidden?: boolean
  onScrollRatio?: (ratio: number) => void
  scrollHostRef?: React.RefObject<HTMLDivElement | null>
}

/**
 * 工具栏按钮一长串，单独成组件：Section 只保留「显不显示」的判断，
 * 否则整块 JSX 会把 Section 的认知复杂度顶上去。
 */
function FormatToolbar(props: { composer: Editor | null }) {
  return (
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
      <TextAlignButton
        editor={props.composer}
        align="justify"
        tooltip="两端对齐"
        hideWhenUnavailable
      />
      <TextButton
        editor={props.composer}
        tooltip="清除格式"
        hideWhenUnavailable
      />
      <Separator
        orientation="vertical"
        className="mx-0.5 h-auto shrink-0 self-stretch"
      />
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 gap-1 px-1.5 text-xs"
        title="打开 AI 助手（选中文字时直接改写）"
        onClick={function () {
          const editor = props.composer
          if (!editor) return
          const { from, to } = editor.state.selection
          useDockStore.getState().toOpen(from === to ? undefined : 'rewrite')
        }}>
        <Icon
          icon="lucide:sparkles"
          className="size-3.5"
        />
        AI
      </Button>
    </Glide.X>
  )
}

function Section(props: SectionProps) {
  const { composer, isToolbarHidden, onScrollRatio, scrollHostRef } = props

  const contentMaxWidth = useKnowledgeStore(function (state) {
    return state.contentMaxWidth
  })
  const fontSize = useKnowledgeStore(function (state) {
    return state.fontSize
  })
  const isFocusMode = useKnowledgeStore(function (state) {
    return state.isFocusMode
  })

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      {!isToolbarHidden && !isFocusMode ? <FormatToolbar composer={composer} /> : null}

      <ComposerContext value={{ editor: composer }}>
        <div
          ref={scrollHostRef}
          className={cn(styles.composer, styles.markdown, 'relative')}
          style={{ fontSize }}
          onScroll={function (event) {
            const target = event.currentTarget
            const max = target.scrollHeight - target.clientHeight
            onScrollRatio?.(max <= 0 ? 0 : target.scrollTop / max)
          }}>
          <div
            className="mx-auto w-full"
            style={{ maxWidth: contentMaxWidth }}>
            <ComposerMarkdown
              editor={composer}
              role="presentation"
            />
          </div>
          {composer ? (
            <BubbleMenu
              editor={composer}
              className="flex items-center gap-0.5 rounded-md border border-border bg-popover p-1 shadow-md">
              <MarkButton
                editor={composer}
                type="bold"
                hideWhenUnavailable
                showShortcut={false}
              />
              <MarkButton
                editor={composer}
                type="italic"
                hideWhenUnavailable
                showShortcut={false}
              />
              <LinkPopover
                editor={composer}
                hideWhenUnavailable
              />
              <ColorHighlightPopover
                editor={composer}
                hideWhenUnavailable
              />
              {/*
                这里不能用 portal：Tiptap 气泡菜单的默认 shouldShow 是
                「编辑器有焦点 或 document.activeElement 在菜单元素内」，
                Radix 把下拉内容 portal 到 body 后焦点就被算到菜单外 →
                气泡菜单隐藏、下拉内容成了孤儿并落到窗口左上角。
              */}
              <TurnIntoDropdown
                editor={composer}
                hideWhenUnavailable
              />
            </BubbleMenu>
          ) : null}
          {composer ? <SlashDropdownMenu editor={composer} /> : null}
          <Fallback.ErrorBoundary
            compact
            title="表格工具暂时不可用">
            <TableHandle editor={composer} />
            <TableSelectionOverlay
              editor={composer}
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
            <TableExtendRowColumnButtons editor={composer} />
          </Fallback.ErrorBoundary>
          <DragContextMenu
            editor={composer}
            withSlashCommandTrigger
          />
        </div>
      </ComposerContext>
    </div>
  )
}

export default Section
