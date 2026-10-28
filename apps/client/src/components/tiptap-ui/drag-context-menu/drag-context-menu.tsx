'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Node as TiptapNode } from '@tiptap/pm/model'
import { offset } from '@floating-ui/react'
import { DragHandle } from '@tiptap/extension-drag-handle-react'

// Hooks
import { useTiptapEditor } from '@/hooks/use-tiptap-editor.ts'
import { useIsBreakpoint } from '@/hooks/use-is-breakpoint.ts'
import { useUiEditorState } from '@/hooks/use-ui-editor-state.ts'
import { selectNodeAndHideFloating } from '@/hooks/use-floating-toolbar-visibility.ts'

// Primitive UI Components
import {
  Button,
  ButtonGroup
} from '@/components/tiptap-ui-primitive/button/button.tsx'
import { Spacer } from '@/components/tiptap-ui-primitive/spacer/spacer.tsx'
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuGroup,
  MenuGroupLabel,
  MenuButton
} from '@/components/tiptap-ui-primitive/menu/menu.tsx'
import {
  Combobox,
  ComboboxList
} from '@/components/tiptap-ui-primitive/combobox/combobox.tsx'
import { Separator } from '@/components/tiptap-ui-primitive/separator/separator.tsx'

// Tiptap UI
import { useImageDownload } from '@/components/tiptap-ui/image-download-button/use-image-download.ts'
import { useDuplicate } from '@/components/tiptap-ui/duplicate-button/use-duplicate.ts'
import { DuplicateShortcutBadge } from '@/components/tiptap-ui/duplicate-button/duplicate-button.tsx'
import { useCopyToClipboard } from '@/components/tiptap-ui/copy-to-clipboard-button/use-copy-to-clipboard.ts'
import { CopyToClipboardShortcutBadge } from '@/components/tiptap-ui/copy-to-clipboard-button/copy-to-clipboard-button.tsx'
import { useDeleteNode } from '@/components/tiptap-ui/delete-node-button/use-delete-node.ts'
import { DeleteNodeShortcutBadge } from '@/components/tiptap-ui/delete-node-button/delete-node-button.tsx'
import { useCopyAnchorLink } from '@/components/tiptap-ui/copy-anchor-link-button/use-copy-anchor-link.ts'
import { CopyAnchorLinkShortcutBadge } from '@/components/tiptap-ui/copy-anchor-link-button/copy-anchor-link-button.tsx'
import { useResetAllFormatting } from '@/components/tiptap-ui/reset-all-formatting-button/use-reset-all-formatting.ts'
import { SlashCommandTriggerButton } from '@/components/tiptap-ui/slash-command-trigger-button/slash-command-trigger-button.tsx'
import { AskAiShortcutBadge } from '@/components/tiptap-ui/ai-ask-button/ai-ask-button.tsx'
import { useAiAsk } from '@/components/tiptap-ui/ai-ask-button/use-ai-ask.ts'
import { useText } from '@/components/tiptap-ui/text-button/use-text.ts'
import { useHeading } from '@/components/tiptap-ui/heading-button/use-heading.ts'
import { useList } from '@/components/tiptap-ui/list-button/use-list.ts'
import { useBlockquote } from '@/components/tiptap-ui/blockquote-button/use-blockquote.ts'
import { useCodeBlock } from '@/components/tiptap-ui/code-block-button/use-code-block.ts'
import { ColorMenu } from '@/components/tiptap-ui/color-menu/color-menu.tsx'
import { TableAlignMenu } from '@/components/tiptap-node/table-node/ui/table-alignment-menu/table-alignment-menu.tsx'
import { useTableFitToWidth } from '@/components/tiptap-node/table-node/ui/table-fit-to-width-button/use-table-fit-to-width.ts'
import { useTableClearRowColumnContent } from '@/components/tiptap-node/table-node/ui/table-clear-row-column-content-button/use-table-clear-row-column-content.ts'

// Utils
import {
  getNodeDisplayName,
  isTextSelectionValid
} from '@/lib/tiptap-collab-utils.ts'
import { SR_ONLY } from '@/lib/tiptap-utils.ts'

