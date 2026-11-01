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

/** 新 tab 的空白页：不预置首页，避免内网环境卡在加载态 */
const BLANK = 'about:blank'

interface BrowserState {
  tabs: BrowserTab[]
  activeLabel: string | null
  openTab: (url?: string) => Promise<BrowserTab | null>
  closeTab: (label: string) => Promise<void>
  activateTab: (label: string) => Promise<void>
  navigateActive: (input: string) => Promise<void>
  writeTabUrl: (label: string, url: string) => void
  /** 用 Rust 快照覆盖本地（hydrate / tabs-changed） */
  adoptSnapshot: (snapshot: Pick<BrowserSnapshot, 'tabs' | 'active'>) => void
  /** 页面刷新后把 Rust 里还活着的 webview 挂回来（幂等，可重复调） */
  hydrate: () => Promise<void>
}

function findNextActive(tabs: BrowserTab[], closed: string, active: string | null): string | null {
  if (active !== closed) return active
  return tabs.length > 0 ? tabs[tabs.length - 1].label : null
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

      adoptSnapshot: function (snapshot) {
        set({
          tabs: snapshot.tabs,
          activeLabel: snapshot.active
        })
      },

      openTab: async function (url) {
        return enqueueOpen(async function () {
          const target = parseAddress(url ?? BLANK) || BLANK
          try {
            const tab = await openBrowserTab(target)
            set(function (state) {
              // Rust 已 insert；若 tabs-changed 抢先 adopt 过，避免重复追加
              if (state.tabs.some(function (item) {
                return item.label === tab.label
              })) {
                return { activeLabel: tab.label }
              }
              return { tabs: [...state.tabs, tab], activeLabel: tab.label }
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
          return { tabs, activeLabel: findNextActive(tabs, label, state.activeLabel) }
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
              return tab.label === label ? { ...tab, url } : tab
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
