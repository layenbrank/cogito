/**
 * 文档内查找/替换：对齐 VS Code 右上角浮动栏，Ctrl+F / Ctrl+H 打开。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { Input } from '@i-thinking/design/components/input'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@i-thinking/design/components/tooltip'
import type { Editor } from '@tiptap/react'
import { cn } from 'cn'
import { useEffect, useRef, useState } from 'react'

import { useMarkdownStore } from '@/stores/markdown'
import {
  clearSearchHighlight,
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
  onToggle(): void
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
  const [isMatchCase, setIsMatchCase] = useState(false)
  const [isWholeWord, setIsWholeWord] = useState(false)
  const [isRegex, setIsRegex] = useState(false)
  const [matchIndex, setMatchIndex] = useState(-1)
  const [matchTotal, setMatchTotal] = useState(0)

  const findInputRef = useRef<HTMLInputElement>(null)

  useEffect(
    function () {
      if (props.preferReplace) setIsReplaceOpen(true)
    },
    [props.preferReplace]
  )

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

  // 输入实时定位首个命中 + 全量高亮（对齐 VS Code），不抢输入框焦点
  useEffect(
    function () {
      if (!props.editor || !findQuery) {
        setMatchIndex(-1)
        setMatchTotal(0)
        if (props.editor) clearSearchHighlight(props.editor)
        return
      }
      const result = revealMatch(props.editor, options(), 0)
      setMatchIndex(result.index)
      setMatchTotal(result.total)
      keepFindFocus()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.editor, findQuery, isMatchCase, isWholeWord, isRegex]
  )

  function runFind(direction: 1 | -1) {
    if (!props.editor || !findQuery) return
    const result = findStep(props.editor, options(), direction)
    setMatchIndex(result.index)
    setMatchTotal(result.total)
    keepFindFocus()
  }

  function runReplaceOne() {
    if (!props.editor || !findQuery) return
    const result = replaceOne(props.editor, options(), findReplace)
    setMatchIndex(result.index)
    setMatchTotal(result.total)
    keepFindFocus()
  }

  function runReplaceAll() {
    if (!props.editor || !findQuery) return
    replaceAll(props.editor, options(), findReplace)
    setMatchIndex(-1)
    setMatchTotal(0)
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
      <div className="flex items-start gap-1">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="mt-0.5 size-6 shrink-0 rounded"
          aria-label={isReplaceOpen ? '收起替换' : '展开替换'}
          aria-expanded={isReplaceOpen}
          onClick={function () {
            setIsReplaceOpen(function (prev) {
              return !prev
            })
          }}>
          <Icon
            icon="lucide:chevron-right"
            className={cn(
              'size-3.5 transition-transform',
              isReplaceOpen && 'rotate-90'
            )}
          />
        </Button>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-1">
            <div className="relative min-w-0 flex-1">
              <Input
                ref={findInputRef}
                value={findQuery}
                placeholder={t('FIND_PLACEHOLDER')}
                className="h-7 pr-[4.5rem] text-xs"
                onChange={function (event) {
                  toSetFindQuery(event.target.value)
                }}
                onKeyDown={function (event) {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    event.stopPropagation()
                    runFind(event.shiftKey ? -1 : 1)
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    toSetFindOpen(false)
                  }
                }}
              />
              <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5">
                <OptionToggle
                  label="区分大小写"
                  pressed={isMatchCase}
                  onToggle={function () {
                    setIsMatchCase(function (prev) {
                      return !prev
                    })
                  }}>
                  Aa
                </OptionToggle>
                <OptionToggle
                  label="全字匹配"
                  pressed={isWholeWord}
                  onToggle={function () {
                    setIsWholeWord(function (prev) {
                      return !prev
                    })
                  }}>
                  ab
                </OptionToggle>
                <OptionToggle
                  label="正则表达式"
                  pressed={isRegex}
                  onToggle={function () {
                    setIsRegex(function (prev) {
                      return !prev
                    })
                  }}>
                  .*
                </OptionToggle>
              </div>
            </div>

            <span className="shrink-0 px-1 text-[11px] whitespace-nowrap text-muted-foreground tabular-nums">
              {matchLabel}
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
                      runFind(-1)
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
                      runFind(1)
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
                    onClick={function () {
                      toSetFindOpen(false)
                    }}
                  />
                }>
                <Icon
                  icon="lucide:x"
                  className="size-3.5"
                />
              </TooltipTrigger>
              <TooltipContent side="bottom">关闭（Esc）</TooltipContent>
            </Tooltip>
          </div>

          {isReplaceOpen ? (
            <div className="flex items-center gap-1">
              <Input
                value={findReplace}
                placeholder={t('REPLACE')}
                className="h-7 min-w-0 flex-1 text-xs"
                onChange={function (event) {
                  toSetFindReplace(event.target.value)
                }}
                onKeyDown={function (event) {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    runReplaceOne()
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    toSetFindOpen(false)
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
                      onClick={runReplaceOne}
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
                      onClick={runReplaceAll}
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
          ) : null}
        </div>
      </div>
    </search>
  )
}

export { FindBar }
