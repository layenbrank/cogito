import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@cogito/design/components/popover'
import { cn } from 'cn'
import { toast } from 'sonner'

import { useCodeStore, type CodeIndentation, type CodeTypesMode, type Eol } from '@/stores/code'
import { readEol, updateEol, updateIndentation } from '@/views/code/lib/document-options.ts'
import { findModel } from '@/views/code/lib/monaco-models.ts'
import { syncWorkspaceTypescriptLibs } from '@/views/code/lib/monaco-types.ts'

const INDENT_PRESETS: { label: string; value: CodeIndentation }[] = [
  { label: '空格: 2', value: { tabSize: 2, insertSpaces: true } },
  { label: '空格: 4', value: { tabSize: 4, insertSpaces: true } },
  { label: '制表符', value: { tabSize: 4, insertSpaces: false } }
]

const EOL_PRESETS: { label: string; value: Eol }[] = [
  { label: 'LF', value: 'LF' },
  { label: 'CRLF', value: 'CRLF' }
]

/** `@types` 注入档位：状态栏与资源管理器头部共用同一份 store 值 */
const TYPES_MODE_ITEMS: { label: string; value: CodeTypesMode }[] = [
  { label: '按需（精简）', value: 'lean' },
  { label: '总是注入', value: 'full' },
  { label: '关闭', value: 'off' }
]

const TYPES_MODE_LABELS: Record<CodeTypesMode, string> = {
  lean: 'TS 类型：精简',
  full: 'TS 类型：已注入',
  off: 'TS 类型：关闭'
}

/** 状态栏的单选项按钮 */
function StatusItem(props: {
  label: string
  title?: string
  onClick?: () => void
  className?: string
}) {
  return (
    <Button
      variant="ghost"
      type="button"
      title={props.title ?? props.label}
      className={cn(
        'h-auto hover:bg-foreground/5 hover:text-foreground shrink-0 px-2 py-0.5',
        props.className
      )}
      onClick={props.onClick}>
      {props.label}
    </Button>
  )
}