import type {
  DragContextMenuProps,
  MenuItemProps,
  NodeChangeData
} from '@/components/tiptap-ui/drag-context-menu/drag-context-menu-types'

// Icons
import { GripVerticalIcon } from '@/components/tiptap-icons/grip-vertical-icon'
import { ChevronRightIcon } from '@/components/tiptap-icons/chevron-right-icon'
import { Repeat2Icon } from '@/components/tiptap-icons/repeat-2-icon'
import './drag-context-menu.scss'

const RESET_PRESERVE_MARKS = ['inlineThread']

const useNodeTransformActions = () => {
  const text = useText()
  const heading1 = useHeading({ level: 1 })
  const heading2 = useHeading({ level: 2 })
  const heading3 = useHeading({ level: 3 })
  const bulletList = useList({ type: 'bulletList' })
  const orderedList = useList({ type: 'orderedList' })
  const taskList = useList({ type: 'taskList' })
  const blockquote = useBlockquote()
  const codeBlock = useCodeBlock()

  const mapper = (
    action: ReturnType<
      | typeof useText
      | typeof useHeading
      | typeof useList
      | typeof useBlockquote
      | typeof useCodeBlock
    >
  ) => ({
    icon: action.Icon,
    label: action.label,
    onClick: action.handleToggle,
    disabled: !action.canToggle,
    isActive: action.isActive
  })

  const actions = [
    mapper(text),
    ...[heading1, heading2, heading3].map(mapper),
    mapper(bulletList),
    mapper(orderedList),
    mapper(taskList),
    mapper(blockquote),
    mapper(codeBlock)
  ]

  const allDisabled = actions.every((a) => a.disabled)

  return allDisabled ? null : actions
}

const BaseMenuItem: React.FC<MenuItemProps> = ({
  icon: Icon,
  label,
  onClick,
  disabled = false,
  isActive = false,
  shortcutBadge
}) => (
  <MenuItem
    render={
      <Button
        data-style="ghost"
        data-active-state={isActive ? 'on' : 'off'}
      />
    }
    onClick={onClick}
    disabled={disabled}>
    <Icon className="size-3.5 shrink-0" />
    <span className="truncate text-xs">{label}</span>
    {shortcutBadge}
  </MenuItem>
)

const SubMenuTrigger: React.FC<{
  icon: React.ComponentType<{ className?: string }>
  label: string
  children: React.ReactNode
}> = ({ icon: Icon, label, children }) => (
  <Menu
    placement="right"
    trigger={
      <MenuItem
        render={
          <MenuButton
            render={
              <Button data-style="ghost">
                <Icon className="size-3.5 shrink-0" />
                <span className="truncate text-xs">{label}</span>
                <Spacer />
                <ChevronRightIcon className="size-3.5 shrink-0" />
              </Button>
            }
          />
        }
      />
    }>
    <MenuContent
      style={{
        zIndex: 1000
      }}
      portal>
      <ComboboxList>{children}</ComboboxList>
    </MenuContent>
  </Menu>
)

const TransformActionGroup: React.FC = () => {
  const actions = useNodeTransformActions()
  const { canReset, handleResetFormatting, label, Icon } =
    useResetAllFormatting({
      hideWhenUnavailable: true,
      preserveMarks: RESET_PRESERVE_MARKS
    })

  if (!actions && !canReset) return null

  return (
    <>
      {actions && (
        <SubMenuTrigger
          icon={Repeat2Icon}
          label={t('EDITOR_TURN_INTO')}>
          <MenuGroup>
            <MenuGroupLabel>{t('EDITOR_TURN_INTO')}</MenuGroupLabel>
            {actions.map((action) => (
              <BaseMenuItem
                key={action.label}
                {...action}
              />
            ))}
          </MenuGroup>
        </SubMenuTrigger>
      )}

      {canReset && (
        <BaseMenuItem
          icon={Icon}
          label={label}
          disabled={!canReset}
          onClick={handleResetFormatting}
        />
      )}

      <Separator orientation="horizontal" />
    </>
  )
}

