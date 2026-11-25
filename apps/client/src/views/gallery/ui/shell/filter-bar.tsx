import { Button } from '@cogito/design/components/button'
import { Toggle } from '@cogito/design/components/toggle'
import { Icon } from '@iconify/react'

import type { GalleryFacets } from '@/views/gallery/model/asset'
import type { GalleryFilterState } from '@/views/gallery/model/filter'
import { toggleIn } from '@/views/gallery/model/filter'
import type { GalleryKind, GalleryLabel } from '@/views/gallery/model/asset'

/**
 * 筛选条：生效条件的 chip 常驻内容区顶部，点一下就取消。
 *
 * 计数直接来自 `gallery:facets`（Rust 侧聚合），而不是前端重算 ——
 * 保证「chip 上的数字」与「点下去看到的结果」是同一份真相。
 */
interface FilterBarProps {
  facets: GalleryFacets | null
  filter: GalleryFilterState
  visibleCount: number
  onPatch: (patch: Partial<GalleryFilterState>) => void
  onReset: () => void
  onSaveSmart: () => void
}

const LABEL_TEXT: Record<GalleryLabel, string> = {
  red: '红 · 待修',
  yellow: '黄 · 待确认',
  green: '绿 · 已修',
  blue: '蓝 · 已交付',
  purple: '紫 · 待打印'
}

const KIND_TEXT: Record<GalleryKind, string> = {
  image: '照片',
  video: '视频',
  other: '其他'
}

function Chip(props: { active: boolean; label: string; count?: number; onClick: () => void }) {
  return (
    <Toggle
      pressed={props.active}
      onPressedChange={function () {
        props.onClick()
      }}
      variant="outline"
      size="sm"
      className="h-6 min-w-0 gap-1 rounded-full px-2 text-xs font-normal"
    >
      {props.label}
      {props.count !== undefined ? (
        <span className="tabular-nums opacity-70">{props.count}</span>
      ) : null}
    </Toggle>
  )
}

function FilterBar(props: FilterBarProps) {
  const facets = props.facets
  const filter = props.filter
  const ratingCounts = new Map<string, number>(
    (facets?.ratings ?? []).map(function (row) {
      return [row.value, row.count]
    })
  )
  const labelCounts = new Map<string, number>(
    (facets?.labels ?? []).map(function (row) {
      return [row.value, row.count]
    })
  )
  const kindCounts = new Map<string, number>(
    (facets?.kinds ?? []).map(function (row) {
      return [row.value, row.count]
    })
  )
  const keywordChips = (facets?.keywords ?? []).slice(0, 6)
  const keywordSet = new Set(filter.keywords)

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-background/60 px-3 py-1.5">
      <span className="mr-1 text-xs text-muted-foreground">
        {props.visibleCount} / {facets?.total ?? props.visibleCount}
      </span>

      {[5, 4, 3, 2, 1].map(function (value) {
        return (
          <Chip
            key={`rating-${value}`}
            active={filter.ratings.includes(value)}
            label={`${value}★`}
            count={ratingCounts.get(String(value)) ?? 0}
            onClick={function () {
              props.onPatch({ ratings: toggleIn(filter.ratings, value) })
            }}
          />
        )
      })}
      <Chip
        active={filter.ratings.includes(0)}
        label="未评"
        count={ratingCounts.get('0') ?? 0}
        onClick={function () {
          props.onPatch({ ratings: toggleIn(filter.ratings, 0) })
        }}
      />

      <span className="mx-1 h-4 w-px bg-border" />

      {(['red', 'yellow', 'green', 'blue'] as GalleryLabel[]).map(function (label) {
        return (
          <Chip
            key={label}
            active={filter.labels.includes(label)}
            label={LABEL_TEXT[label]}
            count={labelCounts.get(label) ?? 0}
            onClick={function () {
              props.onPatch({ labels: toggleIn(filter.labels, label) })
            }}
          />
        )
      })}

      <span className="mx-1 h-4 w-px bg-border" />

      {(['image', 'video'] as GalleryKind[]).map(function (kind) {
        return (
          <Chip
            key={kind}
            active={filter.kinds.includes(kind)}
            label={KIND_TEXT[kind]}
            count={kindCounts.get(kind) ?? 0}
            onClick={function () {
              props.onPatch({ kinds: toggleIn(filter.kinds, kind) })
            }}
          />
        )
      })}

      <Chip
        active={filter.flags.includes('rejected')}
        label="已拒绝"
        onClick={function () {
          props.onPatch({ flags: toggleIn(filter.flags, 'rejected') })
        }}
      />

      {/* 这两个开关是「能不能看到被藏起来/丢了的东西」的唯一入口：
          没有它们，隐藏视图只能进不能出、失效项也没法单独筛选。 */}
      <Chip
        active={filter.onlyMissing}
        label="仅失效"
        onClick={function () {
          props.onPatch({ onlyMissing: !filter.onlyMissing })
        }}
      />
      <Chip
        active={filter.includeHidden}
        label="含隐藏"
        onClick={function () {
          props.onPatch({ includeHidden: !filter.includeHidden })
        }}
      />

      {keywordChips.map(function (chip) {
        const [facet, value] = chip.value.split(':')
        return (
          <Chip
            key={chip.value}
            active={keywordSet.has(chip.value)}
            label={`${facet === 'people' ? '人' : facet === 'places' ? '地' : '题材'} · ${value ?? ''}`}
            count={chip.count}
            onClick={function () {
              props.onPatch({ keywords: toggleIn(filter.keywords, chip.value) })
            }}
          />
        )
      })}

      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-1.5 text-xs"
          onClick={props.onSaveSmart}
        >
          <Icon icon="lucide:bookmark-plus" className="size-3.5" />
          保存为智能相簿
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-1.5 text-xs"
          onClick={props.onReset}
        >
          <Icon icon="lucide:filter-x" className="size-3.5" />
          清除
        </Button>
      </div>
    </div>
  )
}

export { FilterBar }
export type { FilterBarProps }
