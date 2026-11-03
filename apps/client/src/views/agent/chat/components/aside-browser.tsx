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
  fetchBrowserHistoryState,
  navigateBrowser,
  openBrowserDevtools,
  probeBrowser,
  readBrowserPage,
  reloadBrowser,
  screenshotBrowser,
  setBrowserDevice,
  startBrowserPicker,
  stepBrowserHistory,
  stopBrowserPicker,
  writeBrowserVisible,
  type BrowserPickerActiveEvent,
  type PickedBrowserElement
} from '@/features/browser/api'
import { attachPickedElement } from '@/features/browser/attach-picked-element'
import { formatAddress, formatTabTitle } from '@/features/browser/address'
import { describeDevice, fitFor, isUsableDevice } from '@/features/browser/device'
import type { BoxSize, DeviceProfile } from '@/features/browser/device'
import {
  findInstantOmniboxSuggestions,
  findRemoteOmniboxSuggestions,
  resolveOmnibox,
  type OmniboxSuggestion
} from '@/features/browser/omnibox'
import { useBrowserRect } from '@/features/browser/rect'
import { useBrowserStore } from '@/features/browser/store'
import { findSelfDebugUrl } from '@/features/window/shell-mode'
import { OMNIBAR_UI } from '@/features/command-bar/constants'

