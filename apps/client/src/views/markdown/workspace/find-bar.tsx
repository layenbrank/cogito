/**
 * 文档内查找/替换：对齐 VS Code 右上角浮动栏，Ctrl+F / Ctrl+H 打开。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { Input } from '@i-thinking/design/components/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@i-thinking/design/components/tooltip'
import type { Editor } from '@tiptap/react'
import { cn } from 'cn'
import { useEffect, useRef, useState, type RefObject } from 'react'

import { useMarkdownStore } from '@/stores/markdown'
import {
  clearSearchHighlight,
  countHits,
  findStep,
  replaceAll,
  replaceOne,
  revealMatch
} from '@/views/markdown/lib/find-in-doc.ts'
import { t } from '@/views/markdown/locale.ts'

interface FindBarProps {
  editor: Editor | null
  /** 打开时是否展开替换行（Ctrl+H） */
  preferReplace?: boolean
  /** 为 true 时下移避开格式工具条（约 36px） */
  clearToolbar?: boolean
}

function OptionToggle(props: {
  label: string
  pressed: boolean
  onToggle: () => void
  children: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={props.label}
            aria-pressed={props.pressed}
            className={cn(
              'flex size-6 items-center justify-center rounded text-[11px] font-medium leading-none',
              props.pressed
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
            onClick={props.onToggle}
          />
        }>
        {props.children}
      </TooltipTrigger>
      <TooltipContent side="bottom">{props.label}</TooltipContent>
    </Tooltip>
  )
}

/** 搜索行的右侧按钮组：上一个 / 下一个 / 关闭 */
function FindNavButtons(props: {
  matchLabel: string
  onStep: (direction: 1 | -1) => void
  onClose: () => void
}) {
  return (
    <>
      <span className="shrink-0 px-1 text-[11px] whitespace-nowrap text-muted-foreground tabular-nums">
        {props.matchLabel}
      </span>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-6 rounded"
              aria-label="上一个"
              onClick={function () {
                props.onStep(-1)
              }}
            />
          }>
          <Icon
            icon="lucide:arrow-up"
            className="size-3.5"
          />
        </TooltipTrigger>
        <TooltipContent side="bottom">上一个</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-6 rounded"
              aria-label="下一个"
              onClick={function () {
                props.onStep(1)
              }}
            />
          }>
          <Icon
            icon="lucide:arrow-down"
            className="size-3.5"
          />
        </TooltipTrigger>
        <TooltipContent side="bottom">下一个</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-6 rounded"
              aria-label="关闭"
              onClick={props.onClose}
            />
          }>
          <Icon
            icon="lucide:x"
            className="size-3.5"
          />
        </TooltipTrigger>
        <TooltipContent side="bottom">关闭（Esc）</TooltipContent>
      </Tooltip>
    </>
  )
}

