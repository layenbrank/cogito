import { Fragment } from 'react'

import { Badge } from '@/components/tiptap-ui-primitive/badge/badge.tsx'
import { parseShortcutKeys } from '@/lib/tiptap-utils.ts'

import '@/components/tiptap-ui-primitive/badge/shortcut-badge.scss'

interface ShortcutBadgeProps {
  shortcutKeys?: string
}

function ShortcutBadge(props: ShortcutBadgeProps) {
  const keys = parseShortcutKeys({ shortcutKeys: props.shortcutKeys })
  if (keys.length === 0) return null

  return (
    <Badge
      size="small"
      className="tiptap-shortcut-badge">
      {keys.map(function (key, index) {
        return (
          <Fragment key={`${key}-${index}`}>
            {index > 0 ? <span className="tiptap-shortcut-sep">+</span> : null}
            <kbd className="tiptap-shortcut-key">{key}</kbd>
          </Fragment>
        )
      })}
    </Badge>
  )
}

export { ShortcutBadge }
export type { ShortcutBadgeProps }