import { AsideBrowserDevice } from './aside-browser-device'
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
  /** 对齐 Chrome：聚焦编辑地址栏时不被页面导航覆盖 */
  const isEditingAddressRef = useRef(false)
  const [canGoBack, updateCanGoBack] = useState(false)
  const [canGoForward, updateCanGoForward] = useState(false)
  const [omniboxRows, updateOmniboxRows] = useState<OmniboxSuggestion[]>([])
  const [omniboxOpen, updateOmniboxOpen] = useState(false)
  const [omniboxIndex, updateOmniboxIndex] = useState(0)
  const omniboxAbortRef = useRef<AbortController | null>(null)
  const omitBlurCloseRef = useRef(false)

  const activeTab = tabs.find(function (tab) {
    return tab.label === activeLabel
  })

  /** 每个 tab 各自的设备（Rust 快照回灌，agent 改了也会跟着变） */
  const deviceByLabel = useBrowserStore(function (state) {
    return state.deviceByLabel
  })
  const activeDevice = activeLabel ? (deviceByLabel[activeLabel] ?? null) : null
  /** 面板（去掉内边距）的可用尺寸：fit 与盒子尺寸都由它算 */
  const [panelBox, updatePanelBox] = useState<BoxSize>({ width: 0, height: 0 })
  const panelRef = useRef<HTMLDivElement | null>(null)
  /** 上一次真正下发过的「设备 + fit」，避免每帧 ResizeObserver 都打一次 IPC */
  const appliedRef = useRef('')
  /** 统一 apply 的代数：过期应答不得回写 store / 清掉 key */
  const applyGenerationRef = useRef(0)
  // 只有 page 视图才量尺寸：其他视图时占位 div 不存在，webview 也应该是隐藏的
  const { ref: surfaceRef, isPaused, pauseSrc } = useBrowserRect(
    activeTab !== undefined && view === 'page',
    activeLabel
  )

  function deviceApplyKey(
    label: string,
    device: DeviceProfile,
    nextFit: number
  ): string {
    return [
      label,
      `${device.width}x${device.height}`,
      String(device.dpr),
      String(device.mobile),
      device.userAgent ?? '',
      nextFit.toFixed(3)
    ].join('|')
  }

  /** 盒子四周留白：不留位置会被面板边缘裁掉 */
  const DEVICE_GUTTER = 12

  // 面板尺寸：设备盒子按它算 fit。拉宽 / 拉窄右栏时只有 fit 和角标变，视口不变。
  useEffect(
    function () {
      const node = panelRef.current
      if (view !== 'page' || !node) return
      function measure() {
        if (!node) return
        const rect = node.getBoundingClientRect()
        updatePanelBox({ width: rect.width, height: rect.height })
      }
      measure()
      const observer = new ResizeObserver(measure)
      observer.observe(node)
      return function () {
        observer.disconnect()
      }
    },
    [view]
  )

  const usableBox: BoxSize = {
    width: Math.max(0, panelBox.width - DEVICE_GUTTER * 2),
    height: Math.max(0, panelBox.height - DEVICE_GUTTER * 2)
  }
  const fit = isUsableDevice(activeDevice) ? fitFor(activeDevice, usableBox) : 1
  const deviceBox = isUsableDevice(activeDevice)
    ? {
        width: Math.max(1, Math.round(activeDevice.width * fit)),
        height: Math.max(1, Math.round(activeDevice.height * fit))
      }
    : null

  // 面板尺寸变化 / 切到有设备的 tab → 重算 fit 并下发。
  // 用 120ms 防抖：拖动 splitter 会连续触发，逐帧打 IPC 会把 CDP 队列堵住。
  useEffect(
    function () {
      if (!activeLabel || !isUsableDevice(activeDevice)) return
      const key = deviceApplyKey(activeLabel, activeDevice, fit)
      if (appliedRef.current === key) return
      const timer = window.setTimeout(function () {
        const generation = (applyGenerationRef.current += 1)
        appliedRef.current = key
        void setBrowserDevice(activeLabel, activeDevice, fit)
          .then(function (result) {
            if (generation !== applyGenerationRef.current) return
            // 以 Rust 回传的档案为准（它会夹 fit、并记录缩放通道）
            useBrowserStore.getState().setDevice(activeLabel, result.device ?? activeDevice)
          })
          .catch(function (error: unknown) {
            if (generation !== applyGenerationRef.current) return
            appliedRef.current = ''
            console.warn('browser: 应用设备模拟失败', error)
          })
      }, 120)
      return function () {
        window.clearTimeout(timer)
      }
    },
    [activeLabel, activeDevice, fit]
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

  // 切 tab 或页面跳转后，地址栏跟上真实地址（聚焦编辑时除外，对齐 Chrome）
  const activeUrl = activeTab?.url ?? ''
  useEffect(
    function () {
      if (isEditingAddressRef.current) return
      updateDraft(formatAddress(activeUrl))
    },
    [activeUrl]
  )

  // 硬导航：`on_page_load`；SPA pushState/hash：`Page.navigatedWithinDocument`
  useEffect(function () {
    let disposed = false
    let unlisten: (() => void) | null = null
    void listen<{ label: string; url: string; sameDocument?: boolean }>(
      'browser://nav',
      function (event) {
        const sameDocument = event.payload.sameDocument === true
        useBrowserStore
          .getState()
          .writeTabUrl(event.payload.label, event.payload.url, sameDocument)
        // 硬导航会卸页面，拾取必须停；同文档 SPA 路由通常保留 DOM，不断拾取
        if (!sameDocument && pickingLabelRef.current === event.payload.label) {
          haltPicker(event.payload.label)
          toast.message('页面已跳转，元素拾取已取消')
        }
      }
    )
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

  // WebView2 HistoryChanged → 前进/后退灰态
  useEffect(function () {
    let disposed = false
    let unlisten: (() => void) | null = null
    void listen<{ label: string; canGoBack: boolean; canGoForward: boolean }>(
      'browser://history',
      function (event) {
        // 非活动 tab 丢弃；切过去时会主动拉
        if (event.payload.label !== activeLabel) return
        updateCanGoBack(event.payload.canGoBack)
        updateCanGoForward(event.payload.canGoForward)
      }
    )
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
  }, [activeLabel])

  // 切 tab：主动读一次 CanGoBack/Forward
  useEffect(
    function () {
      if (!activeLabel) {
        updateCanGoBack(false)
        updateCanGoForward(false)
        return
      }
      let cancelled = false
      void fetchBrowserHistoryState(activeLabel)
        .then(function (state) {
          if (cancelled) return
          updateCanGoBack(state.canGoBack)
          updateCanGoForward(state.canGoForward)
        })
        .catch(function (error: unknown) {
          console.warn('[aside-browser] 读历史状态失败:', error)
          if (!cancelled) {
            updateCanGoBack(false)
            updateCanGoForward(false)
          }
        })
      return function () {
        cancelled = true
      }
    },
    [activeLabel]
  )

  // omnibox：即时行 + 防抖远程建议
  useEffect(
    function () {
      if (!omniboxOpen) return
      const instant = findInstantOmniboxSuggestions(draft)
      updateOmniboxRows(instant)
      updateOmniboxIndex(0)

      omniboxAbortRef.current?.abort()
      const controller = new AbortController()
      omniboxAbortRef.current = controller
      const timer = window.setTimeout(function () {
        void findRemoteOmniboxSuggestions(draft, controller.signal).then(function (remote) {
          if (controller.signal.aborted) return
          const merged = [...instant]
          for (const row of remote) {
            if (
              merged.some(function (item) {
                return item.title === row.title
              })
            ) {
              continue
            }
            merged.push(row)
          }
          updateOmniboxRows(merged)
        })
      }, OMNIBAR_UI.DEBOUNCE_MS)

      return function () {
        window.clearTimeout(timer)
        controller.abort()
      }
    },
    [draft, omniboxOpen]
  )

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

  /**
   * 切换 / 退出设备模拟。
   *
   * 前端只出尺寸与 fit，覆盖由 Rust 下发；返回值里带页面**自报**的视口，
   * 拿它做 toast 才有验证意义（否则只是把参数念一遍）。
   */
  function changeDevice(next: DeviceProfile | null) {
    const label = activeLabel
    if (!label) return
    const nextFit = isUsableDevice(next) ? fitFor(next, usableBox) : 1
    const generation = (applyGenerationRef.current += 1)
    appliedRef.current = isUsableDevice(next) ? deviceApplyKey(label, next, nextFit) : ''
    void setBrowserDevice(label, next, nextFit)
      .then(function (result) {
        if (generation !== applyGenerationRef.current) return
        useBrowserStore.getState().setDevice(label, result.device ?? next)
        if (!next) {
          toast.success('已退出设备模拟')
          return
        }
        const readback = result.readback
        toast.success(`已切到 ${describeDevice(result.device ?? next, result.fit ?? nextFit)}`, {
          description: readback
            ? `页面实际视口 ${readback.innerWidth}×${readback.innerHeight} · DPR ${readback.dpr}${
                readback.pointerCoarse ? ' · pointer: coarse' : ''
              }`
            : undefined
        })
      })
      .catch(function (error: unknown) {
        if (generation !== applyGenerationRef.current) return
        appliedRef.current = ''
        reportError(error)
      })
  }

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

  function closeOmnibox() {
    updateOmniboxOpen(false)
    updateOmniboxRows([])
    updateOmniboxIndex(0)
  }

  function navigateOmnibox(targetUrl: string) {
    closeOmnibox()
    isEditingAddressRef.current = false
    updateDraft(formatAddress(targetUrl))
    const store = useBrowserStore.getState()
    if (view !== 'page') updateView('page')
    const label = store.activeLabel
    if (!label) {
      void store.openTab(targetUrl).catch(reportError)
      return
    }
    void navigateBrowser(label, targetUrl)
      .then(function () {
        store.writeTabUrl(label, targetUrl)
      })
      .catch(reportError)
  }

  function submitAddress(event?: React.FormEvent) {
    event?.preventDefault()
    const highlighted = omniboxOpen ? omniboxRows[omniboxIndex] : undefined
    const resolved = highlighted?.target ?? resolveOmnibox(draft)
    if (!resolved) return
    navigateOmnibox(resolved.url)
  }

  function pickOmniboxRow(row: OmniboxSuggestion) {
    navigateOmnibox(row.target.url)
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
    const name = `浏览器截图-${formatTabTitle(activeTab?.url ?? '', activeTab?.title)}.png`

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
        // 设备模拟单独一项：能不能覆盖 / 走哪条缩放通道，只有实测才知道
        const emulation = probe.emulation.ok
        const channel = probe.emulation.scaleChannel
        const emuText =
          channel && channel !== 'none' ? `模拟 ${emulation ? '✓' : '✗'}(${channel})` : `模拟 ${emulation ? '✓' : '✗'}`
        const summary = [
          `读 ${canRead ? '✓' : '✗'}`,
          `网络 ${network ? '✓' : '✗'}`,
          `拦截 ${intercept ? '✓' : '✗'}`,
          `截图 ${shot ? '✓' : '✗'}${shotKb}`,
          emuText
        ].join(' · ')

        if (canRead && network && intercept && shot && emulation) {
          toast.success(`agent 通道就绪：${summary}`, {
            description: `当前页「${read.title || '无标题'}」识别到 ${read.items?.length ?? 0} 个可交互元素`
          })
          return
        }
        if (canRead && network && intercept && shot && !emulation) {
          toast.warning(`agent 通道受限：${summary}`, {
            description:
              '设备模拟不可用（Emulation 域被拒）：H5 移动端预览会退化成只能改窗口宽度'
          })
          console.warn('browser: 设备模拟探测明细', probe.emulation)
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
                <span className="max-w-32 truncate">
                  {formatTabTitle(tab.url, tab.title)}
                </span>
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
        <AsideBrowserDevice
          device={activeDevice}
          disabled={activeTab === undefined}
          onSelect={changeDevice}
        />
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
        className="relative flex shrink-0 items-center gap-0.5 border-b px-1.5 py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="后退"
          title="后退"
          disabled={!canGoBack}
          className="text-muted-foreground hover:text-foreground size-6 shrink-0"
          onClick={function () {
            if (!activeLabel || !canGoBack) return
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
          disabled={!canGoForward}
          className="text-muted-foreground hover:text-foreground size-6 shrink-0"
          onClick={function () {
            if (!activeLabel || !canGoForward) return
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
          role="combobox"
          aria-expanded={omniboxOpen}
          aria-autocomplete="list"
          aria-controls="aside-browser-omnibox"
          onChange={function (event) {
            updateDraft(event.target.value)
            updateOmniboxOpen(true)
          }}
          onFocus={function () {
            isEditingAddressRef.current = true
            updateOmniboxOpen(true)
          }}
          onBlur={function () {
            if (omitBlurCloseRef.current) {
              omitBlurCloseRef.current = false
              return
            }
            isEditingAddressRef.current = false
            closeOmnibox()
            // 失焦未提交：回落到真实 URL（Chrome 也会放弃未确认编辑）
            updateDraft(formatAddress(activeUrl))
          }}
          onKeyDown={function (event) {
            if (!omniboxOpen || omniboxRows.length === 0) return
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              updateOmniboxIndex(function (index) {
                return (index + 1) % omniboxRows.length
              })
              return
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              updateOmniboxIndex(function (index) {
                return (index - 1 + omniboxRows.length) % omniboxRows.length
              })
              return
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              closeOmnibox()
            }
          }}
          placeholder="搜索或输入网址"
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
        {omniboxOpen && omniboxRows.length > 0 ? (
          <ul
            id="aside-browser-omnibox"
            role="listbox"
            className="bg-popover text-popover-foreground absolute top-full right-1.5 left-1.5 z-20 mt-1 max-h-56 overflow-auto rounded-md border py-1 shadow-md">
            {omniboxRows.map(function (row, index) {
              const isActive = index === omniboxIndex
              return (
                <li
                  key={row.id}
                  role="option"
                  aria-selected={isActive}
                  className={clsx(
                    'flex cursor-pointer items-center gap-2 px-2 py-1.5 text-xs',
                    isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/60'
                  )}
                  onMouseDown={function (event) {
                    // 先于 blur，避免点选前 draft 被回落
                    event.preventDefault()
                    omitBlurCloseRef.current = true
                  }}
                  onClick={function () {
                    pickOmniboxRow(row)
                  }}>
                  <Icon
                    icon={row.icon}
                    className="text-muted-foreground size-3.5 shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">{row.title}</span>
                  <span className="text-muted-foreground shrink-0 text-[10px]">{row.subtitle}</span>
                </li>
              )
            })}
          </ul>
        ) : null}
      </form>

      {/***** 页面视图：原生 webview 的占位区；浮层让位时用变暗截图占位（VS Code 同款） *****/}
      {view === 'page' ? (
        <div
          ref={panelRef}
          className="relative min-h-0 flex-1">
          {/*
            设备模式：同一个占位节点改成「居中 + 显式尺寸」的盒子。
            必须复用 DOM 节点 —— `useBrowserRect` 的 ResizeObserver 只 observe 一次，
            换节点之后尺寸变化就再也收不到了。
            `inset-3 + m-auto`：留 12px 边距（和 `usableBox` 的 DEVICE_GUTTER 对齐），
            绝对定位 + auto margin 让盒子在面板里居中。
          */}
          <div
            ref={surfaceRef}
            className={clsx(
              'absolute',
              deviceBox ? 'inset-3 m-auto rounded-sm ring-1 ring-border/70' : 'inset-0'
            )}
            style={deviceBox ?? undefined}
            data-browser-surface="">
            {deviceBox ? (
              <span className="border-border/70 bg-background/90 text-muted-foreground pointer-events-none absolute -top-5 left-0 rounded border px-1.5 py-0.5 text-[10px] leading-none tabular-nums">
                {describeDevice(activeDevice, fit)}
              </span>
            ) : null}
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
          </div>
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
