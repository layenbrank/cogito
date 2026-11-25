import { Badge } from '@cogito/design/components/badge'
import { Button } from '@cogito/design/components/button'
import { Switch } from '@cogito/design/components/switch'

import { ConsolePage } from '@/components/console/console-page.tsx'
import {
  DEFAULT_DASHBOARD_WIDGETS,
  NAV_ITEMS,
  findNavById
} from '@/constants/nav.ts'
import { useConsoleLayoutStore } from '@/stores/console-layout.ts'

const WIDGET_LABELS: Record<string, string> = {
  health: '日活',
  usage: '月活',
  providers: '异常',
  approvals: '快捷入口'
}

export default function PreferencesView() {
  const navOrder = useConsoleLayoutStore(function (state) {
    return state.navOrder
  })
  const pinnedNav = useConsoleLayoutStore(function (state) {
    return state.pinnedNav
  })
  const dashboardWidgets = useConsoleLayoutStore(function (state) {
    return state.dashboardWidgets
  })
  const bookmarks = useConsoleLayoutStore(function (state) {
    return state.bookmarks
  })
  const togglePin = useConsoleLayoutStore(function (state) {
    return state.togglePin
  })
  const toggleWidget = useConsoleLayoutStore(function (state) {
    return state.toggleWidget
  })
  const removeBookmark = useConsoleLayoutStore(function (state) {
    return state.removeBookmark
  })
  const appearanceMode = useConsoleLayoutStore(function (state) {
    return state.appearanceMode
  })
  const writeAppearance = useConsoleLayoutStore(function (state) {
    return state.writeAppearance
  })
  const reorderNav = useConsoleLayoutStore(function (state) {
    return state.reorderNav
  })
  const isHydrated = useConsoleLayoutStore(function (state) {
    return state.isHydrated
  })
  const isSyncing = useConsoleLayoutStore(function (state) {
    return state.isSyncing
  })

  return (
    <ConsolePage bare>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border/80 bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium">外观</h3>
            <Badge variant="secondary">已同步</Badge>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            主色与 client 一致（品牌蓝）。明暗跟随系统，也可固定。快捷键 D 循环切换。
          </p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['system', '跟随系统'],
                ['light', '浅色'],
                ['dark', '深色']
              ] as const
            ).map(function (item) {
              return (
                <Button
                  key={item[0]}
                  type="button"
                  size="sm"
                  variant={appearanceMode === item[0] ? 'default' : 'outline'}
                  onClick={function () {
                    writeAppearance(item[0])
                  }}>
                  {item[1]}
                </Button>
              )
            })}
          </div>
        </section>

        <section
          className="rounded-xl border border-border/80 bg-card p-4"
          >
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium">导航</h3>
            <Badge variant="secondary">{isSyncing ? '同步中…' : isHydrated ? '已同步' : '本地'}</Badge>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            钉选出现在顶栏。上下移动改变命令面板与偏好里的顺序。
          </p>
          <ol className="space-y-1 text-sm">
            {navOrder.map(function (id, index) {
              const item = findNavById(id) ?? NAV_ITEMS.find(function (nav) {
                return nav.id === id
              })
              if (!item) return null
              return (
                <li
                  key={id}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40">
                  <span>
                    <span className="mr-2 tabular-nums text-muted-foreground">{index + 1}.</span>
                    {item.label}
                  </span>
                  <span className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={index === 0}
                      onClick={function () {
                        const next = [...navOrder]
                        const previous = next[index - 1]
                        const current = next[index]
                        if (!previous || !current) return
                        next[index - 1] = current
                        next[index] = previous
                        reorderNav(next)
                      }}>
                      上移
                    </Button>
                    <Button
                      size="sm"
                      variant={pinnedNav.includes(id) ? 'default' : 'outline'}
                      onClick={function () {
                        togglePin(id)
                      }}>
                      {pinnedNav.includes(id) ? '已钉选' : '钉选'}
                    </Button>
                  </span>
                </li>
              )
            })}
          </ol>
        </section>

        <section
          className="rounded-xl border border-border/80 bg-card p-4"
          >
          <h3 className="mb-3 text-sm font-medium">概览小部件</h3>
          <ul className="space-y-3 text-sm">
            {DEFAULT_DASHBOARD_WIDGETS.map(function (id) {
              const enabled = dashboardWidgets.includes(id)
              return (
                <li
                  key={id}
                  className="flex items-center justify-between gap-3">
                  <span>{WIDGET_LABELS[id] ?? id}</span>
                  <Switch
                    checked={enabled}
                    onCheckedChange={function () {
                      toggleWidget(id)
                    }}
                  />
                </li>
              )
            })}
          </ul>
        </section>

        <section
          className="rounded-xl border border-border/80 bg-card p-4 lg:col-span-2"
          >
          <h3 className="mb-3 text-sm font-medium">书签</h3>
          {bookmarks.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无书签。后续可在实体页一键收藏。</p>
          ) : (
            <ul className="divide-y divide-border/60 text-sm">
              {bookmarks.map(function (bookmark) {
                return (
                  <li
                    key={bookmark.id}
                    className="flex items-center justify-between gap-3 py-2">
                    <div>
                      <p className="font-medium">{bookmark.label}</p>
                      <p className="font-mono text-xs text-muted-foreground">{bookmark.path}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={function () {
                        removeBookmark(bookmark.id)
                      }}>
                      移除
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </ConsolePage>
  )
}