/** 搜索行：折叠三角 + 输入框（含 Aa / ab / .* 开关）+ 导航按钮 */
function FindRow(props: {
  inputRef: RefObject<HTMLInputElement | null>
  query: string
  placeholder: string
  isReplaceOpen: boolean
  isMatchCase: boolean
  isWholeWord: boolean
  isRegex: boolean
  matchLabel: string
  onChangeQuery: (value: string) => void
  onToggleReplace: () => void
  onToggleMatchCase: () => void
  onToggleWholeWord: () => void
  onToggleRegex: () => void
  onStep: (direction: 1 | -1) => void
  onClose: () => void
}) {
  const {
    inputRef,
    query,
    placeholder,
    isReplaceOpen,
    isMatchCase,
    isWholeWord,
    isRegex,
    matchLabel,
    onChangeQuery,
    onToggleReplace,
    onToggleMatchCase,
    onToggleWholeWord,
    onToggleRegex,
    onStep,
    onClose
  } = props

  return (
    <div className="flex items-start gap-1">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="mt-0.5 size-6 shrink-0 rounded"
        aria-label={isReplaceOpen ? '收起替换' : '展开替换'}
        aria-expanded={isReplaceOpen}
        onClick={onToggleReplace}>
        <Icon
          icon="lucide:chevron-right"
          className={cn('size-3.5 transition-transform', isReplaceOpen && 'rotate-90')}
        />
      </Button>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-1">
          <div className="relative min-w-0 flex-1">
            <Input
              ref={inputRef}
              value={query}
              placeholder={placeholder}
              className="h-7 pr-[4.5rem] text-xs"
              onChange={function (event) {
                onChangeQuery(event.target.value)
              }}
              onKeyDown={function (event) {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  event.stopPropagation()
                  onStep(event.shiftKey ? -1 : 1)
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  onClose()
                }
              }}
            />
            <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5">
              <OptionToggle
                label="区分大小写"
                pressed={isMatchCase}
                onToggle={onToggleMatchCase}>
                Aa
              </OptionToggle>
              <OptionToggle
                label="全字匹配"
                pressed={isWholeWord}
                onToggle={onToggleWholeWord}>
                ab
              </OptionToggle>
              <OptionToggle
                label="正则表达式"
                pressed={isRegex}
                onToggle={onToggleRegex}>
                .*
              </OptionToggle>
            </div>
          </div>

          <FindNavButtons
            matchLabel={matchLabel}
            onStep={onStep}
            onClose={onClose}
          />
        </div>
      </div>
    </div>
  )
}

/** 替换行：替换内容 + 替换 / 全部替换 */
function ReplaceRow(props: {
  value: string
  onChangeValue: (value: string) => void
  onReplaceOne: () => void
  onReplaceAll: () => void
  onClose: () => void
}) {
  return (
    <div className="flex items-center gap-1">
      <Input
        value={props.value}
        placeholder={t('REPLACE')}
        className="h-7 min-w-0 flex-1 text-xs"
        onChange={function (event) {
          props.onChangeValue(event.target.value)
        }}
        onKeyDown={function (event) {
          if (event.key === 'Enter') {
            event.preventDefault()
            props.onReplaceOne()
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            props.onClose()
          }
        }}
      />
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-6 rounded"
              aria-label="替换"
              onClick={props.onReplaceOne}
            />
          }>
          <Icon
            icon="lucide:replace"
            className="size-3.5"
          />
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('REPLACE')}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-6 rounded"
              aria-label="全部替换"
              onClick={props.onReplaceAll}
            />
          }>
          <Icon
            icon="lucide:list-restart"
            className="size-3.5"
          />
        </TooltipTrigger>
        <TooltipContent side="bottom">全部替换</TooltipContent>
      </Tooltip>
    </div>
  )
}

