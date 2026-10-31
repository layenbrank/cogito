import { type ReactNode } from 'react'

import { Kbd, KbdGroup } from '@cogito/design/components/kbd'
import { parseShortcutKeys } from '@/lib/tiptap-utils.ts'

interface ShortcutBadgeProps {
  shortcutKeys?: string
}

function renderShortcutKeys(keys: string[], separatorClassName: string) {
  const nodes: ReactNode[] = []
  for (const key of keys) {
    if (nodes.length > 0) {
      nodes.push(
        <span className={separatorClassName} key={`sep-${key}`}>
          +
        </span>
      )
    }
    nodes.push(<Kbd key={key}>{key}</Kbd>)
  }
  return nodes
}

/** 仅用于菜单项等需要内联展示的场景；工具栏请走 Button tooltip + shortcutKeys */
function ShortcutBadge(props: ShortcutBadgeProps) {
  const keys = parseShortcutKeys({ shortcutKeys: props.shortcutKeys })
  if (keys.length === 0) return null

  return (
    <KbdGroup className="tiptap-shortcut-badge ml-auto">
      {renderShortcutKeys(keys, 'text-muted-foreground/60 px-0.5 text-xs')}
    </KbdGroup>
  )
}

export { ShortcutBadge }
export type { ShortcutBadgeProps }
