import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@cogito/design/components/dialog'
import { Button } from '@cogito/design/components/button'
import { clsx } from 'clsx'

import { Glyph } from '@/features/shell/glyph.tsx'
import { TILE_CREATABLE, findTileKind } from './registry.ts'

import type { CreatableKind } from './registry.ts'

interface TileLibraryProps {
  onOpenChange: (open: boolean) => void
  /** 选中种类：交给新建对话框填名称 / 链接，不在这里直接落库 */
  onPick: (component: MagneticTile.Component) => void
}

/**
 * 磁贴库：一览式挑选面板。
 *
 * 为什么要有它：「添加磁贴」原来是直接弹一个网址表单，等于告诉用户「磁贴只有网址」。
 * 镜像上的主产品是**磁贴种类**，添加的第一步就该是「要哪一种」，而不是「填个链接」。
 *
 * 选中后不直接落库，交给 `TileDialog` 补名称 —— 磁贴标题是用户可见的东西，
 * 不该由我们拿种类名糊上去（那样镜像里会出现一堆叫「对话」「对话」的磁贴）。
 */
function TileLibrary(props: TileLibraryProps) {
  return (
    <Dialog open onOpenChange={props.onOpenChange}>
      <DialogContent className={clsx('sm:max-w-lg')}>
        <DialogHeader>
          <DialogTitle>磁贴库</DialogTitle>
          <DialogDescription>选一种磁贴，下一步再填名称和样式。</DialogDescription>
        </DialogHeader>

        <div className={clsx('grid grid-cols-2 gap-3 py-2')}>
          {TILE_CREATABLE.map(function (item: CreatableKind) {
            const kind = findTileKind(item.component)
            return (
              <Button
                key={item.component}
                type="button"
                variant="outline"
                className={clsx('h-auto flex-col items-start gap-1 p-3 text-left')}
                onClick={function () {
                  props.onPick(item.component)
                }}>
                <span className={clsx('flex items-center gap-2 text-sm font-medium')}>
                  <Glyph
                    name={kind.icon}
                    className={clsx('size-4')}
                  />
                  {item.label}
                </span>
                <span className={clsx('text-xs font-normal text-muted-foreground')}>
                  {item.hint}
                </span>
              </Button>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export { TileLibrary }
