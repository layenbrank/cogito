/**
 * Command Omnibar 壳：输入 / 引擎轨 / 结果表面
 */
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { Icon } from '@iconify/react/offline'
import { useClickOutside } from '@reactuses/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { cn } from 'cn'
import { debounce } from 'lodash-es'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { toast } from 'sonner'

import { findEngine } from '@/constants/engine'
import { OMNIBAR_UI } from '@/features/command-bar/constants'
import { EngineRail } from '@/features/command-bar/engine-rail'
import { useCommandBarHotkey } from '@/features/command-bar/hotkey'
import { matchesFilter, parseQuery } from '@/features/command-bar/query'
import { bootstrapCommandBar } from '@/features/command-bar/providers/register'
import { findWebSuggestions } from '@/features/command-bar/providers/web'
import { findFlatHits } from '@/features/command-bar/rank'
import { ResultsSurface } from '@/features/command-bar/results'
import { findSyncHits, mergeWebSuggestions } from '@/features/command-bar/search'
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

function CommandOmnibar() {
  useCommandBarHotkey()
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
  const [isRailOpen, setRailOpen] = useState(false)
  const [engineKey, setEngineKey] = useState(readEngineKey)
  const [filter, setFilter] = useState<DomainFilter>('all')
  const [isFocused, setFocused] = useState(false)

  const engine = findEngine(engineKey)
  const flatHits = findFlatHits(hits)
  const trimmed = keyword.trim()
  const isShellOpen =
    isSurfaceOpen && isFocused && (trimmed.length > 0 || flatHits.length > 0)

  const suggestWeb = useRef<
    (((value: string, chip: DomainFilter) => void) & { cancel: () => void }) | null
  >(null)

  useEffect(function () {
    const run = debounce(async function (value: string, chip: DomainFilter) {
      const parsed = parseQuery(value, chip)
      if (!parsed.text || !matchesFilter('web', parsed.filter)) return
      if (keywordRef.current !== value || filterRef.current !== chip) return

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      const seq = ++querySeq.current

      const suggestions = await findWebSuggestions(parsed.text, controller.signal)
      if (seq !== querySeq.current || controller.signal.aborted) return
      if (keywordRef.current !== value || filterRef.current !== chip) return

      setHits(function (prior) {
        return mergeWebSuggestions(prior, suggestions)
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

  useClickOutside(rootRef, function () {
    setSurfaceOpen(false)
    setRailOpen(false)
    setFocused(false)
  })

  useEffect(function () {
    function onFocusOmnibar() {
      setFocused(true)
      setSurfaceOpen(true)
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    window.addEventListener('command-bar:focus', onFocusOmnibar)
    return function () {
      window.removeEventListener('command-bar:focus', onFocusOmnibar)
    }
  }, [])

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
    setRailOpen(false)
    const parsed = parseQuery(value, filterRef.current)
    // 前缀（web: / cal: …）与 chip 对齐，避免「chip 显示 Agent、结果却是 Web」
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
    setRailOpen(false)
  }

  async function activateHit(hit: Hit) {
    try {
      await writeRecentHit(hit)
      await hit.run()
      resetQuerySurface()
      setFocused(false)
      inputRef.current?.blur()
    } catch (error) {
      reportCaught('command-bar.activateHit', error)
      toast.error('无法打开该项')
    }
  }

  async function submit() {
    if (isShellOpen && navigation >= 0 && flatHits[navigation]) {
      await activateHit(flatHits[navigation])
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
      if (isRailOpen) {
        event.preventDefault()
        setRailOpen(false)
        return
      }
      if (isShellOpen) {
        event.preventDefault()
        setSurfaceOpen(false)
        return
      }
      inputRef.current?.blur()
      setFocused(false)
      return
    }

    if (event.key === 'ArrowDown' && isShellOpen && flatHits.length) {
      event.preventDefault()
      setNavigation(function (index) {
        if (index < 0) return 0
        return index >= flatHits.length - 1 ? 0 : index + 1
      })
      return
    }

    if (event.key === 'ArrowUp' && isShellOpen && flatHits.length) {
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
      void submit()
    }
  }

  return (
    <div
      ref={rootRef}
      className={cn(
        // 宽度交给 BrowserBar 中间列（max 36rem）；自身只吃满父级，禁止再撑破右栏
        'relative flex w-full min-w-0 flex-col',
        isShellOpen && 'z-30'
      )}>
      <div
        className={cn(
          'flex h-9 items-center gap-0.5 border border-border bg-popover/95 px-1 shadow-sm backdrop-blur-md transition-[border-radius,box-shadow]',
          isShellOpen
            ? 'rounded-b-none rounded-t-xl border-b-0 shadow-md'
            : 'rounded-full'
        )}>
        <EngineRail
          engineKey={engineKey}
          isExpanded={isRailOpen}
          isShellOpen={isShellOpen}
          onExpand={setRailOpen}
          onChoose={function (key) {
            setEngineKey(key)
            // 必须先写入偏好再刷新：即时 Web 行读的是 persist 里的 engineKey
            void writeEngineKey(key)
              .then(function () {
                refreshHits(keywordRef.current, filterRef.current)
              })
              .catch(function (error: unknown) {
                reportCaught('command-bar.writeEngineKey', error)
                toast.error('切换搜索引擎失败')
              })
          }}
        />
        <Input
          ref={inputRef}
          value={keyword}
          onChange={function (event) {
            changeKeyword(event.target.value)
          }}
          onKeyDown={onKeyDown}
          onFocus={function () {
            setFocused(true)
            setSurfaceOpen(true)
            refreshHits(keywordRef.current, filterRef.current)
          }}
          placeholder="搜索磁贴、日程、备忘录或网址…"
          aria-label="命令搜索"
          aria-autocomplete="list"
          aria-expanded={isShellOpen}
          className="h-8 min-w-0 flex-1 border-0 bg-transparent px-2 shadow-none focus-visible:ring-0"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="搜索"
          className="size-8 shrink-0 rounded-full"
          onMouseDown={function (event) {
            // 避免按钮抢焦点导致 isShellOpen 在 click 前因失焦抖动；提交仍用当前高亮
            event.preventDefault()
          }}
          onClick={function () {
            void submit()
          }}>
          <Icon icon="lucide:search" aria-hidden className="size-4" />
        </Button>
      </div>

      <ResultsSurface
        hits={hits}
        navigation={navigation}
        filter={filter}
        isOpen={isShellOpen}
        onFilter={changeFilter}
        onNavigate={setNavigation}
        onSelect={function (hit) {
          void activateHit(hit)
        }}
      />
    </div>
  )
}

export { CommandOmnibar }
