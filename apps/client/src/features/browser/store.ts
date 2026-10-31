/**
 * 浏览器面板状态。
 *
 * tab 列表在前端是权威（所有操作都由这里发起），Rust 侧只存一份渲染需要的
 * 快照（哪个 tab 活动、当前 rect、是否该显示）。两边对「关闭活动 tab 后谁是
 * 活动 tab」的规则必须一致：**顺延到最后一个**。
 */
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

import {
  activateBrowserTab,
  closeBrowserTab,
  hydrateBrowserTabs,
  navigateBrowser,
  openBrowserTab,
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
  /** 页面刷新后把 Rust 里还活着的 webview 挂回来（幂等，可重复调） */
  hydrate: () => Promise<void>
}

function findNextActive(tabs: BrowserTab[], closed: string, active: string | null): string | null {
  if (active !== closed) return active
  return tabs.length > 0 ? tabs[tabs.length - 1].label : null
}

const useBrowserStore = create<BrowserState>()(
  subscribeWithSelector(function (set, get) {
    return {
      tabs: [],
      activeLabel: null,

      openTab: async function (url) {
        const target = parseAddress(url ?? BLANK) || BLANK
        const tab = await openBrowserTab(target)
        set(function (state) {
          return { tabs: [...state.tabs, tab], activeLabel: tab.label }
        })
        return tab
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
        set({ tabs: snapshot.tabs, activeLabel: snapshot.active })
      }
    }
  })
)

export { useBrowserStore }
export type { BrowserState }