/** 弹出式选择：状态栏里改文档选项时统一用这个形态 */
function StatusPicker(props: {
  label: string
  isDisabled: boolean
  items: { label: string; value: string }[]
  selected: string
  onSelect: (value: string) => void
}) {
  if (props.isDisabled) return <StatusItem label={props.label} />
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            type="button"
            title={`${props.label}（点击切换）`}
            className="h-auto hover:bg-foreground/5 hover:text-foreground shrink-0 px-2 py-0.5">
            {props.label}
          </Button>
        }
      />
      <PopoverContent
        align="end"
        className="w-36 p-1">
        <ul className="list-none">
          {props.items.map(function (item) {
            const isActive = item.value === props.selected
            return (
              <li key={item.value}>
                <Button
                  variant="ghost"
                  type="button"
                  className={cn(
                    'h-auto hover:bg-muted flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-xs',
                    isActive && 'text-primary'
                  )}
                  onClick={function () {
                    props.onSelect(item.value)
                  }}>
                  <Icon
                    icon="lucide:check"
                    className={cn('size-3 shrink-0', !isActive && 'opacity-0')}
                  />
                  {item.label}
                </Button>
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

function Summary() {
  const tabs = useCodeStore(function (state) {
    return state.tabs
  })
  const activeTabId = useCodeStore(function (state) {
    return state.activeTabId
  })
  const cursor = useCodeStore(function (state) {
    return state.cursor
  })
  const languageId = useCodeStore(function (state) {
    return state.languageId
  })
  const problemCounts = useCodeStore(function (state) {
    return state.problemCounts
  })
  const workspaceRoot = useCodeStore(function (state) {
    return state.workspaceRoot
  })
  const roots = useCodeStore(function (state) {
    return state.roots
  })
  const indentation = useCodeStore(function (state) {
    return state.indentation
  })
  const eol = useCodeStore(function (state) {
    return state.eol
  })
  const isLargeFile = useCodeStore(function (state) {
    return state.isLargeFile
  })
  const tsTypesMode = useCodeStore(function (state) {
    return state.tsTypesMode
  })

  const activeTab = tabs.find(function (tab) {
    return tab.id === activeTabId
  })
  const isEditable = Boolean(activeTab) && !isLargeFile

  function onCopyPath() {
    if (!activeTab?.path) return
    void navigator.clipboard.writeText(activeTab.path).then(function () {
      toast.success('已复制路径')
    })
  }

  function onSelectIndent(label: string) {
    const preset = INDENT_PRESETS.find(function (item) {
      return item.label === label
    })
    if (!preset || !activeTab) return
    const model = findModel(activeTab.path)
    if (!model) return
    updateIndentation(model, preset.value)
    useCodeStore.getState().toSetIndentation(preset.value)
  }

  function onSelectEol(value: string) {
    if (!activeTab) return
    const next = EOL_PRESETS.find(function (item) {
      return item.value === value
    })
    if (!next) return
    const model = findModel(activeTab.path)
    if (!model) return
    updateEol(model, next.value)
    useCodeStore.getState().toSetEol(readEol(model))
  }

  /** 切档位立刻生效：`isForced` 绕过指纹，off 会当场清掉已注入的 extraLibs */
  function onSelectTypesMode(value: string) {
    const next = TYPES_MODE_ITEMS.find(function (item) {
      return item.value === value
    })
    if (!next) return
    useCodeStore.getState().toSetTsTypesMode(next.value)
    void syncWorkspaceTypescriptLibs(useCodeStore.getState().roots, {
      mode: next.value,
      isForced: true
    })
  }

  const indentLabel = indentation.insertSpaces
    ? `空格: ${indentation.tabSize}`
    : `制表符: ${indentation.tabSize}`

  const workspaceLabel = workspaceRoot
    ? `${workspaceRoot.split(/[\\/]/).filter(Boolean).pop()}${roots.length > 1 ? ` +${roots.length - 1}` : ''}`
    : '未打开工作区'

  return (
    <div
      className={cn(
        'text-muted-foreground flex h-5.5 w-full min-w-0 items-center justify-between text-xs leading-none'
      )}>
      <div className="flex min-w-0 items-center">
        <Button
          variant="ghost"
          type="button"
          className="h-auto hover:bg-foreground/5 hover:text-foreground flex max-w-40 items-center gap-1 truncate px-2 py-0.5"
          title={roots.length > 0 ? roots.join('\n') : '未打开工作区'}
          onClick={function () {
            useCodeStore.getState().toSetSidebarView('explorer')
          }}>
          <Icon
            icon="lucide:folder"
            className="size-3 shrink-0 opacity-60"
          />
          <span className="truncate">{workspaceLabel}</span>
        </Button>
        <Button
          variant="ghost"
          type="button"
          className="h-auto hover:bg-foreground/5 hover:text-foreground flex items-center gap-1 px-2 py-0.5"
          title="查看问题"
          onClick={function () {
            useCodeStore.getState().toToggleSurface('problems')
          }}>
          <Icon
            icon="lucide:circle-x"
            className="size-3 shrink-0 opacity-60"
          />
          <span>{problemCounts.errors}</span>
          <Icon
            icon="lucide:triangle-alert"
            className="size-3 shrink-0 opacity-60"
          />
          <span>{problemCounts.warnings}</span>
        </Button>
        {isLargeFile ? (
          <span
            className="px-2"
            title="文件较大，已以只读方式打开">
            只读（大文件）
          </span>
        ) : activeTab?.isDirty ? (
          <span className="px-2 text-amber-600 dark:text-amber-400">未保存</span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center">
        <StatusItem
          label={activeTab ? activeTab.title : '—'}
          title={activeTab?.path}
          onClick={activeTab ? onCopyPath : undefined}
        />
        <StatusItem
          label={`行 ${cursor.line}, 列 ${cursor.column}`}
          className={isEditable ? undefined : 'opacity-60'}
        />
        <StatusPicker
          label={indentLabel}
          isDisabled={!isEditable}
          items={INDENT_PRESETS.map(function (preset) {
            return { label: preset.label, value: preset.label }
          })}
          selected={indentLabel}
          onSelect={onSelectIndent}
        />
        <StatusItem
          label="UTF-8"
          title="文件编码"
        />
        <StatusPicker
          label={eol}
          isDisabled={!isEditable}
          items={EOL_PRESETS.map(function (preset) {
            return { label: preset.label, value: preset.value }
          })}
          selected={eol}
          onSelect={onSelectEol}
        />
        <StatusPicker
          label={TYPES_MODE_LABELS[tsTypesMode]}
          isDisabled={roots.length === 0}
          items={TYPES_MODE_ITEMS.map(function (item) {
            return { label: item.label, value: item.value }
          })}
          selected={tsTypesMode}
          onSelect={onSelectTypesMode}
        />
        <StatusItem
          label={languageId}
          className="capitalize"
        />
      </div>
    </div>
  )
}

export default Summary
