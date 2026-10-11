import { Input } from '@i-thinking/design/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@i-thinking/design/components/select'
import { Separator } from '@i-thinking/design/components/separator'
import { ToggleGroup, ToggleGroupItem } from '@i-thinking/design/components/toggle-group'
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

  return (
    <div className="flex w-full min-w-0 items-center gap-3">
      <div className="flex min-w-0 shrink-0 items-center gap-1.5">
        <Select
          items={mirrorOptions}
          value={targetMirrorID ?? null}
          onValueChange={function (value) {
            if (value === null) return
            onUpdateTargetMirrorID(value)
          }}>
          <SelectTrigger
            size="sm"
            aria-label="选择镜像"
            className="w-33 max-w-[40vw] shrink-0">
            <SelectValue placeholder="选择镜像" />
          </SelectTrigger>
          <SelectContent>
            {mirrorOptions.map(function (option) {
              return (
                <SelectItem
                  key={option.value}
                  value={option.value}>
                  {option.label}
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>

        <Separator
          orientation="vertical"
          className="h-4"
        />

        <ToggleGroup
          size="sm"
          value={[mode]}
          onValueChange={function (next) {
            const value = next[0] as MarketplaceMode | undefined
            if (!value) return
            onUpdateSearchDraft('')
            onUpdateQuery('')
            onUpdateMode(value)
          }}>
          {MODES.map(function (item) {
            return (
              <ToggleGroupItem
                key={item.value}
                value={item.value}>
                {item.label}
              </ToggleGroupItem>
            )
          })}
        </ToggleGroup>

        {mode !== 'customize' ? (
          <Input
            value={searchDraft}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="h-8 w-45 min-w-30 max-w-[28vw] shrink text-xs"
            onChange={function (event) {
              onUpdateSearchDraft(event.target.value)
            }}
          />
        ) : null}
      </div>

      {meta ? (
        <div className="ml-auto flex min-w-0 items-center gap-1.5 px-1 text-xs whitespace-nowrap tabular-nums text-muted-foreground">
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
