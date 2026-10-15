import { Fragment } from 'react'

import { Kbd, KbdGroup } from '@i-thinking/design/components/kbd'
import { parseShortcutKeys } from '@/lib/tiptap-utils.ts'

interface ShortcutBadgeProps {
  shortcutKeys?: string
}

/** 仅用于菜单项等需要内联展示的场景；工具栏请走 Button tooltip + shortcutKeys */
function ShortcutBadge(props: ShortcutBadgeProps) {
  const keys = parseShortcutKeys({ shortcutKeys: props.shortcutKeys })
  if (keys.length === 0) return null

  return (
    <KbdGroup className="tiptap-shortcut-badge ml-auto">
      {keys.map(function (key, index) {
        return (
          <Fragment key={`${key}-${index}`}>
            {index > 0 ? (
              <span className="text-muted-foreground/60 px-0.5 text-[10px]">+</span>
            ) : null}
            <Kbd>{key}</Kbd>
          </Fragment>
        )
      })}
    </KbdGroup>
  )
}

export { ShortcutBadge }
export type { ShortcutBadgeProps }