const TableFitToWidth: React.FC = () => {
  const { canFitToWidth, handleFitToWidth, label, Icon } = useTableFitToWidth({
    hideWhenUnavailable: true
  })
  const clearAllContents = useTableClearRowColumnContent({ resetAttrs: true })

  return (
    <>
      {canFitToWidth && (
        <BaseMenuItem
          icon={Icon}
          label={label}
          disabled={!canFitToWidth}
          onClick={handleFitToWidth}
        />
      )}

      {clearAllContents.canClearRowColumnContent && (
        <BaseMenuItem
          icon={clearAllContents.Icon}
          label={t('EDITOR_CLEAR_ALL_CONTENTS')}
          disabled={!clearAllContents.canClearRowColumnContent}
          onClick={clearAllContents.handleClear}
        />
      )}
    </>
  )
}

const ImageActionGroup: React.FC = () => {
  const { canDownload, handleDownload, label, Icon } = useImageDownload({
    hideWhenUnavailable: true
  })

  if (!canDownload) return null

  return (
    <>
      <BaseMenuItem
        icon={Icon}
        label={label}
        disabled={!canDownload}
        onClick={handleDownload}
      />

      <Separator orientation="horizontal" />
    </>
  )
}

const CogitoActionGroup: React.FC = () => {
  const {
    handleDuplicate,
    canDuplicate,
    label,
    Icon: DuplicateIcon
  } = useDuplicate()
  const {
    handleCopyToClipboard,
    canCopyToClipboard,
    label: copyLabel,
    Icon: CopyIcon
  } = useCopyToClipboard()
  const {
    handleCopyAnchorLink,
    canCopyAnchorLink,
    isVisible: isCopyAnchorVisible,
    label: copyAnchorLinkLabel,
    Icon: CopyAnchorLinkIcon
  } = useCopyAnchorLink({ hideWhenUnavailable: true })

  return (
    <>
      <MenuGroup>
        <BaseMenuItem
          icon={DuplicateIcon}
          label={label}
          onClick={handleDuplicate}
          disabled={!canDuplicate}
          shortcutBadge={<DuplicateShortcutBadge />}
        />
        <BaseMenuItem
          icon={CopyIcon}
          label={copyLabel}
          onClick={handleCopyToClipboard}
          disabled={!canCopyToClipboard}
          shortcutBadge={<CopyToClipboardShortcutBadge />}
        />
        {isCopyAnchorVisible && canCopyAnchorLink ? (
          <BaseMenuItem
            icon={CopyAnchorLinkIcon}
            label={copyAnchorLinkLabel}
            onClick={handleCopyAnchorLink}
            shortcutBadge={<CopyAnchorLinkShortcutBadge />}
          />
        ) : null}
      </MenuGroup>

      <Separator orientation="horizontal" />
    </>
  )
}

const AIActionGroup: React.FC = () => {
  const { handleAiAsk, canAiAsk, isVisible, Icon: AiAskIcon } = useAiAsk({
    hideWhenUnavailable: true
  })

  if (!isVisible || !canAiAsk) return null

  return (
    <>
      <MenuGroup>
        <BaseMenuItem
          icon={AiAskIcon}
          label={t('EDITOR_ASK_AI')}
          onClick={handleAiAsk}
          shortcutBadge={<AskAiShortcutBadge />}
        />
      </MenuGroup>

      <Separator orientation="horizontal" />
    </>
  )
}

const DeleteActionGroup: React.FC = () => {
  const { handleDeleteNode, canDeleteNode, label, Icon } = useDeleteNode()

  return (
    <MenuGroup>
      <BaseMenuItem
        icon={Icon}
        label={label}
        onClick={handleDeleteNode}
        disabled={!canDeleteNode}
        shortcutBadge={<DeleteNodeShortcutBadge />}
      />
    </MenuGroup>
  )
}

