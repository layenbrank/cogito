/**
 * 命令栏搜索核：输入 / 筛选 / 异步 lane（Web 建议 + 磁盘文件）/ 键盘导航 / 提交。
 *
 * 抽出来是为了两处复用：主窗 Overview 的 Omnibar 与浮层窗口里的搜索灵动岛。
 * 两边只共用这套状态机，外壳（引擎轨、结果面板摆位）各画各的。
 */
import { openUrl } from '@tauri-apps/plugin-opener'
import { debounce } from 'lodash-es'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { toast } from 'sonner'

import { findEngine } from '@/constants/engine'
import { OMNIBAR_UI } from '@/features/command-bar/constants'
import { searchFiles } from '@/features/command-bar/providers/files'
import { bootstrapCommandBar } from '@/features/command-bar/providers/register'
import { findWebSuggestions } from '@/features/command-bar/providers/web'
import { matchesFilter, parseQuery } from '@/features/command-bar/query'
import { findFlatHits } from '@/features/command-bar/rank'
import { findSyncHits, mergeAsyncHits } from '@/features/command-bar/search'
import {
  readEngineKey,
  writeEngineKey,
  writeRecentHit
} from '@/features/command-bar/store'
import type { DomainFilter, Hit } from '@/features/command-bar/types'
import {
  buildMatchUrl,
  findDefaultNavigation,
  isUrlKeyword,
  parseKeywordUrl
} from '@/features/command-bar/url'
import { reportCaught } from '@/utils/exception-report'

bootstrapCommandBar()

interface CommandSearchOptions {
  /** 监听全局 `command-bar:focus`（热键派发）：只给主窗 Omnibar 开，避免浮层抢主窗焦点 */
  isGlobalFocusTarget?: boolean
  /** Escape 时先给外壳一次机会（例如收起引擎轨）；返回 true 表示已消费 */
  onEscape?: () => boolean
}

