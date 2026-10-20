import { debounce } from 'lodash-es'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import {
  GET_CONSOLE_PREFERENCE,
  PUT_CONSOLE_PREFERENCE,
  type ConsoleBookmark,
  type ConsolePreference
} from '@/apis/console.ts'
import { DEFAULT_DASHBOARD_WIDGETS, DEFAULT_NAV_ORDER } from '@/constants/nav.ts'
import { isAdmin, isAuthenticated } from '@/utils/auth.ts'

interface ConsoleLayoutStore extends ConsolePreference {
  isHydrated: boolean
  isSyncing: boolean
  hydrateFromServer: () => Promise<void>
  reorderNav: (order: string[]) => void
  togglePin: (id: string) => void
  reorderWidgets: (widgets: string[]) => void
  writeBookmark: (bookmark: ConsoleBookmark) => void
  removeBookmark: (id: string) => void
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
  } catch {
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
          } catch {
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
    { name: 'backend-console-layout' }
  )
)

export { useConsoleLayoutStore }