export const DragContextMenu: React.FC<DragContextMenuProps> = ({
  editor: providedEditor,
  withSlashCommandTrigger = true,
  mobileBreakpoint = 768,
  ...props
}) => {
  const { editor } = useTiptapEditor(providedEditor)
  const { aiGenerationActive, isDragging } = useUiEditorState(editor)
  const isMobile = useIsBreakpoint('max', mobileBreakpoint)
  const [open, setOpen] = useState(false)
  const [node, setNode] = useState<TiptapNode | null>(null)
  const [nodePos, setNodePos] = useState<number>(-1)

  const handleNodeChange = useCallback((data: NodeChangeData) => {
    if (data.node) setNode(data.node)
    setNodePos(data.pos)
  }, [])

  useEffect(() => {
    if (!editor) return
    editor.commands.setLockDragHandle(open)
    editor.commands.setMeta('lockDragHandle', open)
  }, [editor, open])

  const mainAxisOffset = 16

  const dynamicPositions = useMemo(() => {
    return {
      middleware: [
        offset((props) => {
          const { rects } = props
          const nodeHeight = rects.reference.height
          const dragHandleHeight = rects.floating.height

          const crossAxis = nodeHeight / 2 - dragHandleHeight / 2

          return {
            mainAxis: mainAxisOffset,
            // if height is more than 40px, then it's likely a block node
            crossAxis: nodeHeight > 40 ? 0 : crossAxis
          }
        })
      ]
    }
  }, [])

  const handleOnMenuClose = useCallback(() => {
    if (editor) {
      editor.commands.setMeta('hideDragHandle', true)
    }
  }, [editor])

  const onElementDragStart = useCallback(() => {
    if (!editor) return
    editor.commands.setIsDragging(true)
  }, [editor])

  const onElementDragEnd = useCallback(() => {
    if (!editor) return
    editor.commands.setIsDragging(false)

    setTimeout(() => {
      editor.view.dom.blur()
      editor.view.focus()
    }, 0)
  }, [editor])

  if (!editor) return null

  const nodeName = getNodeDisplayName(editor)

  return (
    <div
      style={
        {
          '--drag-handle-main-axis-offset': `${mainAxisOffset}px`
        } as React.CSSProperties
      }>
      <DragHandle
        editor={editor}
        onNodeChange={handleNodeChange}
        computePositionConfig={dynamicPositions}
        onElementDragStart={onElementDragStart}
        onElementDragEnd={onElementDragEnd}
        {...props}>
        <ButtonGroup
          orientation="horizontal"
          style={{
            ...(aiGenerationActive || isMobile || isTextSelectionValid(editor)
              ? { opacity: 0, pointerEvents: 'none' }
              : {}),
            ...(isDragging ? { opacity: 0 } : {})
          }}>
          {withSlashCommandTrigger && (
            <SlashCommandTriggerButton
              node={node}
              nodePos={nodePos}
              data-weight="small"
            />
          )}

          <Menu
            open={open}
            onOpenChange={setOpen}
            placement="left"
            trigger={
              <MenuButton
                render={
                  <Button
                    data-style="ghost"
                    tabIndex={-1}
                    tooltip={
                      <>
                        <div>{t('EDITOR_DRAG_CLICK')}</div>
                        <div>{t('EDITOR_DRAG_HOLD')}</div>
                      </>
                    }
                    data-weight="small"
                    style={{
                      cursor: 'grab',
                      ...(open ? { pointerEvents: 'none' } : {})
                    }}
                    onMouseDown={() =>
                      selectNodeAndHideFloating(editor, nodePos)
                    }>
                    <GripVerticalIcon className="size-3.5 shrink-0" />
                  </Button>
                }
              />
            }>
            <MenuContent
              style={{
                zIndex: 1000
              }}
              onClose={handleOnMenuClose}
              autoFocusOnHide={false}
              preventBodyScroll={true}
              portal>
              <Combobox style={{ ...SR_ONLY, zIndex: 1000 }} />
              <ComboboxList style={{ minWidth: '15rem', zIndex: 1000 }}>
                <MenuGroup>
                  <MenuGroupLabel>{nodeName}</MenuGroupLabel>
                  <ColorMenu />
                  <TableAlignMenu />
                  <TableFitToWidth />
                  <TransformActionGroup />
                  <ImageActionGroup />
                </MenuGroup>

                <CogitoActionGroup />

                <AIActionGroup />

                <DeleteActionGroup />
              </ComboboxList>
            </MenuContent>
          </Menu>
        </ButtonGroup>
      </DragHandle>
    </div>
  )
}

import { t } from '@/views/knowledge/locale.ts'