import { Badge } from '@cogito/design/components/badge'
import { Button } from '@cogito/design/components/button'
import { Switch } from '@cogito/design/components/switch'

import { ConsolePage } from '@/components/console/console-page.tsx'
import {
  DEFAULT_DASHBOARD_WIDGETS,
  NAV_GROUP_DEFAULT_OPEN,
  NAV_GROUP_SHOW_ICON,
  NAV_ITEMS,
  RAIL_DEFAULT_COLLAPSED,
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
  const isRailCollapsed = useConsoleLayoutStore(function (state) {
    return state.isRailCollapsed
  })
  const writeRailCollapsed = useConsoleLayoutStore(function (state) {
    return state.writeRailCollapsed
  })
  const isNavGroupIconVisible = useConsoleLayoutStore(function (state) {
    return state.isNavGroupIconVisible
  })
  const writeNavGroupIconVisible = useConsoleLayoutStore(function (state) {
    return state.writeNavGroupIconVisible
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
        <section
          className="rounded-xl border border-border/80 bg-[var(--backend-surface)] p-4"
          style={{ boxShadow: 'var(--backend-elevation-1)' }}>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium">侧栏</h3>
            <Badge variant="secondary">本地</Badge>
          </div>
          <ul className="space-y-3 text-sm">
            <li className="flex items-center justify-between gap-3">
              <div>
                <p>折叠侧栏</p>
                <p className="text-xs text-muted-foreground">
                  对齐 antd Sider collapsed；代码默认{' '}
                  {RAIL_DEFAULT_COLLAPSED ? '收起' : '展开'}（`RAIL_DEFAULT_COLLAPSED`）
                </p>
              </div>
              <Switch
                checked={isRailCollapsed}
                onCheckedChange={function (checked) {
                  writeRailCollapsed(checked)
                }}
              />
            </li>
            <li className="flex items-center justify-between gap-3">
              <div>
                <p>分类显示图标</p>
                <p className="text-xs text-muted-foreground">
                  代码默认 {NAV_GROUP_SHOW_ICON ? '显示' : '隐藏'}（`NAV_GROUP_SHOW_ICON`）
                </p>
              </div>
              <Switch
                checked={isNavGroupIconVisible}
                onCheckedChange={function (checked) {
                  writeNavGroupIconVisible(checked)
                }}
              />
            </li>
            <li className="rounded-md bg-muted/40 px-2.5 py-2 text-xs text-muted-foreground">
              导航分组默认{NAV_GROUP_DEFAULT_OPEN ? '展开' : '收起'}（`NAV_GROUP_DEFAULT_OPEN`）；侧栏内点分组标题可单独开合。
            </li>
          </ul>
        </section>

        <section
          className="rounded-xl border border-border/80 bg-[var(--backend-surface)] p-4"
          style={{ boxShadow: 'var(--backend-elevation-1)' }}>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium">导航</h3>
            <Badge variant="secondary">{isSyncing ? '同步中…' : isHydrated ? '已同步' : '本地'}</Badge>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            在侧栏拖拽即可改序；此处可开关钉选。当前序：
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
                  <Button
                    size="sm"
                    variant={pinnedNav.includes(id) ? 'default' : 'outline'}
                    onClick={function () {
                      togglePin(id)
                    }}>
                    {pinnedNav.includes(id) ? '已钉选' : '钉选'}
                  </Button>
                </li>
              )
            })}
          </ol>
        </section>

        <section
          className="rounded-xl border border-border/80 bg-[var(--backend-surface)] p-4"
          style={{ boxShadow: 'var(--backend-elevation-1)' }}>
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
          className="rounded-xl border border-border/80 bg-[var(--backend-surface)] p-4 lg:col-span-2"
          style={{ boxShadow: 'var(--backend-elevation-1)' }}>
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
