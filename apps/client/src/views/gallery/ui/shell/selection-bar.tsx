import { Button } from '@cogito/design/components/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger
} from '@cogito/design/components/select'
import { Icon } from '@iconify/react'
import { useState } from 'react'

import type { GalleryLabel } from '@/views/gallery/model/asset'
import { LABEL_COLORS } from '@/views/gallery/ui/grid/cell'
import type { AlbumModel } from '@/views/gallery/ui/shell/sidebar'

/**
 * 多选操作条：选择模式下“对 N 张一起做什么”的唯一入口。
 *
 * 为什么单独一条而不是塞进工具条：工具条是「全局设置」（排序/密度/视图），
 * 这里全是「对选区的动作」。两者混在一起时，用户没法从视觉上区分
 * “这个按钮会改我的偏好”还是“会改这 200 张照片”，而且工具条已经放不下。
 */
interface SelectionBarProps {
  count: number
  albums: AlbumModel[]
  /** 当前相簿视图（非相簿时为 null）：用于“移出本相簿” */
  albumID: string | null
  onRate: (rating: number) => void
  onLabel: (label: GalleryLabel) => void
  onReject: () => void
  onAddToAlbum: (albumID: string) => void
  onDetachFromAlbum: () => void
  onRename: () => void
  onTrash: () => void
  onSelectAll: () => void
  onClear: () => void
}

const LABELS: { value: GalleryLabel; text: string }[] = [
  { value: 'red', text: '红 · 待修' },
  { value: 'yellow', text: '黄 · 待确认' },
  { value: 'green', text: '绿 · 已修' },
  { value: 'blue', text: '蓝 · 已交付' },
  { value: 'purple', text: '紫 · 待打印' }
]

function SelectionBar(props: SelectionBarProps) {
  // 选完立刻回到占位态：下次再选同一个相簿也能触发 onValueChange
  const [pendingAlbum, setPendingAlbum] = useState<string | null>(null)

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-primary/5 px-3 py-1.5">
      <span className="mr-1 inline-flex items-center gap-1 text-xs font-medium tabular-nums">
        <Icon icon="lucide:check-check" className="size-3.5 text-primary" />
        已选 {props.count}
      </span>

      {/* 星级：0 = 清除 */}
      <div className="flex items-center gap-0.5" role="group" aria-label="设置星级">
        {[1, 2, 3, 4, 5].map(function (value) {
          return (
            <Button
              key={value}
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground/50 hover:text-amber-500"
              title={`${value}★`}
              aria-label={`${value} 星`}
              onClick={function () {
                props.onRate(value)
              }}
            >
              <Icon icon="lucide:star" className="size-3.5" />
            </Button>
          )
        })}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-[11px]"
          onClick={function () {
            props.onRate(0)
          }}
        >
          清除
        </Button>
      </div>

      <span className="h-4 w-px bg-border" />

      {/* 色彩标签 */}
      <div className="flex items-center gap-1" role="group" aria-label="设置颜色标签">
        {LABELS.map(function (label) {
          return (
            <Button
              key={label.value}
              variant="ghost"
              size="icon"
              title={label.text}
              aria-label={label.text}
              className="size-4 rounded-full p-0 ring-1 ring-border/70 hover:ring-ring"
              style={{ backgroundColor: LABEL_COLORS[label.value] }}
              onClick={function () {
                props.onLabel(label.value)
              }}
            />
          )
        })}
      </div>

      <span className="h-4 w-px bg-border" />

      <Button
        variant="ghost"
        size="sm"
        className="h-6 gap-1 px-1.5 text-xs"
        title="标记为已拒绝（X）"
        onClick={props.onReject}
      >
        <Icon icon="lucide:ban" className="size-3.5" />
        拒绝
      </Button>

      <Select
        size="sm"
        value={pendingAlbum}
        onValueChange={function (value) {
          if (typeof value !== 'string') return
          props.onAddToAlbum(value)
          setPendingAlbum(null)
        }}
      >
        <SelectTrigger className="h-6 w-28 text-xs" aria-label="加入相簿">
          <span className="truncate text-muted-foreground">加入相簿…</span>
        </SelectTrigger>
        <SelectContent>
          {props.albums.length === 0 ? (
            <SelectItem value="__empty" disabled>
              还没有相簿
            </SelectItem>
          ) : (
            props.albums.map(function (album) {
              return (
                <SelectItem key={album.id} value={album.id}>
                  {album.name}
                </SelectItem>
              )
            })
          )}
        </SelectContent>
      </Select>

      <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-xs" onClick={props.onRename}>
        <Icon icon="lucide:text-cursor-input" className="size-3.5" />
        重命名
      </Button>

      {props.albumID ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-1.5 text-xs"
          onClick={props.onDetachFromAlbum}
        >
          <Icon icon="lucide:folder-minus" className="size-3.5" />
          移出相簿
        </Button>
      ) : null}

      <Button
        variant="ghost"
        size="sm"
        className="h-6 gap-1 px-1.5 text-xs text-destructive hover:text-destructive"
        onClick={props.onTrash}
      >
        <Icon icon="lucide:trash-2" className="size-3.5" />
        移入回收站
      </Button>

      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-xs"
          title="全选当前视图（Ctrl/⌘ + A）"
          onClick={props.onSelectAll}
        >
          全选
        </Button>
        <Button variant="secondary" size="sm" className="h-6 gap-1 px-2 text-xs" onClick={props.onClear}>
          <Icon icon="lucide:x" className="size-3.5" />
          完成
        </Button>
      </div>
    </div>
  )
}

export { SelectionBar }
export type { SelectionBarProps }