function useCommandSearch(options: CommandSearchOptions = {}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const querySeq = useRef(0)
  const keywordRef = useRef('')
  const filterRef = useRef<DomainFilter>('all')
  const abortRef = useRef<AbortController | null>(null)

  const [keyword, setKeyword] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [navigation, setNavigation] = useState<number>(OMNIBAR_UI.NONE)
  const [isSurfaceOpen, setSurfaceOpen] = useState(false)
  const [engineKey, setEngineKey] = useState(readEngineKey)
  const [filter, setFilter] = useState<DomainFilter>('all')
  const [isFocused, setFocused] = useState(false)

  const engine = findEngine(engineKey)
  /** 分组一次就够：每次按键 / 方向键都会重渲染，不必每帧重建 Map 再拼数组 */
  const flatHits = useMemo(
    function () {
      return findFlatHits(hits)
    },
    [hits]
  )
  const trimmed = keyword.trim()
  const isOpen =
    isSurfaceOpen && isFocused && (trimmed.length > 0 || flatHits.length > 0)

  const suggestWeb = useRef<
    (((value: string, chip: DomainFilter) => void) & { cancel: () => void }) | null
  >(null)

  useEffect(function () {
    const run = debounce(async function (value: string, chip: DomainFilter) {
      const parsed = parseQuery(value, chip)
      if (!parsed.text) return
      const wantsWeb = matchesFilter('web', parsed.filter)
      const wantsFile = matchesFilter('file', parsed.filter)
      if (!wantsWeb && !wantsFile) return
      if (keywordRef.current !== value || filterRef.current !== chip) return

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      const seq = ++querySeq.current

      const [suggestions, files] = await Promise.all([
        wantsWeb
          ? findWebSuggestions(parsed.text, controller.signal)
          : Promise.resolve<Hit[]>([]),
        wantsFile ? searchFiles(parsed.text, controller.signal) : Promise.resolve<Hit[]>([])
      ])
      if (seq !== querySeq.current || controller.signal.aborted) return
      if (keywordRef.current !== value || filterRef.current !== chip) return

      setHits(function (prior) {
        return mergeAsyncHits(prior, suggestions, files)
      })
      // 建议回来时：网址模式继续不预选，避免 Enter 误开建议而非地址
      if (findDefaultNavigation(value) === OMNIBAR_UI.NONE) {
        setNavigation(OMNIBAR_UI.NONE)
      }
    }, OMNIBAR_UI.DEBOUNCE_MS)

    function suggest(value: string, chip: DomainFilter) {
      void run(value, chip)
    }
    suggest.cancel = function () {
      run.cancel()
    }
    suggestWeb.current = suggest
    return function () {
      run.cancel()
      abortRef.current?.abort()
    }
  }, [])

  useEffect(
    function () {
      if (!options.isGlobalFocusTarget) return
      function onFocusCommandBar() {
        setFocused(true)
        setSurfaceOpen(true)
        inputRef.current?.focus()
        inputRef.current?.select()
      }
      window.addEventListener('command-bar:focus', onFocusCommandBar)
      return function () {
        window.removeEventListener('command-bar:focus', onFocusCommandBar)
      }
    },
    [options.isGlobalFocusTarget]
  )

  function refreshHits(value: string, chip: DomainFilter) {
    abortRef.current?.abort()
    querySeq.current += 1
    const next = findSyncHits(value, chip)
    setHits(next)
    // 网址默认不预选结果：Enter 直接打开地址栏语义；普通查询预选首条
    setNavigation(next.length ? findDefaultNavigation(value) : OMNIBAR_UI.NONE)
    suggestWeb.current?.(value, chip)
  }

  function changeKeyword(value: string) {
    keywordRef.current = value
    setKeyword(value)
    setSurfaceOpen(true)
    const parsed = parseQuery(value, filterRef.current)
    // 前缀（web: / file: …）与 chip 对齐，避免「chip 显示 Agent、结果却是 Web」
    if (parsed.filter !== filterRef.current) {
      filterRef.current = parsed.filter
      setFilter(parsed.filter)
    }
    refreshHits(value, parsed.filter)
  }

  function changeFilter(next: DomainFilter) {
    filterRef.current = next
    setFilter(next)
    setSurfaceOpen(true)
    refreshHits(keywordRef.current, next)
  }

  function resetQuerySurface() {
    keywordRef.current = ''
    setKeyword('')
    setHits([])
    setNavigation(OMNIBAR_UI.NONE)
    setSurfaceOpen(false)
  }

  /** 打开结果面板并聚焦输入（热键 / 岛展开共用） */
  function openSurface() {
    setFocused(true)
    setSurfaceOpen(true)
    refreshHits(keywordRef.current, filterRef.current)
    inputRef.current?.focus()
    inputRef.current?.select()
  }

  /** 收起面板并交出焦点 */
  function close() {
    setSurfaceOpen(false)
    setFocused(false)
    inputRef.current?.blur()
  }

  async function chooseEngine(next: string) {
    setEngineKey(next)
    try {
      // 必须先写入偏好再刷新：即时 Web 行读的是 persist 里的 engineKey
      await writeEngineKey(next)
      refreshHits(keywordRef.current, filterRef.current)
    } catch (error) {
      reportCaught('command-bar.writeEngineKey', error)
      toast.error('切换搜索引擎失败')
    }
  }

  async function activateHit(hit: Hit, isReveal = false) {
    try {
      await writeRecentHit(hit)
      if (isReveal && hit.reveal) {
        await hit.reveal()
      } else {
        await hit.run()
      }
      resetQuerySurface()
      setFocused(false)
      inputRef.current?.blur()
    } catch (error) {
      reportCaught('command-bar.activateHit', error)
      toast.error(isReveal ? '无法打开所在文件夹' : '无法打开该项')
    }
  }

  async function submit(isReveal = false) {
    if (isOpen && navigation >= 0 && flatHits[navigation]) {
      await activateHit(flatHits[navigation], isReveal)
      return
    }
    if (!trimmed) return
    try {
      if (isUrlKeyword(trimmed)) {
        await openUrl(parseKeywordUrl(trimmed))
      } else {
        await openUrl(buildMatchUrl(engine.match, trimmed))
      }
      resetQuerySurface()
      setFocused(false)
      inputRef.current?.blur()
    } catch (error) {
      reportCaught('command-bar.submit', error)
      toast.error('无法打开链接')
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return

    if (event.key === 'Escape') {
      if (options.onEscape?.()) {
        event.preventDefault()
        return
      }
      if (isOpen) {
        event.preventDefault()
        setSurfaceOpen(false)
        return
      }
      inputRef.current?.blur()
      setFocused(false)
      return
    }

    if (event.key === 'ArrowDown' && isOpen && flatHits.length) {
      event.preventDefault()
      setNavigation(function (index) {
        if (index < 0) return 0
        return index >= flatHits.length - 1 ? 0 : index + 1
      })
      return
    }

    if (event.key === 'ArrowUp' && isOpen && flatHits.length) {
      event.preventDefault()
      setNavigation(function (index) {
        // NONE 或首条再上 → 跳到末条，便于从「不预选的网址」进入列表
        if (index <= 0) return flatHits.length - 1
        return index - 1
      })
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      // Alt+Enter = 在文件管理器中显示（只有文件类命中带 reveal）
      void submit(event.altKey)
    }
  }

  return {
    rootRef,
    inputRef,
    keyword,
    filter,
    hits,
    flatHits,
    navigation,
    engine,
    engineKey,
    trimmed,
    isOpen,
    isFocused,
    setNavigation,
    setFocused,
    setSurfaceOpen,
    changeKeyword,
    changeFilter,
    chooseEngine,
    openSurface,
    close,
    resetQuerySurface,
    activateHit,
    submit,
    onKeyDown
  }
}

export { useCommandSearch }
export type { CommandSearchOptions }
