/**
 * 右栏「浏览器」面板。
 *
 * 页面本身不是 HTML —— 是窗口级原生子 webview，由 Rust `set_bounds` 精确盖在
 * 下面这个占位 div 上。所以：
 * - 占位 div 只负责**量尺寸**；浮层让位时再叠一层变暗截图（VS Code Simple Browser）；
 * - 顶部 tab 行与地址栏都在占位区之外，因此可以正常点击；
 * - 切走页签 / 卸载本组件时必须 `visible(false)`，否则 webview 会一直悬在其他
 *   面板上面。
 */
import { Icon } from '@iconify/react/offline'
import { useAui } from '@assistant-ui/react'
import { Button } from '@cogito/design/components/button'
import { listen } from '@tauri-apps/api/event'
import { clsx } from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { attachImageData } from '@/features/agent/attachment'
import {
  openBrowserDevtools,
  probeBrowser,
  readBrowserPage,
  reloadBrowser,
  screenshotBrowser,
  startBrowserPicker,
  stepBrowserHistory,
  stopBrowserPicker,
  writeBrowserVisible,
  type BrowserPickerActiveEvent,
  type PickedBrowserElement
} from '@/features/browser/api'
import { attachPickedElement } from '@/features/browser/attach-picked-element'
import { formatAddress, formatTabTitle } from '@/features/browser/address'
import { useBrowserRect } from '@/features/browser/rect'
import { useBrowserStore } from '@/features/browser/store'
import { findSelfDebugUrl } from '@/features/window/shell-mode'

import { AsideBrowserNetwork } from './aside-browser-network'

function reportError(error: unknown) {
  toast.error(error instanceof Error ? error.message : String(error))
}

/**
 * 面板内的两个视图。
 *
 * 只有 `page` 让原生 webview 可见 —— `network` 是纯 HTML，
 * 不 `visible(false)` 的话整块区域会被 webview 盖住（原生图层永远在上）。
 */
type BrowserView = 'page' | 'network'

/** 切回页面视图到重新截图之间等合成，否则截到空白 */
const SHOW_SETTLE_MS = 250

