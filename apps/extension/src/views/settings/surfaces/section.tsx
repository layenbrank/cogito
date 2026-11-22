import { cn } from 'cn'
import type { ReactNode } from 'react'

/** 各设置 surface 外层栈：统一卡片间距 */
const SURFACE_STACK = 'flex max-w-full flex-col gap-2 text-sm'

const SECTION = 'rounded-xl border border-border bg-card px-3.5 py-3'
const SECTION_TITLE =
  'mb-2 border-b border-border/60 pb-1.5 text-sm font-semibold text-foreground select-none'

interface SettingsSectionProps {
  title: string
  children: ReactNode
  className?: string
}

function SettingsSection(props: SettingsSectionProps) {
  return (
    <section className={cn(SECTION, props.className)}>
      <h3 className={SECTION_TITLE}>{props.title}</h3>
      {props.children}
    </section>
  )
}

interface SettingsRowProps {
  label: string
  hint?: string
  children: ReactNode
}

function SettingsRow(props: SettingsRowProps) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-x-2.5 py-1">
      <span className="pt-1.5 text-sm leading-none text-muted-foreground">{props.label}</span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-h-7 flex-wrap items-center gap-2">{props.children}</div>
        {props.hint ? <p className="text-xs leading-snug text-muted-foreground">{props.hint}</p> : null}
      </div>
    </div>
  )
}

export { SURFACE_STACK, SettingsRow, SettingsSection }
export type { SettingsRowProps, SettingsSectionProps }
