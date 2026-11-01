import { cn } from 'cn'
import { useLayoutEffect, useMemo, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

import { Caption } from '@/features/window-shell/caption'
import { isOverviewPath } from '@/features/magnetic-tile/overview-path'
import { useShowsTileSession } from '@/features/magnetic-tile/session-bar'
import { ShellOverlayHost, useShellOverlayHost } from '@/features/window-shell/overlay-host'
import { useShellSlots } from '@/features/window-shell/slots'

interface OverviewCaptionSlots {
  center: ReactNode
  final: ReactNode
}

interface ShellFrameProps {
  children: ReactNode
  /** Overview 模式操作栏；由 WorkspaceShell 注入，避免本域依赖 views */
  overviewCaption?: OverviewCaptionSlots
}

function isOverlayPath(pathname: string) {
  return pathname === '/overlay' || pathname.startsWith('/overlay/')
}

function findSummaryBegin(
  begin: ReactNode | undefined,
  summary: string | undefined,
  showsSession: boolean
): ReactNode {
  if (begin) return begin
  if (showsSession || !summary) return null
  return <span className="truncate px-1 text-sm font-medium">{summary}</span>
}

/**
 * Overview 操作栏常驻（切应用时 hidden 保活 Omnibar 等），
 * 应用页另挂一套 Caption；可见侧才开窗控，避免双份窗口键。
 */
function ShellCaption(props: { overviewCaption?: OverviewCaptionSlots }) {
  const location = useLocation()
  const isOverview = isOverviewPath(location.pathname)
  const isOverlay = isOverlayPath(location.pathname)
  const slots = useShellSlots()
  const showsSession = useShowsTileSession()
  const showsOverviewBar = isOverview && !isOverlay
  const showsAppBar = !isOverview && !isOverlay

  return (
    <>
      {props.overviewCaption ? (
        <div
          className={showsOverviewBar ? undefined : 'hidden'}
          aria-hidden={showsOverviewBar ? undefined : true}>
          <Caption
            center={props.overviewCaption.center}
            final={props.overviewCaption.final}
            showsSessions={false}
            controls={showsOverviewBar}
          />
        </div>
      ) : null}
      {showsAppBar ? (
        <Caption
          begin={findSummaryBegin(slots.begin, slots.summary, showsSession)}
          final={slots.final}
          controls={slots.controls}
        />
      ) : null}
    </>
  )
}

function ShellSection() {
  const location = useLocation()
  const isOverview = isOverviewPath(location.pathname)
  const isOverlay = isOverlayPath(location.pathname)
  const slots = useShellSlots()

  if (isOverview || isOverlay || !slots.section) return null

  return (
    <section
      className={cn(
        'flex shrink-0 justify-end gap-2.5 border-t border-border bg-background px-5 py-3',
        slots.sectionClassName
      )}>
      {slots.section}
    </section>
  )
}

/**
 * 把 scrollable / className 写到 OverlayHost DOM，本组件重渲不带动页面子树。
 */
function ShellBodySync() {
  const location = useLocation()
  const isOverview = isOverviewPath(location.pathname)
  const isOverlay = isOverlayPath(location.pathname)
  const slots = useShellSlots()
  const host = useShellOverlayHost()

  useLayoutEffect(
    function () {
      if (!host) return
      const scrollable = isOverview || isOverlay ? false : (slots.scrollable ?? true)
      host.classList.toggle('overflow-auto', scrollable)
      host.classList.toggle('overflow-hidden', !scrollable)
      host.classList.toggle('bg-background', !isOverview && !isOverlay)

      const extra = !isOverview && !isOverlay ? slots.className : undefined
      if (extra) host.classList.add(...extra.split(/\s+/).filter(Boolean))

      return function () {
        if (extra) host.classList.remove(...extra.split(/\s+/).filter(Boolean))
      }
    },
    [host, isOverview, isOverlay, slots.scrollable, slots.className]
  )

  return null
}

/**
 * 主窗窗口壳：稳定 Caption + OverlayHost 内容区 + 可选底栏。
 * 页通过 useShellSurface 申报槽；Overview 操作栏由 props 注入并保活。
 */
function ShellFrame(props: ShellFrameProps) {
  const overviewCaption = useMemo(
    function () {
      return props.overviewCaption
    },
    [props.overviewCaption]
  )

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-transparent text-foreground">
      <ShellCaption overviewCaption={overviewCaption} />
      <ShellOverlayHost className="overflow-hidden">
        <ShellBodySync />
        {props.children}
      </ShellOverlayHost>
      <ShellSection />
    </div>
  )
}

export { ShellFrame }
export type { OverviewCaptionSlots, ShellFrameProps }
