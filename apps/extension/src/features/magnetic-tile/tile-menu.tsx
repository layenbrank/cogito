import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { clsx } from 'clsx'

import { Glyph } from '@/features/shell/glyph.tsx'

export function TileMenu(props: {
  title: string
  onEdit: () => void
  onRemove: () => void
}) {
  return (
    <div
      className={clsx(
        'absolute right-1.5 top-1.5 opacity-0 transition-opacity',
        'group-hover:opacity-100 group-focus-within:opacity-100'
      )}>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              size="icon-sm"
              variant="secondary"
              aria-label={`${props.title} 操作`}
            />
          }>
            <Glyph name="ellipsis" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={props.onEdit}>编辑</DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={props.onRemove}>
            删除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
