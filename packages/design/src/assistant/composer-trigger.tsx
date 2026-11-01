/**
 * composer 的触发器注册表（自研，不依赖 `Unstable_TriggerPopover`）。
 *
 * 能力对齐全仓历史上 `@` / `/` 面板给出的体验，但把三个维度开放出去：
 * 1. **token 任意长度**：`@`、`/`、`#`、`::`、`\\` 都行；同一光标位置有多个候选时按长度降序匹配。
 * 2. **可配置多个**：`triggers` 数组，互不干扰。
 * 3. **行为自定义**：`onSelect(item, api)` 里可以 `insertChip`（原子 chip）、`insertText`
 *    （纯文本片段）、`removeToken`（只吃掉 token），也可以什么都不做、自己去挂附件或执行命令。
 *
 * Provider 只做「文本 + 光标 → 命中范围 → 候选项 → 选中」这一条链路，
 * 不碰 DOM：真正的文本替换通过 `onApply` 交给输入组件执行。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

/** 插入到文本流里的原子片段（序列化为 `:type[label]{name=id}`）。 */
interface ComposerChipInput {
  readonly type: string
  readonly label: string
  readonly id: string
}

interface ComposerTriggerItem {
  readonly id: string
  readonly label: string
  readonly description?: string | undefined
  /** 额外业务数据，原样回传给 `onSelect`。 */
  readonly data?: unknown
}

interface ComposerTriggerQuery {
  readonly query: string
  readonly signal: AbortSignal
}

interface ComposerTriggerApi {
  /** 把「token 起 → 光标」这段替换成原子 chip。 */
  insertChip(chip: ComposerChipInput): void
  /** 把「token 起 → 光标」这段替换成纯文本（快捷短语、prompt 模板）。 */
  insertText(text: string): void
  /** 只删掉 token 与 query，不插任何东西。 */
  removeToken(): void
  /** 关闭面板。 */
  close(): void
}

interface ComposerTrigger {
  readonly id: string
  readonly token: string
  /** 判定 token 前的字符是否可以作为起点；默认「行首或非词字符」。 */
  readonly boundary?: ((previous: string | undefined) => boolean) | undefined
  readonly resolve: (query: ComposerTriggerQuery) => Promise<readonly ComposerTriggerItem[]>
  readonly onSelect: (item: ComposerTriggerItem, api: ComposerTriggerApi) => void
}

interface ComposerTriggerMatch {
  readonly trigger: ComposerTrigger
  readonly query: string
  /** token 的起始 offset。 */
  readonly start: number
  /** 光标 offset（不含）。 */
  readonly end: number
}

type ComposerEditRequest =
  | { readonly kind: 'text'; readonly start: number; readonly end: number; readonly text: string }
  | { readonly kind: 'chip'; readonly start: number; readonly end: number; readonly chip: ComposerChipInput }
  | { readonly kind: 'remove'; readonly start: number; readonly end: number }

interface ComposerTriggerState {
  readonly match: ComposerTriggerMatch | null
  readonly items: readonly ComposerTriggerItem[]
  readonly activeIndex: number
  readonly isLoading: boolean
}

interface ComposerTriggerListProps {
  readonly className?: string | undefined
}

interface ComposerTriggerHandle extends ComposerTriggerState {
  /** 输入 / 光标变化时调用；同步返回当前命中，便于输入区即时上色。 */
  sync: (text: string, cursor: number) => ComposerTriggerMatch | null
  move: (delta: number) => void
  pick: (index?: number) => void
  hover: (index: number) => void
  close: () => void
  /** 输入组件注册「执行编辑」的函数；返回注销函数。 */
  attachApply: (apply: (edit: ComposerEditRequest) => void) => () => void
}

const IDLE_STATE: ComposerTriggerState = { match: null, items: [], activeIndex: 0, isLoading: false }

/** 与历史实现一致：行首、空白、或任何非 `[A-Za-z0-9._~-]` 字符之后都能起头。 */
const WORD_CHAR = /[A-Za-z0-9._~-]/

function findBoundaryAllowed(previous: string | undefined) {
  if (previous === undefined) return true
  return !WORD_CHAR.test(previous)
}

/**
 * 在 `text` 的 `cursor` 之前找触发点。
 *
 * 同一位置注册了 `@` 与 `@@` 时更长的优先（先排 `@@`）；`query` 里出现空白说明 token
 * 已被打断，不算命中。
 */
function matchToken(
  text: string,
  cursor: number,
  triggers: readonly ComposerTrigger[]
): ComposerTriggerMatch | null {
  if (cursor <= 0 || triggers.length === 0) return null
  const before = text.slice(0, cursor)
  const ordered = [...triggers].sort(function (left, right) {
    return right.token.length - left.token.length
  })

  for (const trigger of ordered) {
    const index = before.lastIndexOf(trigger.token)
    if (index < 0) continue
    const query = before.slice(index + trigger.token.length)
    if (/\s|\u00a0/.test(query)) continue
    const boundary = trigger.boundary ?? findBoundaryAllowed
    if (!boundary(before[index - 1])) continue
    return { trigger, query, start: index, end: cursor }
  }
  return null
}

function buildApi(
  match: ComposerTriggerMatch,
  apply: (edit: ComposerEditRequest) => void,
  close: () => void
): ComposerTriggerApi {
  const range = { start: match.start, end: match.end }
  return {
    insertChip: function (chip) {
      apply({ kind: 'chip', ...range, chip })
    },
    insertText: function (text) {
      apply({ kind: 'text', ...range, text })
    },
    removeToken: function () {
      apply({ kind: 'remove', ...range })
    },
    close
  }
}

