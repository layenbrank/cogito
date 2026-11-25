import { debounce } from 'lodash-es'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import {
  GET_CONSOLE_PREFERENCE,
  PUT_CONSOLE_PREFERENCE,
  type ConsoleBookmark,
  type ConsolePreference
} from '@/apis/console.ts'
import {
  DEFAULT_DASHBOARD_WIDGETS,
  DEFAULT_NAV_ORDER,
  NAV_GROUPS,
  NAV_GROUP_DEFAULT_OPEN,
  NAV_GROUP_SHOW_ICON,
  RAIL_DEFAULT_COLLAPSED
} from '@/constants/nav.ts'
import type { AppearanceMode } from '@/features/appearance/paint.ts'
import { isAdmin, isAuthenticated } from '@/utils/auth.ts'
import { reportCaught } from '@/utils/exception-report.ts'

const PREF_APPEARANCE = 'pref:appearance'
const PREF_PROVIDER_ORDER = 'pref:provider-order'

function splitBookmarks(bookmarks: ConsoleBookmark[]) {
  let appearanceMode: AppearanceMode = 'system'
  const providerOrder: string[] = []
  const visible = bookmarks.filter(function (item) {
    if (item.id === PREF_APPEARANCE) {
      if (item.label === 'light' || item.label === 'dark' || item.label === 'system') {
        appearanceMode = item.label
      }
      return false
    }
    if (item.id === PREF_PROVIDER_ORDER) {
      item.label
        .split(',')
        .filter(Boolean)
        .forEach(function (id) {
          providerOrder.push(id)
        })
      return false
    }
    return true
  })
  return { appearanceMode, providerOrder, bookmarks: visible }
}

function packBookmarks(state: {
  bookmarks: ConsoleBookmark[]
  appearanceMode: AppearanceMode
  providerOrder: string[]
}): ConsoleBookmark[] {
  return [
    ...state.bookmarks,
    {
      id: PREF_APPEARANCE,
      label: state.appearanceMode,
      path: 'cogito:appearance'
    },
    {
      id: PREF_PROVIDER_ORDER,
      label: state.providerOrder.join(','),
      path: 'cogito:provider-order'
    }
  ]
}

interface ConsoleLayoutStore extends ConsolePreference {
  isHydrated: boolean
  isSyncing: boolean
  appearanceMode: AppearanceMode
  providerOrder: string[]
  /** 侧栏已移除；字段保留以免旧的本地 persist 解析失败 */
  isRailCollapsed: boolean
  /** 已收起的导航分组（对齐 antd openKeys 的补集） */
  collapsedNavGroups: string[]
  /** 分类标题是否显示图标 */
  isNavGroupIconVisible: boolean
  hydrateFromServer: () => Promise<void>
  reorderNav: (order: string[]) => void
  togglePin: (id: string) => void
  reorderWidgets: (widgets: string[]) => void
  toggleWidget: (id: string) => void
  writeBookmark: (bookmark: ConsoleBookmark) => void
  removeBookmark: (id: string) => void
  writeAppearance: (mode: AppearanceMode) => void
  writeProviderOrder: (order: string[]) => void
  toggleRailCollapsed: () => void
  writeRailCollapsed: (collapsed: boolean) => void
  toggleNavGroup: (group: string) => void
  writeNavGroupIconVisible: (visible: boolean) => void
}

function findInitialCollapsedNavGroups() {
  if (NAV_GROUP_DEFAULT_OPEN) return [] as string[]
  return NAV_GROUPS.map(function (group) {
    return group.id
  })
}

function snapshot(state: ConsoleLayoutStore): ConsolePreference {
  return {
    navOrder: state.navOrder,
    pinnedNav: state.pinnedNav,
    dashboardWidgets: state.dashboardWidgets,
    bookmarks: packBookmarks(state)
  }
}

const syncPreference = debounce(async function (body: ConsolePreference) {
  if (!isAuthenticated() || !isAdmin()) return
  try {
    await PUT_CONSOLE_PREFERENCE(body)
  } catch (error) {
    reportCaught('console-layout.syncPreference', error)
    /* 本地 persist 仍可用；服务端失败不打断操作 */
  }
}, 600)

