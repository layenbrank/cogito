import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { ToggleGroup, ToggleGroupItem } from '@cogito/design/components/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@cogito/design/components/tooltip'
import { clsx } from 'clsx'

import { Glide } from '@/components/glide/glide'
import { formatBindingText } from '@/keyboard/binding'
import { SHORTCUT_COMMAND, resolveBinding } from '@/keyboard/definitions'
import { useCommands } from '@/keyboard/react'
import { useMorphStore } from '@/stores/morph.ts'
import { useSettingsStore } from '@/stores/setting'
import styles from './toolbar.module.scss'

const TOOL_BTN =
  'size-7 shrink-0 rounded-md text-muted-foreground hover:bg-muted/70 hover:text-foreground'
const TOOL_BTN_ACTIVE =
  'bg-primary/10 text-primary ring-1 ring-primary/35 hover:bg-primary/20 hover:text-primary'
const OP_BTN =
  'shrink-0 gap-1 px-2 text-xs font-normal text-muted-foreground hover:bg-muted/70 hover:text-foreground'
const OP_BTN_ACTIVE =
  'bg-primary/10 text-primary ring-1 ring-primary/35 hover:bg-primary/20 hover:text-primary'
const SEGMENT_ITEM =
  'cursor-pointer px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground data-[pressed]:bg-primary/10 data-[pressed]:text-primary'
const ACTION_BTN = 'h-7 px-3 text-xs font-medium'

type ToolDef = {
  key: Morph.Tool
  label: string
  /** 命令 id：键位在 `keyboard/definitions.ts`，这里不再手写字母（否则 tooltip 会与设置页漂移） */
  command: string
  icon: string
}

const TOOLS: ToolDef[] = [
  {
    key: 'select',
    label: '选择',
    command: SHORTCUT_COMMAND.MORPH_TOOL_SELECT,
    icon: 'ant-design:select-outlined'
  },
  {
    key: 'text',
    label: '文本',
    command: SHORTCUT_COMMAND.MORPH_TOOL_TEXT,
    icon: 'ant-design:font-size-outlined'
  },
  {
    key: 'highlight',
    label: '高亮',
    command: SHORTCUT_COMMAND.MORPH_TOOL_HIGHLIGHT,
    icon: 'ant-design:highlight-outlined'
  },
  {
    key: 'shape',
    label: '形状',
    command: SHORTCUT_COMMAND.MORPH_TOOL_SHAPE,
    icon: 'ant-design:border-outlined'
  },
  {
    key: 'stamp',
    label: '签章',
    command: SHORTCUT_COMMAND.MORPH_TOOL_STAMP,
    icon: 'ant-design:safety-certificate-outlined'
  }
]

interface ToolButtonProps {
  icon: string
  label: string
  tooltip?: string
  isActive?: boolean
  disabled?: boolean
  onClick: () => void
}

function ToolButton(props: ToolButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={props.label}
            aria-pressed={props.isActive}
            disabled={props.disabled}
            className={clsx(TOOL_BTN, props.isActive && TOOL_BTN_ACTIVE)}
            onClick={props.onClick}
          />
        }>
        <Icon
          icon={props.icon}
          className="size-4"
        />
      </TooltipTrigger>
      <TooltipContent side="bottom">{props.tooltip ?? props.label}</TooltipContent>
    </Tooltip>
  )
}

interface OpButtonProps {
  icon: string
  label: string
  tooltip: string
  isActive: boolean
  onClick: () => void
}

function OpButton(props: OpButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={props.isActive}
            className={clsx(OP_BTN, props.isActive && OP_BTN_ACTIVE)}
            onClick={props.onClick}
          />
        }>
        <Icon
          icon={props.icon}
          className="size-3.5 opacity-85"
        />
        {props.label}
      </TooltipTrigger>
      <TooltipContent side="bottom">{props.tooltip}</TooltipContent>
    </Tooltip>
  )
}