const ComposerTriggerContext = createContext<ComposerTriggerHandle | null>(null)

interface ComposerTriggerProviderProps {
  readonly triggers: readonly ComposerTrigger[] | undefined
  readonly children: ReactNode
}

function ComposerTriggerProvider(props: ComposerTriggerProviderProps) {
  const { triggers, children } = props
  const [state, setState] = useState<ComposerTriggerState>(IDLE_STATE)
  const ordered = useMemo(
    function () {
      return triggers ? [...triggers] : []
    },
    [triggers]
  )

  /** 选中回调里要读最新的候选项与高亮位置，用 ref 避免 select 引用频繁变化。 */
  const itemsRef = useRef<readonly ComposerTriggerItem[]>(IDLE_STATE.items)
  const activeIndexRef = useRef(IDLE_STATE.activeIndex)
  const matchRef = useRef<ComposerTriggerMatch | null>(null)
  /** 编辑执行器由输入组件注册（状态机不碰 DOM）。 */
  const applyRef = useRef<((edit: ComposerEditRequest) => void) | null>(null)

  const attachApply = useCallback(function (apply: (edit: ComposerEditRequest) => void) {
    applyRef.current = apply
    return function () {
      if (applyRef.current === apply) applyRef.current = null
    }
  }, [])

  const close = useCallback(function () {
    setState(IDLE_STATE)
  }, [])

  const sync = useCallback(
    function (text: string, cursor: number) {
      const next = ordered.length === 0 ? null : matchToken(text, cursor, ordered)
      setState(function (previous) {
        const current = previous.match
        if (next === null) return current === null ? previous : IDLE_STATE
        if (
          current !== null &&
          current.trigger.id === next.trigger.id &&
          current.query === next.query &&
          current.start === next.start &&
          current.end === next.end
        ) {
          return previous
        }
        return { match: next, items: previous.items, activeIndex: previous.activeIndex, isLoading: true }
      })
      return next
    },
    [ordered]
  )

  const match = state.match
  useEffect(
    function () {
      matchRef.current = match
      if (match === null) {
        itemsRef.current = []
        activeIndexRef.current = 0
        return
      }

      const controller = new AbortController()
      // 空 query（含只有 `/` `./` 这种归一后为空的）立刻拉；其余短防抖
      const trimmedQuery = match.query.trim().replace(/\\/g, '/')
      const isEmptyQuery =
        trimmedQuery.length === 0 ||
        trimmedQuery === '/' ||
        trimmedQuery === './' ||
        /^(\.\/)+$/.test(trimmedQuery)
      const delayMs = isEmptyQuery ? 0 : 100
      const timer = window.setTimeout(function () {
        void match.trigger
          .resolve({ query: match.query, signal: controller.signal })
          .then(function (rows) {
            if (controller.signal.aborted) return
            itemsRef.current = rows
            activeIndexRef.current = 0
            setState({ match, items: rows, activeIndex: 0, isLoading: false })
          })
          .catch(function (error: unknown) {
            if (controller.signal.aborted) return
            console.warn('[composer-trigger] 解析候选项失败:', error)
            itemsRef.current = []
            activeIndexRef.current = 0
            setState({ match, items: [], activeIndex: 0, isLoading: false })
          })
      }, delayMs)

      return function () {
        window.clearTimeout(timer)
        controller.abort()
      }
    },
    [match]
  )

  const move = useCallback(function (delta: number) {
    setState(function (previous) {
      const total = previous.items.length
      if (total === 0) return previous
      const activeIndex = (previous.activeIndex + delta + total) % total
      activeIndexRef.current = activeIndex
      return { ...previous, activeIndex }
    })
  }, [])

  const hover = useCallback(function (index: number) {
    setState(function (previous) {
      if (previous.activeIndex === index) return previous
      activeIndexRef.current = index
      return { ...previous, activeIndex: index }
    })
  }, [])

  const pick = useCallback(
    function (index?: number) {
      const current = matchRef.current
      if (current === null) return
      const item = itemsRef.current[index ?? activeIndexRef.current]
      if (!item) return
      const apply = applyRef.current
      setState(IDLE_STATE)
      if (!apply) return
      current.trigger.onSelect(item, buildApi(current, apply, close))
    },
    [close]
  )

  const handle = useMemo<ComposerTriggerHandle>(
    function () {
      return { ...state, sync, move, pick, hover, close, attachApply }
    },
    [state, sync, move, pick, hover, close, attachApply]
  )

  return <ComposerTriggerContext.Provider value={handle}>{children}</ComposerTriggerContext.Provider>
}

/** 读触发器状态与动作；不在 `ComposerTriggerProvider` 内时返回 `null`。 */
function useComposerTrigger() {
  return useContext(ComposerTriggerContext)
}

export { ComposerTriggerProvider, findBoundaryAllowed, matchToken, useComposerTrigger }
export type {
  ComposerChipInput,
  ComposerEditRequest,
  ComposerTrigger,
  ComposerTriggerApi,
  ComposerTriggerHandle,
  ComposerTriggerItem,
  ComposerTriggerListProps,
  ComposerTriggerMatch,
  ComposerTriggerQuery,
  ComposerTriggerState
}