function AsideBrowser() {
  const aui = useAui()
  const tabs = useBrowserStore(function (state) {
    return state.tabs
  })
  const activeLabel = useBrowserStore(function (state) {
    return state.activeLabel
  })
  const [draft, updateDraft] = useState('')
  const [view, updateView] = useState<BrowserView>('page')
  const [isPicking, updatePicking] = useState(false)
  const pickingLabelRef = useRef<string | null>(null)

  const activeTab = tabs.find(function (tab) {
    return tab.label === activeLabel
  })
  // 只有 page 视图才量尺寸：其他视图时占位 div 不存在，webview 也应该是隐藏的
  const { ref: surfaceRef, isPaused, pauseSrc } = useBrowserRect(
    activeTab !== undefined && view === 'page',
    activeLabel
  )

  function haltPicker(label: string | null | undefined) {
    if (!label) return
    pickingLabelRef.current = null
    updatePicking(false)
    void stopBrowserPicker(label).catch(function (error: unknown) {
      console.warn('browser: 结束元素拾取失败', error)
    })
  }

  // 卸载（切页签 / 收起右栏）时让位 + 结束拾取
  useEffect(function () {
    return function () {
      haltPicker(pickingLabelRef.current)
      void writeBrowserVisible(false).catch(reportError)
    }
  }, [])

  // 视图切换：离开页面视图必须立刻让位。
  // 切**回** page 时不由这里放出来 —— 交给 `useBrowserRect`，它会先看有没有浮层压着，
  // 否则「下拉菜单开着 → 切回页面」会把 webview 顶到菜单上面。
  useEffect(
    function () {
      if (view !== 'page') {
        haltPicker(pickingLabelRef.current ?? activeLabel)
        void writeBrowserVisible(false).catch(reportError)
      }
    },
    [view, activeLabel]
  )

  // 切 tab：停掉上一个 tab 的拾取
  useEffect(
    function () {
      const previous = pickingLabelRef.current
      if (previous && previous !== activeLabel) {
        haltPicker(previous)
      }
    },
    [activeLabel]
  )

  // 切 tab 或页面跳转后，地址栏跟上真实地址（用户正在输入时除外，见 onFocus）
  const activeUrl = activeTab?.url ?? ''
  useEffect(
    function () {
      updateDraft(formatAddress(activeUrl))
    },
    [activeUrl]
  )

  // 页面自己跳转（点链接 / 重定向）时由 Rust 侧 `on_page_load` 回传，地址栏靠它跟上
  useEffect(function () {
    let disposed = false
    let unlisten: (() => void) | null = null
    void listen<{ label: string; url: string }>('browser://nav', function (event) {
      useBrowserStore.getState().writeTabUrl(event.payload.label, event.payload.url)
      // SPA/硬导航会卸页面，拾取必须停
      if (pickingLabelRef.current === event.payload.label) {
        haltPicker(event.payload.label)
        toast.message('页面已跳转，元素拾取已取消')
      }
    })
      .then(function (fn) {
        if (disposed) {
          fn()
          return
        }
        unlisten = fn
      })
      .catch(reportError)
    return function () {
      disposed = true
      unlisten?.()
    }
  }, [])

  // 拾取结果 → composer；active 状态与 Rust 对齐
  useEffect(function () {
    let disposed = false
    const stops: Array<() => void> = []

    void listen<PickedBrowserElement>('browser://element-picked', function (event) {
      const picked = event.payload
      pickingLabelRef.current = null
      updatePicking(false)
      void attachPickedElement(aui, picked)
        .then(function () {
          toast.success(`已加入输入框：<${picked.tag}>`)
        })
        .catch(reportError)
    })
      .then(function (fn) {
        if (disposed) fn()
        else stops.push(fn)
      })
      .catch(reportError)

    void listen<BrowserPickerActiveEvent>('browser://element-picker-active', function (event) {
      if (event.payload.label !== (pickingLabelRef.current ?? activeLabel)) return
      updatePicking(event.payload.active)
      if (!event.payload.active) pickingLabelRef.current = null
    })
      .then(function (fn) {
        if (disposed) fn()
        else stops.push(fn)
      })
      .catch(reportError)

    return function () {
      disposed = true
      for (const stop of stops) stop()
    }
  }, [aui, activeLabel])

  // Esc 取消拾取
  useEffect(
    function () {
      if (!isPicking) return
      function onKeyDown(event: KeyboardEvent) {
        if (event.key !== 'Escape') return
        event.preventDefault()
        haltPicker(pickingLabelRef.current ?? activeLabel)
      }
      window.addEventListener('keydown', onKeyDown)
      return function () {
        window.removeEventListener('keydown', onKeyDown)
      }
    },
    [isPicking, activeLabel]
  )

  function toggleElementPicker() {
    if (!activeLabel) return
    if (view !== 'page') {
      updateView('page')
    }
    if (isPicking || pickingLabelRef.current === activeLabel) {
      haltPicker(activeLabel)
      return
    }
    pickingLabelRef.current = activeLabel
    updatePicking(true)
    void startBrowserPicker(activeLabel)
      .then(function () {
        toast.message('在页面上点击要选的元素，Esc 取消')
      })
      .catch(function (error: unknown) {
        pickingLabelRef.current = null
        updatePicking(false)
        reportError(error)
      })
  }

  function submitAddress(event?: React.FormEvent) {
    event?.preventDefault()
    const store = useBrowserStore.getState()
    if (!store.activeLabel) {
      if (view !== 'page') updateView('page')
      void store.openTab(draft).catch(reportError)
      return
    }
    void store.navigateActive(draft).catch(reportError)
  }

  function openBlankTab() {
    // 新 tab 必须在 page 视图，否则占位未挂、rect/visible 不上报，webview 建了也看不见
    if (view !== 'page') updateView('page')
    void useBrowserStore
      .getState()
      .openTab()
      .catch(reportError)
  }

  /** 自载本应用（embedded 降级壳），供 agent 在右栏调试前端 */
  function openSelfApp() {
    if (view !== 'page') updateView('page')
    const url = findSelfDebugUrl('/agent/chat')
    void useBrowserStore
      .getState()
      .openTab(url)
      .then(function () {
        toast.success('已打开本应用（嵌入调试）')
      })
      .catch(reportError)
  }

  function closeTab(label: string) {
    void useBrowserStore.getState().closeTab(label).catch(reportError)
  }

  function activateTab(label: string) {
    void useBrowserStore.getState().activateTab(label).catch(reportError)
  }

  /**
   * 截图并**直接加进会话输入框**（不另开预览层）。
   *
   * 两个坑：
   * 1. `Page.captureScreenshot(fromSurface: true)` 取的是合成后的画面，
   *    webview 被隐藏时只能拿到空白 —— 所以会保证页面视图下才截；
   * 2. 从 network 视图切回页面后 webview 需要重新合成，立刻截也是空白，
   *    所以等一个 `SHOW_SETTLE_MS`。
   */
  function captureIntoComposer() {
    if (!activeLabel) return
    const name = `浏览器截图-${formatTabTitle(activeTab?.url ?? '')}.png`

    function shoot() {
      void screenshotBrowser(activeLabel as string)
        .then(function (result) {
          return attachImageData(
            aui,
            `data:${result.mimeType};base64,${result.base64}`,
            name
          )
        })
        .then(function () {
          toast.success('已把当前页面截图加到输入框')
        })
        .catch(reportError)
    }

    if (view === 'page') {
      shoot()
      return
    }
    updateView('page')
    window.setTimeout(shoot, SHOW_SETTLE_MS)
  }

  /** 自检：agent 的四项能力（读 / 网络 / 拦截 / 截图）加真实读取结果 */
  function probeChannel() {
    if (!activeLabel) return
    const label = activeLabel
    void Promise.all([probeBrowser(label), readBrowserPage(label, 'outline', 20)])
      .then(function ([probe, read]) {
        const canRead = probe.evaluate.ok
        const network = probe.network.ok
        const intercept = probe.intercept.ok
        const shot = probe.screenshot.ok
        const shotKb = probe.screenshot.base64Length
          ? ` ${Math.round(probe.screenshot.base64Length / 1024)}KB`
          : ''
        const summary = [
          `读 ${canRead ? '✓' : '✗'}`,
          `网络 ${network ? '✓' : '✗'}`,
          `拦截 ${intercept ? '✓' : '✗'}`,
          `截图 ${shot ? '✓' : '✗'}${shotKb}`
        ].join(' · ')

        if (canRead && network && intercept && shot) {
          toast.success(`agent 通道就绪：${summary}`, {
            description: `当前页「${read.title || '无标题'}」识别到 ${read.items?.length ?? 0} 个可交互元素`
          })
          return
        }
        toast.warning(`agent 通道受限：${summary}`, {
          description:
            probe.intercept.echo === '__timeout__'
              ? '拦截请求超时：当前页面可能不是真实站点（about:blank 之类），换个地址再试'
              : undefined
        })
        console.warn('browser: 通道探测明细', probe, read)
      })
      .catch(reportError)
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/***** 子 tab：和终端同形态 *****/}
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b px-1.5 py-1">
        {tabs.map(function (tab) {
          const active = tab.label === activeLabel
          return (
            <div
              key={tab.label}
              className={clsx(
                'flex shrink-0 items-center gap-0.5 rounded-md',
                active ? 'bg-muted' : 'hover:bg-muted/60'
              )}>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                title={tab.url}
                className={clsx(
                  'h-6 justify-start gap-1.5 rounded-md px-2',
                  active ? 'text-foreground' : 'text-muted-foreground'
                )}
                onClick={function () {
                  activateTab(tab.label)
                }}>
                <span className="max-w-32 truncate">{formatTabTitle(tab.url)}</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="关闭标签页"
                title="关闭"
                className="text-muted-foreground hover:text-foreground size-5 shrink-0"
                onClick={function (event) {
                  event.stopPropagation()
                  closeTab(tab.label)
                }}>
                <Icon
                  icon="lucide:x"
                  className="size-3"
                />
              </Button>
            </div>
          )
        })}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="新建标签页"
          title="新建标签页"
          className="text-muted-foreground hover:text-foreground size-6 shrink-0"
          onClick={openBlankTab}>
          <Icon
            icon="lucide:plus"
            className="size-3.5"
          />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="打开本应用"
          title="在此面板打开本应用（嵌入调试，无 Tauri IPC）"
          className="text-muted-foreground hover:text-foreground size-6 shrink-0"
          onClick={openSelfApp}>
          <Icon
            icon="lucide:app-window"
            className="size-3.5"
          />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="切换网络列表"
          title="网络请求列表（可屏蔽某条请求）"
          disabled={activeTab === undefined}
          className={clsx(
            'ms-auto size-6 shrink-0',
            view === 'network'
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:text-foreground'
          )}
          onClick={function () {
            updateView(view === 'network' ? 'page' : 'network')
          }}>
          <Icon
            icon="lucide:activity"
            className="size-3.5"
          />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={isPicking ? '取消选择元素' : '选择元素加入输入框'}
          title={
            isPicking
              ? '取消选择元素（Esc）'
              : '选择页面元素加入输入框（hover 高亮，点击确认）'
          }
          disabled={activeTab === undefined}
          className={clsx(
            'size-6 shrink-0',
            isPicking
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:text-foreground'
          )}
          onClick={toggleElementPicker}>
          <Icon
            icon="lucide:mouse-pointer-2"
            className="size-3.5"
          />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="截图并加入输入框"
          title="截图并加入输入框"
          disabled={activeTab === undefined}
          className="text-muted-foreground hover:text-foreground size-6 shrink-0"
          onClick={captureIntoComposer}>
          <Icon
            icon="lucide:camera"
            className="size-3.5"
          />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="打开开发者工具"
          title="打开这个标签页的 DevTools"
          disabled={activeTab === undefined}
          className="text-muted-foreground hover:text-foreground size-6 shrink-0"
          onClick={function () {
            if (!activeLabel) return
            void openBrowserDevtools(activeLabel).catch(reportError)
          }}>
          <Icon
            icon="lucide:bug"
            className="size-3.5"
          />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="自检 agent 通道"
          title="自检：agent 能否读取 / 看网络 / 拦截"
          disabled={activeTab === undefined}
          className="text-muted-foreground hover:text-foreground size-6 shrink-0"
          onClick={probeChannel}>
          <Icon
            icon="lucide:zap"
            className="size-3.5"
          />
        </Button>
      </div>

      {/***** 地址栏 *****/}
      {/*
       * base-ui 的 Button 会把 `type` 强制改成 `button`（`useRenderElement` 里
       * `getButtonProps` 覆盖 elementProps），所以 `type="submit"` 是无效的 ——
       * 回车靠 form 的隐式提交（这里只有一个 input 字段，符合规范），
       * 点「前往」走显式调用，两条路径汇总到同一个 `submitAddress`。
       */}
      <form
        onSubmit={submitAddress}
        className="flex shrink-0 items-center gap-0.5 border-b px-1.5 py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="后退"
          title="后退"
          disabled={activeTab === undefined}
          className="text-muted-foreground hover:text-foreground size-6 shrink-0"
          onClick={function () {
            if (!activeLabel) return
            void stepBrowserHistory(activeLabel, true).catch(reportError)
          }}>
          <Icon
            icon="lucide:arrow-left"
            className="size-3.5"
          />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="前进"
          title="前进"
          disabled={activeTab === undefined}
          className="text-muted-foreground hover:text-foreground size-6 shrink-0"
          onClick={function () {
            if (!activeLabel) return
            void stepBrowserHistory(activeLabel, false).catch(reportError)
          }}>
          <Icon
            icon="lucide:arrow-right"
            className="size-3.5"
          />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="刷新"
          title="刷新"
          disabled={activeTab === undefined}
          className="text-muted-foreground hover:text-foreground size-6 shrink-0"
          onClick={function () {
            if (!activeLabel) return
            void reloadBrowser(activeLabel).catch(reportError)
          }}>
          <Icon
            icon="lucide:rotate-cw"
            className="size-3.5"
          />
        </Button>
        <input
          value={draft}
          onChange={function (event) {
            updateDraft(event.target.value)
          }}
          placeholder="输入地址后回车，例如 example.com"
          aria-label="地址栏"
          spellCheck={false}
          className="placeholder:text-muted-foreground/70 bg-muted/40 focus:bg-muted/60 min-w-0 flex-1 rounded-md px-2 py-1 text-xs outline-hidden transition-colors"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="前往"
          title="前往"
          className="text-muted-foreground hover:text-foreground size-6 shrink-0"
          onClick={function () {
            submitAddress()
          }}>
          <Icon
            icon="lucide:corner-down-left"
            className="size-3.5"
          />
        </Button>
      </form>

      {/***** 页面视图：原生 webview 的占位区；浮层让位时用变暗截图占位（VS Code 同款） *****/}
      {view === 'page' ? (
        <div className="relative min-h-0 flex-1">
          <div
            ref={surfaceRef}
            className="absolute inset-0"
            data-browser-surface=""
          />
          {isPaused ? (
            <div
              data-browser-pause=""
              aria-hidden
              className="bg-muted pointer-events-none absolute inset-0 overflow-hidden">
              {pauseSrc ? (
                <img
                  src={pauseSrc}
                  alt=""
                  className="size-full object-cover"
                  draggable={false}
                />
              ) : null}
              <div className="bg-background/55 absolute inset-0" />
            </div>
          ) : null}
          {activeTab === undefined ? (
            <div className="text-muted-foreground pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs">
              <Icon
                icon="lucide:globe"
                className="size-6 opacity-60"
              />
              <span>还没有标签页，点 + 或直接输入地址</span>
              <span className="opacity-70">agent 可以读取并操作这里打开的页面</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {/***** 网络视图：纯 HTML，webview 已让位 *****/}
      {view === 'network' ? (
        activeLabel ? (
          <AsideBrowserNetwork label={activeLabel} />
        ) : (
          <div className="text-muted-foreground flex min-h-0 flex-1 items-center justify-center text-xs">
            先打开一个标签页
          </div>
        )
      ) : null}
    </div>
  )
}

export { AsideBrowser }