export default function Toolbar() {
  const activeTool = useMorphStore(function (s) {
    return s.activeTool
  })
  const viewMode = useMorphStore(function (s) {
    return s.viewMode
  })
  const offset = useMorphStore(function (s) {
    return s.offset
  })
  const count = useMorphStore(function (s) {
    return s.file?.count ?? 0
  })
  const zoom = useMorphStore(function (s) {
    return s.zoom
  })
  const toUndo = useMorphStore(function (s) {
    return s.toUndo
  })
  const toRedo = useMorphStore(function (s) {
    return s.toRedo
  })
  const undoCount = useMorphStore(function (s) {
    return s.toUndoStack.length
  })
  const redoCount = useMorphStore(function (s) {
    return s.toRedoStack.length
  })
  const toPickTool = useMorphStore(function (s) {
    return s.toPickTool
  })
  const toSwitchView = useMorphStore(function (s) {
    return s.toSwitchView
  })
  const toSeekOffset = useMorphStore(function (s) {
    return s.toSeekOffset
  })
  const toZoomIn = useMorphStore(function (s) {
    return s.toZoomIn
  })
  const toZoomOut = useMorphStore(function (s) {
    return s.toZoomOut
  })
  const toFitWidth = useMorphStore(function (s) {
    return s.toFitWidth
  })
  const toOpenOperation = useMorphStore(function (s) {
    return s.toOpenOperation
  })
  const toCloseOperation = useMorphStore(function (s) {
    return s.toCloseOperation
  })
  const activeOperation = useMorphStore(function (s) {
    return s.activeOperation
  })

  // 工具切换：键位在 `keyboard/definitions.ts`，命令只有工作区挂载时才注册 ——
  // 所以裸字母键（S/T/H/R/P/C/O）只在 PDF 标注界面里认，输入框内默认不认。
  useCommands(
    TOOLS.map(function (tool) {
      return {
        id: tool.command,
        title: `PDF 标注：${tool.label}工具`,
        keywords: `tool ${tool.key}`,
        group: 'PDF 标注',
        run: function () {
          useMorphStore.getState().toPickTool(tool.key)
        }
      }
    })
  )

  // 订阅覆盖值：用户改了键位，下面的 tooltip 要跟着变
  useSettingsStore(function (state) {
    return state.settings.shortcuts.bindings
  })

  return (
    <div className={clsx(styles.toolbar, styles.root)}>
      <div className={styles.navGroup}>
        <ToolButton
          icon="ant-design:left-outlined"
          label="上一页"
          disabled={offset === 0}
          onClick={function () {
            toSeekOffset(offset - 1, { source: 'toolbar' })
          }}
        />
        <input
          type="number"
          aria-label="页码"
          min={1}
          max={count || 1}
          value={offset + 1}
          className={styles.pageInput}
          onChange={function (event) {
            const next = event.target.valueAsNumber
            if (Number.isFinite(next)) toSeekOffset(next - 1, { source: 'toolbar' })
          }}
        />
        <ToolButton
          icon="ant-design:right-outlined"
          label="下一页"
          disabled={offset >= count - 1}
          onClick={function () {
            toSeekOffset(offset + 1, { source: 'toolbar' })
          }}
        />
        <span className={styles.pageTotal}>/ {count}</span>
        <span
          className={styles.sep}
          aria-hidden
        />
        <ToolButton
          icon="ant-design:zoom-out-outlined"
          label="缩小"
          onClick={toZoomOut}
        />
        <Button
          variant="ghost"
          size="sm"
          className={styles.zoomBtn}
          onClick={toFitWidth}>
          {Math.round(zoom * 100)}%
        </Button>
        <ToolButton
          icon="ant-design:zoom-in-outlined"
          label="放大"
          onClick={toZoomIn}
        />
      </div>

      <Glide.X
        classNames={{
          root: styles.scrollRoot,
          inner: styles.toolsRow
        }}>
        {TOOLS.map(function (tool) {
          return (
            <ToolButton
              key={tool.key}
              icon={tool.icon}
              label={tool.label}
              tooltip={`${tool.label} (${formatBindingText(resolveBinding(tool.command))})`}
              isActive={activeTool === tool.key}
              onClick={function () {
                toPickTool(tool.key)
              }}
            />
          )
        })}
        <span
          className={styles.sep}
          aria-hidden
        />
        <OpButton
          icon="ant-design:compress-outlined"
          label="合并"
          tooltip="将多个 PDF 合并为一个文件"
          isActive={activeOperation === 'merge'}
          onClick={function () {
            if (activeOperation === 'merge') toCloseOperation()
            else toOpenOperation('merge')
          }}
        />
        <OpButton
          icon="ant-design:scissor-outlined"
          label="拆分"
          tooltip="按页码范围或固定页数拆分"
          isActive={activeOperation === 'split'}
          onClick={function () {
            if (activeOperation === 'split') toCloseOperation()
            else toOpenOperation('split')
          }}
        />
        <OpButton
          icon="ant-design:swap-outlined"
          label="转换"
          tooltip="PDF ↔ Word / Excel / 图片"
          isActive={activeOperation === 'convert'}
          onClick={function () {
            if (activeOperation === 'convert') toCloseOperation()
            else toOpenOperation('convert')
          }}
        />
        <OpButton
          icon="ant-design:appstore-outlined"
          label="整理"
          tooltip="重排、旋转或删除页面"
          isActive={activeOperation === 'organize'}
          onClick={function () {
            if (activeOperation === 'organize') toCloseOperation()
            else toOpenOperation('organize')
          }}
        />
        <OpButton
          icon="ant-design:export-outlined"
          label="抽取"
          tooltip="抽取选中页为新 PDF"
          isActive={activeOperation === 'extract'}
          onClick={function () {
            if (activeOperation === 'extract') toCloseOperation()
            else toOpenOperation('extract')
          }}
        />
        <span
          className={styles.sep}
          aria-hidden
        />
        <ToolButton
          icon="ant-design:undo-outlined"
          label="撤销"
          disabled={undoCount === 0}
          onClick={function () {
            void toUndo()
          }}
        />
        <ToolButton
          icon="ant-design:redo-outlined"
          label="重做"
          disabled={redoCount === 0}
          onClick={function () {
            void toRedo()
          }}
        />
      </Glide.X>

      <div className={styles.rightGroup}>
        <ToggleGroup
          size="sm"
          spacing={0}
          variant="outline"
          value={[viewMode]}
          className="shadow-xs"
          onValueChange={function (value) {
            const next = value[0]
            if (next === 'view' || next === 'edit') toSwitchView(next)
          }}>
          <ToggleGroupItem
            value="view"
            className={SEGMENT_ITEM}>
            浏览
          </ToggleGroupItem>
          <ToggleGroupItem
            value="edit"
            className={SEGMENT_ITEM}>
            编辑
          </ToggleGroupItem>
        </ToggleGroup>
        <span
          className={styles.sep}
          aria-hidden
        />
        <Button
          size="sm"
          className={ACTION_BTN}>
          导出
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={ACTION_BTN}>
          打印
        </Button>
      </div>
    </div>
  )
}