const useConsoleLayoutStore = create<ConsoleLayoutStore>()(
  persist(
    function (set, get) {
      return {
        navOrder: [...DEFAULT_NAV_ORDER],
        pinnedNav: [],
        dashboardWidgets: [...DEFAULT_DASHBOARD_WIDGETS],
        bookmarks: [],
        appearanceMode: 'system',
        providerOrder: [],
        isHydrated: false,
        isSyncing: false,
        isRailCollapsed: RAIL_DEFAULT_COLLAPSED,
        collapsedNavGroups: findInitialCollapsedNavGroups(),
        isNavGroupIconVisible: NAV_GROUP_SHOW_ICON,
        toggleRailCollapsed() {
          set(function (state) {
            return { isRailCollapsed: !state.isRailCollapsed }
          })
        },
        writeRailCollapsed(collapsed) {
          set({ isRailCollapsed: collapsed })
        },
        toggleNavGroup(group) {
          set(function (state) {
            const has = state.collapsedNavGroups.includes(group)
            return {
              collapsedNavGroups: has
                ? state.collapsedNavGroups.filter(function (item) {
                    return item !== group
                  })
                : [...state.collapsedNavGroups, group]
            }
          })
        },
        writeNavGroupIconVisible(visible) {
          set({ isNavGroupIconVisible: visible })
        },
        async hydrateFromServer() {
          if (!isAuthenticated() || !isAdmin()) {
            set({ isHydrated: true })
            return
          }
          set({ isSyncing: true })
          try {
            const remote = await GET_CONSOLE_PREFERENCE()
            if (remote) {
              const parsed = splitBookmarks(remote.bookmarks)
              set({
                navOrder: remote.navOrder.length ? remote.navOrder : [...DEFAULT_NAV_ORDER],
                pinnedNav: remote.pinnedNav,
                dashboardWidgets: remote.dashboardWidgets.length
                  ? remote.dashboardWidgets
                  : [...DEFAULT_DASHBOARD_WIDGETS],
                bookmarks: parsed.bookmarks,
                appearanceMode: parsed.appearanceMode,
                providerOrder: parsed.providerOrder,
                isHydrated: true,
                isSyncing: false
              })
              return
            }
            await PUT_CONSOLE_PREFERENCE(snapshot(get()))
            set({ isHydrated: true, isSyncing: false })
          } catch (error) {
            reportCaught('console-layout.hydrateFromServer', error)
            set({ isHydrated: true, isSyncing: false })
          }
        },
        reorderNav(order) {
          set({ navOrder: order })
          void syncPreference(snapshot(get()))
        },
        togglePin(id) {
          const pinned = get().pinnedNav
          const next = pinned.includes(id)
            ? pinned.filter(function (item) {
                return item !== id
              })
            : [...pinned, id]
          set({ pinnedNav: next })
          void syncPreference(snapshot(get()))
        },
        reorderWidgets(widgets) {
          set({ dashboardWidgets: widgets })
          void syncPreference(snapshot(get()))
        },
        toggleWidget(id) {
          const current = get().dashboardWidgets
          const next = current.includes(id)
            ? current.filter(function (item) {
                return item !== id
              })
            : [...current, id]
          set({ dashboardWidgets: next.length ? next : [...DEFAULT_DASHBOARD_WIDGETS] })
          void syncPreference(snapshot(get()))
        },
        writeBookmark(bookmark) {
          const bookmarks = [
            bookmark,
            ...get().bookmarks.filter(function (item) {
              return item.id !== bookmark.id
            })
          ].slice(0, 20)
          set({ bookmarks })
          void syncPreference(snapshot(get()))
        },
        removeBookmark(id) {
          set({
            bookmarks: get().bookmarks.filter(function (item) {
              return item.id !== id
            })
          })
          void syncPreference(snapshot(get()))
        },
        writeAppearance(mode) {
          set({ appearanceMode: mode })
          void syncPreference(snapshot(get()))
        },
        writeProviderOrder(order) {
          set({ providerOrder: order })
          void syncPreference(snapshot(get()))
        }
      }
    },
    {
      name: 'backend-console-layout',
      partialize(state) {
        return {
          navOrder: state.navOrder,
          pinnedNav: state.pinnedNav,
          dashboardWidgets: state.dashboardWidgets,
          bookmarks: state.bookmarks,
          appearanceMode: state.appearanceMode,
          providerOrder: state.providerOrder,
          isRailCollapsed: state.isRailCollapsed,
          collapsedNavGroups: state.collapsedNavGroups,
          isNavGroupIconVisible: state.isNavGroupIconVisible
        }
      }
    }
  )
)

export { useConsoleLayoutStore }