function FindBar(props: FindBarProps) {
  const findQuery = useMarkdownStore(function (state) {
    return state.findQuery
  })
  const findReplace = useMarkdownStore(function (state) {
    return state.findReplace
  })
  const toSetFindQuery = useMarkdownStore(function (state) {
    return state.toSetFindQuery
  })
  const toSetFindReplace = useMarkdownStore(function (state) {
    return state.toSetFindReplace
  })
  const toSetFindOpen = useMarkdownStore(function (state) {
    return state.toSetFindOpen
  })

  const [isReplaceOpen, setIsReplaceOpen] = useState(Boolean(props.preferReplace))
  const [wasPreferReplace, setWasPreferReplace] = useState(props.preferReplace)
  // prop 变化时调整 state 用渲染期写法（React 推荐），不要走 effect
  if (props.preferReplace !== wasPreferReplace) {
    setWasPreferReplace(props.preferReplace)
    if (props.preferReplace) setIsReplaceOpen(true)
  }
  const [isMatchCase, setIsMatchCase] = useState(false)
  const [isWholeWord, setIsWholeWord] = useState(false)
  const [isRegex, setIsRegex] = useState(false)
  const [matchIndexState, setMatchIndex] = useState(-1)

  const findInputRef = useRef<HTMLInputElement>(null)

  useEffect(function () {
    const timer = window.setTimeout(function () {
      findInputRef.current?.focus()
      findInputRef.current?.select()
    }, 0)
    return function () {
      window.clearTimeout(timer)
    }
  }, [])

  // 关闭查找栏时清掉文档高亮
  useEffect(
    function () {
      const editor = props.editor
      return function () {
        if (editor) clearSearchHighlight(editor)
      }
    },
    [props.editor]
  )

  // 无查询词时一律展示为「无命中」：派生即可，不必在 effect 里清 state
  const hasQuery = Boolean(findQuery)
  const matchIndex = hasQuery ? matchIndexState : -1
  // 总数直接从文档算（纯函数）：始终与内容一致，不必镜像进 state
  const matchTotal = hasQuery && props.editor ? countHits(props.editor, options()) : 0

  function keepFindFocus() {
    // 编辑器选区更新后把焦点拉回查找框，保证连续 Enter
    requestAnimationFrame(function () {
      findInputRef.current?.focus({ preventScroll: true })
    })
  }

  function options() {
    return {
      query: findQuery,
      isMatchCase,
      isWholeWord,
      isRegex
    }
  }

  function close() {
    toSetFindOpen(false)
  }

  // 输入实时定位首个命中 + 全量高亮（对齐 VS Code），不抢输入框焦点
  useEffect(
    function () {
      if (!props.editor || !findQuery) {
        if (props.editor) clearSearchHighlight(props.editor)
        return
      }
      const result = revealMatch(props.editor, options(), 0)
      // 高亮/选区是编辑器（外部系统）的副作用，这里只把当前命中序号镜像给 UI
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reveal 后需刷新序号显示
      setMatchIndex(result.index)
      keepFindFocus()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.editor, findQuery, isMatchCase, isWholeWord, isRegex]
  )

  function runFind(direction: 1 | -1) {
    if (!props.editor || !findQuery) return
    const result = findStep(props.editor, options(), direction)
    setMatchIndex(result.index)
    keepFindFocus()
  }

  function runReplaceOne() {
    if (!props.editor || !findQuery) return
    const result = replaceOne(props.editor, options(), findReplace)
    setMatchIndex(result.index)
    keepFindFocus()
  }

  function runReplaceAll() {
    if (!props.editor || !findQuery) return
    replaceAll(props.editor, options(), findReplace)
    setMatchIndex(-1)
    keepFindFocus()
  }

  const matchLabel =
    !findQuery || matchTotal <= 0
      ? '无结果'
      : matchIndex >= 0
        ? `第 ${matchIndex + 1} 项，共 ${matchTotal} 项`
        : `共 ${matchTotal} 项`

  return (
    <search
      className={cn(
        'absolute right-3 z-30 flex min-w-[min(100%-1.5rem,22rem)] flex-col gap-1',
        props.clearToolbar ? 'top-11' : 'top-2',
        'rounded-md border border-border bg-popover p-1.5 shadow-lg backdrop-blur-none'
      )}
      aria-label={t('FIND')}>
      <FindRow
        inputRef={findInputRef}
        query={findQuery}
        placeholder={t('FIND_PLACEHOLDER')}
        isReplaceOpen={isReplaceOpen}
        isMatchCase={isMatchCase}
        isWholeWord={isWholeWord}
        isRegex={isRegex}
        matchLabel={matchLabel}
        onChangeQuery={toSetFindQuery}
        onToggleReplace={function () {
          setIsReplaceOpen(function (prev) {
            return !prev
          })
        }}
        onToggleMatchCase={function () {
          setIsMatchCase(function (prev) {
            return !prev
          })
        }}
        onToggleWholeWord={function () {
          setIsWholeWord(function (prev) {
            return !prev
          })
        }}
        onToggleRegex={function () {
          setIsRegex(function (prev) {
            return !prev
          })
        }}
        onStep={runFind}
        onClose={close}
      />

      {isReplaceOpen ? (
        <ReplaceRow
          value={findReplace}
          onChangeValue={toSetFindReplace}
          onReplaceOne={runReplaceOne}
          onReplaceAll={runReplaceAll}
          onClose={close}
        />
      ) : null}
    </search>
  )
}

export { FindBar }
