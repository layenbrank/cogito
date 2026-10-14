/**
 * Overview 顶栏搜索：引擎切换、建议请求、键盘导航、面板显隐
 */
import { Button } from '@i-thinking/design/components/button'
import { Input } from '@i-thinking/design/components/input'
import { Icon } from '@iconify/react/offline'
import { clsx } from 'clsx'
import { AnimatePresence } from 'motion/react'
import { useClickOutside } from '@reactuses/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { debounce, throttle } from 'lodash-es'
import { useEffect, useMemo, useRef, useState } from 'react'

import { ENGINES, findEngine } from '@/constants/engine'
import { EngineIpc } from '@/lib/engine-ipc'
import { ENGINE_UI } from '@/views/overview/engine/engine-constants'
import { EngineFragment } from '@/views/overview/engine/engine-fragment'
import { readEngineKey, writeEngineKey } from '@/views/overview/engine/engine-store'
import {
  buildMatchUrl,
  findDefaultNavigation,
  findItemUrl,
  isUrlKeyword,
  parseKeywordUrl
} from '@/views/overview/engine/engine-url'
import styles from '@/views/overview/overview.module.scss'

function EngineSearch() {
  const engineRef = useRef<HTMLDivElement>(null)
  const keywordRef = useRef('')
  const querySeq = useRef(0)

  const [keyword, setKeyword] = useState('')
  const [matchedKeyword, setMatchedKeyword] = useState('')
  const [visible, setVisible] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [series, setSeries] = useState<Engine.Item[]>([])
  const [navigation, setNavigation] = useState<number>(ENGINE_UI.NONE)
  const [engineKey, setEngineKey] = useState(function () {
    return readEngineKey()
  })

  const engine = findEngine(engineKey)

  /** 防抖查询：在 effect 里建（渲染期不碰 ref），只从事件处理器调用 */
  const suggestion = useRef<
    (((value: string) => void) & { cancel: () => void }) | null
  >(null)

  useEffect(function () {
    const run = debounce(function (value: string) {
      const qry = value.trim()
      if (!qry) {
        setSeries([])
        setMatchedKeyword('')
        setNavigation(ENGINE_UI.NONE)
        return
      }

      const seq = ++querySeq.current

      EngineIpc.suggestion(qry)
        .then(function (data) {
          if (seq !== querySeq.current) return
          if (qry !== keywordRef.current.trim()) return
          setSeries(data.s ?? [])
          setMatchedKeyword(qry)
          setNavigation(findDefaultNavigation(qry))
        })
        .catch(function (error) {
          if (seq !== querySeq.current) return
          if (qry !== keywordRef.current.trim()) return
          console.error('[engine] suggestion failed:', error)
          setSeries([])
          setMatchedKeyword('')
          setNavigation(ENGINE_UI.NONE)
        })
    }, 300)

    suggestion.current = run

    return function () {
      run.cancel()
    }
  }, [])

  useClickOutside(engineRef, function () {
    setVisible(false)
    setMenuOpen(false)
  })

  const trimmed = keyword.trim()
  const isSeriesFresh = matchedKeyword === trimmed && series.length > 0
  const isPanelOpen = visible && !menuOpen && trimmed.length > 0 && isSeriesFresh

  function changeKeyword(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
    keywordRef.current = value
    setKeyword(value)
    setVisible(value.trim().length > 0)
    setMenuOpen(false)

    if (!value.trim()) {
      querySeq.current += 1
      suggestion.current?.cancel()
      setSeries([])
      setMatchedKeyword('')
      setNavigation(ENGINE_UI.NONE)
      return
    }

    suggestion.current?.(value)
  }

  function openItemUrl(item?: Engine.Item) {
    if (item) {
      void openUrl(findItemUrl(engine, item))
      setVisible(false)
      return
    }
    if (!trimmed) return
    if (isUrlKeyword(trimmed)) {
      void openUrl(parseKeywordUrl(trimmed))
      setVisible(false)
      return
    }
    void openUrl(buildMatchUrl(engine.match, trimmed))
    setVisible(false)
  }

  function search() {
    if (isPanelOpen && navigation >= 0) {
      const selected = series[navigation]
      if (selected) {
        openItemUrl(selected)
        return
      }
    }
    openItemUrl()
  }

  const seriesLengthRef = useRef(series.length)

  useEffect(
    function () {
      seriesLengthRef.current = series.length
    },
    [series.length]
  )

  const navigatePrev = useMemo(function () {
    return throttle(
      function () {
        setNavigation(function (index) {
          const length = seriesLengthRef.current
          if (length <= 0) return index
          const hasNone = isUrlKeyword(keywordRef.current)
          if (index < 0) return hasNone ? ENGINE_UI.NONE : length - 1
          if (index <= 0) return hasNone ? ENGINE_UI.NONE : length - 1
          return index - 1
        })
      },
      ENGINE_UI.NAVIGATE_THROTTLE_MS,
      { leading: true, trailing: false }
    )
  }, [])

  const navigateNext = useMemo(function () {
    return throttle(
      function () {
        setNavigation(function (index) {
          const length = seriesLengthRef.current
          if (length <= 0) return index
          const hasNone = isUrlKeyword(keywordRef.current)
          if (index < 0) return 0
          if (index >= length - 1) return hasNone ? ENGINE_UI.NONE : 0
          return index + 1
        })
      },
      ENGINE_UI.NAVIGATE_THROTTLE_MS,
      { leading: true, trailing: false }
    )
  }, [])

  useEffect(
    function () {
      return function () {
        navigatePrev.cancel()
        navigateNext.cancel()
      }
    },
    [navigatePrev, navigateNext]
  )

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'ArrowUp' && isPanelOpen) {
      e.preventDefault()
      navigatePrev()
      return
    }
    if (e.key === 'ArrowDown' && isPanelOpen) {
      e.preventDefault()
      navigateNext()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      search()
    }
  }

  function chooseEngine(key: string) {
    setEngineKey(key)
    setMenuOpen(false)
    writeEngineKey(key)
  }

  return (
    <div
      ref={engineRef}
      className={clsx(styles.engine, styles.section, {
        [styles.active]: isPanelOpen
      })}>
      <div className={clsx(styles.engine, styles.keyword)}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="搜索引擎"
          aria-expanded={menuOpen}
          title={engine.label}
          className={clsx(styles.engine, styles.picker)}
          onClick={function () {
            setMenuOpen(function (open) {
              return !open
            })
            setVisible(false)
          }}>
          <Icon
            icon={engine.icon}
            aria-hidden
          />
        </Button>
        <Input
          value={keyword}
          onChange={changeKeyword}
          onKeyDown={onKeyDown}
          onFocus={function () {
            if (trimmed) setVisible(true)
          }}
          placeholder="搜索或输入网址"
          aria-label="搜索"
          className={clsx(styles.engine, styles.trigger)}
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label="搜索"
          className={clsx(styles.engine, styles.series)}
          onClick={search}>
          <span className={clsx(styles.engine, styles.mark)}>
            <Icon
              icon="lucide:search"
              aria-hidden
            />
          </span>
        </Button>
      </div>
      {menuOpen ? (
        <div className={clsx(styles.engine, styles.menu)}>
          {ENGINES.map(function (item) {
            const isActive = item.key === engine.key
            return (
              <button
                key={item.key}
                type="button"
                className={clsx(styles.engine, styles.menuItem, {
                  [styles.menuItemActive]: isActive
                })}
                onMouseDown={function (event) {
                  event.preventDefault()
                }}
                onClick={function () {
                  chooseEngine(item.key)
                }}>
                <Icon icon={item.icon} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </div>
      ) : null}
      <AnimatePresence>
        {isPanelOpen && (
          <EngineFragment
            series={series}
            navigation={navigation}
            onSelect={openItemUrl}
            onNavigate={setNavigation}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

export { EngineSearch }
