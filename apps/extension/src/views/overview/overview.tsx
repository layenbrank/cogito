import { Icon } from '@iconify/react/offline'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@cogito/design/components/alert-dialog'
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { clsx } from 'clsx'
import { useEffect, useState } from 'react'

import wallpaper from '@/assets/wallpaper/r2e391.png'
import { NavigationTile } from '@/features/magnetic-tile/navigation.tsx'
import { TileDialog } from '@/features/magnetic-tile/tile-dialog.tsx'
import { useMirrorStore } from '@/features/mirror/store.ts'

/** 网格单元边长（px）：磁贴按 size/shape/direction 跨格 */
const TILE_UNIT = 112

const TIME_FORMAT: Intl.DateTimeFormatOptions = {
  month: 'long',
  day: 'numeric',
  weekday: 'long'
}

const CLOCK_FORMAT: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
}

/**
 * 概览容器（shadcn 重写）：顶部信息条 + 磁贴网格 + 增删改弹窗。
 *
 * 原 macOS 菜单条（多语言按钮 / wifi 电池图标 / 远端搜索）与拖拽排序没有保留，
 * 需要的话再按 shadcn 的组件补回来。
 */
export default function Overview() {
  const isReady = useMirrorStore(function (state) {
    return state.isReady
  })
  const mirror = useMirrorStore(function (state) {
    return state.mirror
  })
  const tiles = useMirrorStore(function (state) {
    return state.tiles
  })
  const initialize = useMirrorStore(function (state) {
    return state.initialize
  })
  const toAppendTile = useMirrorStore(function (state) {
    return state.toAppendTile
  })
  const toUpdateTile = useMirrorStore(function (state) {
    return state.toUpdateTile
  })
  const toRemoveTile = useMirrorStore(function (state) {
    return state.toRemoveTile
  })

  const [now, updateNow] = useState(function () {
    return new Date()
  })
  const [keyword, updateKeyword] = useState('')
  const [editing, updateEditing] = useState<MagneticTile | null>(null)
  const [isFormOpen, updateFormOpen] = useState(false)
  const [removing, updateRemoving] = useState<MagneticTile | null>(null)

  useEffect(
    function () {
      initialize()
    },
    [initialize]
  )

  useEffect(function () {
    const timer = window.setInterval(function () {
      updateNow(new Date())
    }, 30_000)

    return function () {
      window.clearInterval(timer)
    }
  }, [])

  const normalized = keyword.trim().toLowerCase()
  const visible = normalized
    ? tiles.filter(function (tile) {
        return tile.title.toLowerCase().includes(normalized)
      })
    : tiles

  const backgroundImage = mirror?.background?.image ?? wallpaper

  function openCreate(): void {
    updateEditing(null)
    updateFormOpen(true)
  }

  function openEdit(tile: MagneticTile): void {
    updateEditing(tile)
    updateFormOpen(true)
  }

  return (
    <div
      className={clsx('relative flex h-full w-full flex-col overflow-hidden')}
      style={{
        backgroundImage: `url(${backgroundImage})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center'
      }}>
      <div className={clsx('absolute inset-0 bg-background/40 backdrop-blur-[2px]')} />

      <div className={clsx('relative flex h-full w-full flex-col gap-4 p-6')}>
        <header className={clsx('flex flex-wrap items-center gap-3')}>
          <div className={clsx('mr-auto flex flex-col')}>
            <span className={clsx('text-sm text-muted-foreground')}>
              {now.toLocaleDateString('zh-CN', TIME_FORMAT)}
            </span>
            <span className={clsx('text-2xl font-semibold tabular-nums')}>
              {now.toLocaleTimeString('zh-CN', CLOCK_FORMAT)}
            </span>
          </div>

          <div className={clsx('relative')}>
            <Icon icon="lucide:search"
              className={clsx(
                'pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground'
              )} />
            <Input
              value={keyword}
              placeholder="搜索磁贴"
              aria-label="搜索磁贴"
              className={clsx('w-56 pl-8')}
              onChange={function (event) {
                updateKeyword(event.target.value)
              }}
            />
          </div>

          <Button
            type="button"
            onClick={openCreate}>
            <Icon icon="lucide:plus" />
            添加磁贴
          </Button>
        </header>

        <main
          className={clsx('grid flex-1 content-start gap-4 overflow-y-auto pb-2')}
          style={{
            gridTemplateColumns: `repeat(auto-fill, minmax(${TILE_UNIT}px, 1fr))`,
            gridAutoRows: `${TILE_UNIT}px`
          }}>
          {visible.map(function (tile) {
            return (
              <NavigationTile
                key={tile.id}
                tile={tile}
                onEdit={openEdit}
                onRemove={updateRemoving}
              />
            )
          })}
        </main>

        {isReady && visible.length === 0 ? (
          <p className={clsx('text-center text-sm text-muted-foreground')}>
            {tiles.length === 0 ? '还没有磁贴，点右上角添加一个。' : '没有匹配的磁贴。'}
          </p>
        ) : null}
      </div>

      {isFormOpen ? (
        <TileDialog
          key={editing?.id ?? 'create'}
          tile={editing}
          onOpenChange={updateFormOpen}
          onSubmit={function (input) {
            return editing ? toUpdateTile(editing.id, input) : toAppendTile(input)
          }}
        />
      ) : null}

      <AlertDialog
        open={Boolean(removing)}
        onOpenChange={function (open) {
          if (!open) updateRemoving(null)
        }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除「{removing?.title ?? ''}」？</AlertDialogTitle>
            <AlertDialogDescription>该磁贴会从当前镜像中移除，操作不可撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={function () {
                // 关闭由 Radix 触发 onOpenChange，这里不清 `removing`：否则标题会在退出动画里闪成空
                if (removing) void toRemoveTile(removing.id)
              }}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
