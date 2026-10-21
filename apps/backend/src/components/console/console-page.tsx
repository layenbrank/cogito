import clsx from 'clsx'
import type { ReactNode } from 'react'

interface ConsolePageProps {
  /** 页头操作区（新建、导出等）；页面标题由侧栏/面包屑表达，不再展示 */
  actions?: ReactNode
  toolbar?: ReactNode
  children: ReactNode
  bare?: boolean
}

/**
 * 列表页壳：筛选与主操作同一行；非 bare 时卡片占满可视高度，空数据也撑满。
 */
function ConsolePage(props: ConsolePageProps) {
  const hasChrome = Boolean(props.actions || props.toolbar)
  const chrome = hasChrome ? (
    <div
      className={clsx(
        'flex shrink-0 flex-wrap items-center gap-3',
        props.bare
          ? 'mb-4'
          : 'border-b border-[var(--backend-rail-border)] bg-[var(--backend-surface)] px-3 py-2.5'
      )}>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{props.toolbar}</div>
      {props.actions ? (
        <div className="ms-auto flex shrink-0 flex-wrap items-center gap-2">{props.actions}</div>
      ) : null}
    </div>
  ) : null

  return (
    <div className="flex min-h-full flex-1 flex-col animate-in fade-in-0 duration-200">
      {props.bare ? (
        <>
          {chrome}
          {props.children}
        </>
      ) : (
        <div
          className="flex min-h-full flex-1 flex-col overflow-hidden rounded-xl border border-border/70 bg-[var(--backend-surface)]"
          style={{ boxShadow: 'var(--backend-elevation-1)' }}>
          {chrome}
          <div className="flex min-h-0 flex-1 flex-col">{props.children}</div>
        </div>
      )}
    </div>
  )
}

export { ConsolePage }
