/**
 * 浏览器面板状态。
 *
 * Rust 侧持有真实 webview；前端 tabs 与之对齐。关闭活动 tab 后活动位**顺延到最后一个**。
 * tab label 为 `browser-<uuid>`，由 Rust 分配。
 */
import { listen } from '@tauri-apps/api/event'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

import {
  activateBrowserTab,
  closeBrowserTab,
  hydrateBrowserTabs,
  navigateBrowser,
  openBrowserTab,
  type BrowserSnapshot,
  type BrowserTab
} from './api'
import { parseAddress } from './address'
import type { DeviceProfile } from './device'

/** 新 tab 的空白页：不预置首页，避免内网环境卡在加载态 */
const BLANK = 'about:blank'

interface BrowserState {
  tabs: BrowserTab[]
  activeLabel: string | null
  /**
   * 每个 tab 当前的设备模拟档案（`null` = 桌面态）。
   *
   * 与 `tabs[i].device` 冗余是刻意的：菜单要按 label 直接取，而 `tabs` 里的
   * 档案来自 Rust 快照（页面刷新后才更新）；这份跟着同一份快照重建，
   * 所以两者不会长期不一致 —— 谁更新都走 `adoptSnapshot`。
   */
  deviceByLabel: Record<string, DeviceProfile | null>
  openTab: (url?: string) => Promise<BrowserTab | null>
  closeTab: (label: string) => Promise<void>
  activateTab: (label: string) => Promise<void>
  navigateActive: (input: string) => Promise<void>
  writeTabUrl: (label: string, url: string) => void
  /** 记录某个 tab 的设备（本地先改，下一次快照会以 Rust 为准覆盖） */
  setDevice: (label: string, device: DeviceProfile | null) => void
  /** 用 Rust 快照覆盖本地（hydrate / tabs-changed） */
  adoptSnapshot: (snapshot: Pick<BrowserSnapshot, 'tabs' | 'active'>) => void
  /** 页面刷新后把 Rust 里还活着的 webview 挂回来（幂等，可重复调） */
  hydrate: () => Promise<void>
}

function findNextActive(tabs: BrowserTab[], closed: string, active: string | null): string | null {
  if (active !== closed) return active
  return tabs.length > 0 ? tabs[tabs.length - 1].label : null
}

/** label → 设备（含「没有」）。整表重建：关 tab 后不会留下幽灵 label。 */
function deviceMapOf(tabs: BrowserTab[]): Record<string, DeviceProfile | null> {
  const map: Record<string, DeviceProfile | null> = {}
  for (const tab of tabs) {
    map[tab.label] = tab.device ?? null
  }
  return map
}

/** 前端侧串行化 open，避免连点 + / agent 连开时叠在同一 await 链上把 UI 弄乱 */
let openChain: Promise<unknown> = Promise.resolve()

function enqueueOpen<T>(task: () => Promise<T>): Promise<T> {
  const run = openChain.then(task, task)
  openChain = run.then(
    function () {
      return undefined
    },
    function () {
      return undefined
    }
  )
  return run
}

const useBrowserStore = create<BrowserState>()(
  subscribeWithSelector(function (set, get) {
    return {
      tabs: [],
      activeLabel: null,
      deviceByLabel: {},

      adoptSnapshot: function (snapshot) {
        set({
          tabs: snapshot.tabs,
          activeLabel: snapshot.active,
          // 设备状态跟着 tab 一起回灌：页面刷新 / agent 改了设备后，
          // 工具栏不能还停在「桌面」而页面上其实是模拟态
          deviceByLabel: deviceMapOf(snapshot.tabs)
        })
      },

      setDevice: function (label, device) {
        set(function (state) {
          return {
            deviceByLabel: { ...state.deviceByLabel, [label]: device },
            // 与 tabs[].device 同步，避免只改 map 后快照字段仍是旧档案
            tabs: state.tabs.map(function (tab) {
              return tab.label === label ? { ...tab, device } : tab
            })
          }
        })
      },

      openTab: async function (url) {
        return enqueueOpen(async function () {
          const target = parseAddress(url ?? BLANK) || BLANK
          try {
            // 用户点 + / 地址栏开页：总是新建，同 host 复用只给 agent 工具面
            const tab = await openBrowserTab(target, true)
            set(function (state) {
              // Rust 已 insert；若 tabs-changed 抢先 adopt 过，避免重复追加
              const device = tab.device ?? null
              if (state.tabs.some(function (item) {
                return item.label === tab.label
              })) {
                return {
                  activeLabel: tab.label,
                  deviceByLabel: { ...state.deviceByLabel, [tab.label]: device }
                }
              }
              return {
                tabs: [...state.tabs, tab],
                activeLabel: tab.label,
                deviceByLabel: { ...state.deviceByLabel, [tab.label]: device }
              }
            })
            return tab
          } catch (error) {
            console.warn('browser: 打开标签页失败', error)
            // 失败时拉一次快照，清掉可能的半残态
            try {
              const snapshot = await hydrateBrowserTabs()
              get().adoptSnapshot({
                tabs: snapshot.tabs,
                active: snapshot.active
              })
            } catch (hydrateError) {
              console.warn('browser: 打开失败后回灌也失败', hydrateError)
            }
            throw error
          }
        })
      },

      closeTab: async function (label) {
        await closeBrowserTab(label)
        set(function (state) {
          const tabs = state.tabs.filter(function (tab) {
            return tab.label !== label
          })
          return {
            tabs,
            activeLabel: findNextActive(tabs, label, state.activeLabel),
            deviceByLabel: deviceMapOf(tabs)
          }
        })
      },

      activateTab: async function (label) {
        if (get().activeLabel === label) return
        await activateBrowserTab(label)
        set({ activeLabel: label })
      },

      navigateActive: async function (input) {
        const label = get().activeLabel
        const url = parseAddress(input)
        if (!label || !url) return
        await navigateBrowser(label, url)
        get().writeTabUrl(label, url)
      },

      writeTabUrl: function (label, url) {
        set(function (state) {
          return {
            tabs: state.tabs.map(function (tab) {
              // 导航换文档，旧标题作废，等 tabs-changed / 下次快照带回
              return tab.label === label ? { ...tab, url, title: '' } : tab
            })
          }
        })
      },

      hydrate: async function () {
        const snapshot = await hydrateBrowserTabs()
        get().adoptSnapshot({ tabs: snapshot.tabs, active: snapshot.active })
      }
    }
  })
)

/** 订阅 Rust 广播的 tab 变更（agent 开页 / 孤儿清理），只装一次 */
let tabsChangedBound = false
function bindBrowserTabsChanged() {
  if (tabsChangedBound) return
  tabsChangedBound = true
  void listen<BrowserSnapshot>('browser://tabs-changed', function (event) {
    useBrowserStore.getState().adoptSnapshot(event.payload)
  }).catch(function (error: unknown) {
    tabsChangedBound = false
    console.warn('browser: 订阅 tabs-changed 失败', error)
  })
}

bindBrowserTabsChanged()

export { useBrowserStore }
export type { BrowserState }
