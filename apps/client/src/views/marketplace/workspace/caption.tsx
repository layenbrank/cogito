import { Icon } from '@iconify/react/offline'
import { Input } from '@cogito/design/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { Separator } from '@cogito/design/components/separator'
import { ToggleGroup, ToggleGroupItem } from '@cogito/design/components/toggle-group'
import { useContext, useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'

import {
  findBoothBucketLabel,
  findNavigateBucketLabel
} from '@/constants/marketplace/buckets'
import {
  MarketplaceContext,
  type MarketplaceMode
} from '@/views/marketplace/workspace/context.tsx'
import {
  findBoothTiles,
  findNavigateTiles
} from '@/views/marketplace/workspace/lib/tiles.ts'
import { useMirrorStore } from '@/stores/mirror.ts'

type Meta = {
  label: string
  count: number
  unit: string
}

const MODES: Array<{ label: string; value: MarketplaceMode }> = [
  { label: '磁贴', value: 'booth' },
  { label: '网址', value: 'navigate' },
  { label: '定制', value: 'customize' }
]

const QUERY_DEBOUNCE_MS = 200

function matchMirrorTitle(title: string, needle: string) {
  return title.toLowerCase().includes(needle.trim().toLowerCase())
}

/** 市场窗口顶栏主区域：镜像 · 模式 · 搜索 · 元信息 */
function Caption() {
  const {
    mode,
    onUpdateMode,
    boothBucket,
    navigateBucket,
    query,
    onUpdateQuery,
    targetMirrorID,
    onUpdateTargetMirrorID
  } = useContext(MarketplaceContext)
  const { mirrors, activeMirrorID, magneticTiles } = useMirrorStore(
    useShallow(function (state) {
      return {
        mirrors: state.mirrors,
        activeMirrorID: state.active.mirror?.id,
        magneticTiles: state.magneticTiles
      }
    })
  )
  const [searchDraft, onUpdateSearchDraft] = useState(query)
  const [mirrorQuery, onUpdateMirrorQuery] = useState('')
  const [querySnapshot, onUpdateQuerySnapshot] = useState(query)
  if (query !== querySnapshot) {
    onUpdateQuerySnapshot(query)
    onUpdateSearchDraft(query)
  }

  useEffect(
    function () {
      if (targetMirrorID || !activeMirrorID) return
      onUpdateTargetMirrorID(activeMirrorID)
    },
    [activeMirrorID, targetMirrorID, onUpdateTargetMirrorID]
  )

  useEffect(
    function () {
      if (searchDraft === query) return
      const timer = window.setTimeout(function () {
        onUpdateQuery(searchDraft)
      }, QUERY_DEBOUNCE_MS)
      return function () {
        window.clearTimeout(timer)
      }
    },
    [searchDraft, query, onUpdateQuery]
  )

  const mirrorOptions = useMemo(
    function () {
      return mirrors.map(function (mirror) {
        return { value: mirror.id, label: mirror.title }
      })
    },
    [mirrors]
  )

  const visibleMirrors = useMemo(
    function () {
      const needle = mirrorQuery.trim()
      if (!needle) return mirrorOptions
      return mirrorOptions.filter(function (option) {
        return matchMirrorTitle(option.label, needle)
      })
    },
    [mirrorOptions, mirrorQuery]
  )

  const meta = useMemo(function (): Meta | null {
    if (mode === 'booth') {
      return {
        label: findBoothBucketLabel(boothBucket),
        count: findBoothTiles(magneticTiles, boothBucket, query).length,
        unit: '磁贴'
      }
    }
    if (mode === 'navigate') {
      return {
        label: findNavigateBucketLabel(navigateBucket),
        count: findNavigateTiles(magneticTiles, navigateBucket, query).length,
        unit: '网址'
      }
    }
    return null
  }, [mode, boothBucket, navigateBucket, magneticTiles, query])

  const searchPlaceholder = mode === 'navigate' ? '搜索网址' : '搜索磁贴'

  function commitQuery(value: string) {
    onUpdateSearchDraft(value)
    onUpdateQuery(value)
  }

  return (
    <div className="flex w-full min-w-0 items-center gap-3 ps-2">
      <div className="flex min-w-0 shrink-0 items-center gap-1.5">
        <Select
          items={mirrorOptions}
          value={targetMirrorID ?? null}
          onOpenChange={function (open) {
            if (!open) onUpdateMirrorQuery('')
          }}
          onValueChange={function (value) {
            if (value === null) return
            onUpdateTargetMirrorID(value)
          }}>
          <SelectTrigger
            size="sm"
            aria-label="选择镜像"
            className="h-6 w-[132px] max-w-[40vw] shrink-0 px-1.5 text-xs font-medium">
            <SelectValue placeholder="选择镜像" />
          </SelectTrigger>
          <SelectContent>
            <div
              className="px-1 pb-1"
              onKeyDown={function (event) {
                event.stopPropagation()
              }}>
              <Input
                value={mirrorQuery}
                placeholder="搜索镜像"
                aria-label="搜索镜像"
                className="h-6 text-xs"
                onChange={function (event) {
                  onUpdateMirrorQuery(event.target.value)
                }}
              />
            </div>
            {visibleMirrors.map(function (option) {
              return (
                <SelectItem
                  key={option.value}
                  value={option.value}>
                  {option.label}
                </SelectItem>
              )
            })}
            {visibleMirrors.length === 0 ? (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">无匹配镜像</div>
            ) : null}
          </SelectContent>
        </Select>

        <Separator
          orientation="vertical"
          className="h-3.5"
        />

        <ToggleGroup
          size="sm"
          spacing={0}
          value={[mode]}
          className="bg-foreground/4 p-0.5"
          onValueChange={function (next) {
            const value = next[0] as MarketplaceMode | undefined
            if (!value) return
            commitQuery('')
            onUpdateMode(value)
          }}>
          {MODES.map(function (item) {
            return (
              <ToggleGroupItem
                key={item.value}
                value={item.value}
                className="h-5 min-h-5 px-3 text-xs font-medium shadow-none data-[pressed]:shadow-sm">
                {item.label}
              </ToggleGroupItem>
            )
          })}
        </ToggleGroup>

        {mode !== 'customize' ? (
          <div className="relative w-[180px] max-w-[28vw] min-w-[120px] shrink">
            <Input
              value={searchDraft}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="h-6 pr-7 text-xs"
              onChange={function (event) {
                onUpdateSearchDraft(event.target.value)
              }}
              onKeyDown={function (event) {
                if (event.key !== 'Enter') return
                event.preventDefault()
                commitQuery(searchDraft)
              }}
            />
            {searchDraft ? (
              <button
                type="button"
                aria-label="清除搜索"
                className="absolute inset-y-0 right-1 inline-flex items-center text-muted-foreground hover:text-foreground"
                onClick={function () {
                  commitQuery('')
                }}>
                <Icon
                  icon="lucide:x"
                  className="size-3"
                />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {meta ? (
        <div className="ml-auto flex min-w-0 items-center gap-1.5 px-1 text-xs leading-[18px] whitespace-nowrap text-muted-foreground tabular-nums">
          <span className="font-medium text-foreground/80">{meta.label}</span>
          <span className="text-muted-foreground/40">·</span>
          <span>
            共 {meta.count} 个{meta.unit}
          </span>
        </div>
      ) : null}
    </div>
  )
}

export { Caption }
