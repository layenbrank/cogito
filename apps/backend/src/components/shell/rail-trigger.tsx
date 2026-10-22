import { Icon } from '@iconify/react/offline'

interface RailTriggerProps {
  isCollapsed: boolean
  onToggle(): void
}

/**
 * 侧栏折叠触发器，综合常见后台布局库：
 * - antd Layout.Sider：底部整宽 trigger（默认形态）
 * - Naive UI LayoutSider：`show-trigger="arrow-circle"` 贴边圆钮
 * - Element Plus：aside 宽度与 menu.collapse 同步，由外层控制
 */
function RailTriggerBar(props: RailTriggerProps) {
  const label = props.isCollapsed ? '展开侧栏' : '收起侧栏'
  return (
    <button
      type="button"
      className="flex h-11 w-full shrink-0 items-center justify-center border-t border-[var(--backend-rail-border)] text-[var(--backend-rail-muted)] transition hover:bg-[var(--backend-rail-hover)] hover:text-[var(--backend-rail-fg)]"
      aria-label={label}
      aria-pressed={props.isCollapsed}
      title={`${label} ⌘B`}
      onClick={function () {
        props.onToggle()
      }}>
      <Icon
        icon={props.isCollapsed ? 'lucide:chevrons-right' : 'lucide:chevrons-left'}
        width="var(--backend-rail-icon-glyph)"
        height="var(--backend-rail-icon-glyph)"
        className="size-[var(--backend-rail-icon-glyph)]"
      />
    </button>
  )
}

function RailTriggerEdge(props: RailTriggerProps) {
  const label = props.isCollapsed ? '展开侧栏' : '收起侧栏'
  return (
    <button
      type="button"
      className="absolute top-1/2 -right-3 z-20 flex size-6 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--backend-rail-border)] bg-[var(--backend-rail)] text-[var(--backend-rail-muted)] shadow-sm transition hover:border-[var(--backend-accent)]/40 hover:text-[var(--backend-rail-fg)]"
      aria-label={label}
      aria-pressed={props.isCollapsed}
      title={`${label} ⌘B`}
      onClick={function () {
        props.onToggle()
      }}>
      <Icon
        icon={props.isCollapsed ? 'lucide:chevron-right' : 'lucide:chevron-left'}
        className="size-3.5"
      />
    </button>
  )
}

export { RailTriggerBar, RailTriggerEdge }
