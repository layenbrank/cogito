import { Button } from '@cogito/design/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cogito/design/components/dialog'
import { Input } from '@cogito/design/components/input'
import { Label } from '@cogito/design/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { clsx } from 'clsx'
import { useState } from 'react'

import type { MagneticTileInput } from '@/features/mirror/input.ts'
import { parseSiteUrl } from '@/features/mirror/url.ts'
import { findGridSpan } from './layout.ts'

interface TileDialogProps {
  /** 传 null 表示新建 */
  tile: MagneticTile | null
  onOpenChange: (open: boolean) => void
  onSubmit: (input: MagneticTileInput) => Promise<void>
}

const SHAPES: readonly { value: MagneticTile.Shape; label: string }[] = [
  { value: 'square', label: '方形' },
  { value: 'circle', label: '圆形' },
  { value: 'rectangle', label: '矩形' }
]

const DIRECTIONS: readonly { value: MagneticTile.Direction; label: string }[] = [
  { value: 'horizontal', label: '横向' },
  { value: 'vertical', label: '纵向' }
]

const SIZES: readonly MagneticTile.Size[] = [1, 2, 3, 4]

function buildDefaults(tile: MagneticTile | null): MagneticTileInput {
  return {
    title: tile?.title ?? '',
    url: tile?.url ?? '',
    size: tile?.size ?? 2,
    shape: tile?.shape ?? 'square',
    direction: tile?.direction ?? 'horizontal'
  }
}

/**
 * 新建 / 编辑导航磁贴（shadcn Dialog + Select）。
 *
 * 挂载即打开（由父级按 `key` 重建），表单初值直接在 `useState` 里算，不用 effect 同步。
 */
export function TileDialog(props: TileDialogProps) {
  const [values, updateValues] = useState<MagneticTileInput>(function () {
    return buildDefaults(props.tile)
  })
  const [error, updateError] = useState<string | null>(null)
  const isEditing = Boolean(props.tile)
  const needsUrl = !props.tile || props.tile.component === 'navigation'

  async function handleSubmit(): Promise<void> {
    const title = values.title.trim()
    const url = values.url.trim()

    if (!title) {
      updateError('请填写名称')
      return
    }
    const parsed = url ? parseSiteUrl(url) : null
    if (needsUrl && !parsed) {
      updateError(url ? '请填写 http 或 https 链接' : '请填写链接地址')
      return
    }

    try {
      await props.onSubmit({ ...values, title, url: parsed ?? '' })
      props.onOpenChange(false)
    } catch (error) {
      console.error('[tile] 保存失败', error)
      updateError('保存失败，请重试')
    }
  }

  return (
    <Dialog
      open
      onOpenChange={props.onOpenChange}>
      <DialogContent className={clsx('sm:max-w-md')}>
        <DialogHeader>
          <DialogTitle>{isEditing ? '编辑磁贴' : '添加磁贴'}</DialogTitle>
          <DialogDescription>
            {needsUrl
              ? '双击磁贴会打开链接，墙面留在这个标签页。'
              : '可以改名称和占格，链接留空即可。'}
          </DialogDescription>
        </DialogHeader>

        <div className={clsx('grid gap-4 py-2')}>
          <div className={clsx('grid gap-2')}>
            <Label htmlFor="tile-title">名称</Label>
            <Input
              id="tile-title"
              value={values.title}
              placeholder="GitHub"
              onChange={function (event) {
                updateValues({ ...values, title: event.target.value })
              }}
            />
          </div>

          {needsUrl ? (
            <div className={clsx('grid gap-2')}>
              <Label htmlFor="tile-url">链接</Label>
              <Input
                id="tile-url"
                value={values.url}
                placeholder="https://github.com"
                onChange={function (event) {
                  updateValues({ ...values, url: event.target.value })
                }}
              />
            </div>
          ) : null}

          <div className={clsx('grid grid-cols-3 gap-3')}>
            <div className={clsx('grid gap-2')}>
              <Label>形状</Label>
              <Select
                items={SHAPES}
                value={values.shape}
                onValueChange={function (value) {
                  if (value === null) return
                  updateValues({ ...values, shape: value })
                }}>
                <SelectTrigger aria-label="形状">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SHAPES.map(function (item) {
                    return (
                      <SelectItem
                        key={item.value}
                        value={item.value}>
                        {item.label}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className={clsx('grid gap-2')}>
              <Label>方向</Label>
              <Select
                items={DIRECTIONS}
                value={values.direction}
                onValueChange={function (value) {
                  if (value === null) return
                  updateValues({ ...values, direction: value })
                }}>
                <SelectTrigger aria-label="方向">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DIRECTIONS.map(function (item) {
                    return (
                      <SelectItem
                        key={item.value}
                        value={item.value}>
                        {item.label}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className={clsx('grid gap-2')}>
              <Label>网格跨度</Label>
              <Select
                items={SIZES.map(function (size) {
                  return { value: String(size), label: `${size}×${size}` }
                })}
                value={String(values.size)}
                onValueChange={function (value) {
                  if (value === null) return
                  updateValues({ ...values, size: Number(value) as MagneticTile.Size })
                }}>
                <SelectTrigger aria-label="网格跨度">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SIZES.map(function (size) {
                    return (
                      <SelectItem
                        key={size}
                        value={String(size)}>
                        {size}×{size}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className={clsx('flex items-center gap-3')}>
            <div
              className={clsx(
                'flex size-16 items-center justify-center bg-card text-xs text-card-foreground',
                values.shape === 'circle' ? 'rounded-full' : 'rounded-xl'
              )}>
              {(values.title.trim() || '磁贴').slice(0, 1)}
            </div>
            <p className={clsx('text-sm text-muted-foreground')}>
              预览占 {findGridSpan(values).w}×{findGridSpan(values).h} 格，拖到墙上可改顺序。
            </p>
          </div>

          {error ? <p className={clsx('text-sm text-destructive')}>{error}</p> : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={function () {
              props.onOpenChange(false)
            }}>
            取消
          </Button>
          <Button
            type="button"
            onClick={function () {
              void handleSubmit()
            }}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
