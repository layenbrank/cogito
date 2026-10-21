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
import { isAdmin, isAuthenticated } from '@/utils/auth.ts'
import { reportCaught } from '@/utils/exception-report.ts'

interface ConsoleLayoutStore extends ConsolePreference {
  isHydrated: boolean
  isSyncing: boolean
  /** 侧栏宽度折叠（本地）：antd collapsed / Naive collapsed / Element collapse */
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
    bookmarks: state.bookmarks
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
              set({
                navOrder: remote.navOrder.length ? remote.navOrder : [...DEFAULT_NAV_ORDER],
                pinnedNav: remote.pinnedNav,
                dashboardWidgets: remote.dashboardWidgets.length
                  ? remote.dashboardWidgets
                  : [...DEFAULT_DASHBOARD_WIDGETS],
                bookmarks: remote.bookmarks,
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
          isRailCollapsed: state.isRailCollapsed,
          collapsedNavGroups: state.collapsedNavGroups,
          isNavGroupIconVisible: state.isNavGroupIconVisible
        }
      }
    }
  )
)

export { useConsoleLayoutStore }
