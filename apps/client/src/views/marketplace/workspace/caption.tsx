import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList
} from '@cogito/design/components/combobox'
import { Input } from '@cogito/design/components/input'
import { Separator } from '@cogito/design/components/separator'
import { Tabs, TabsList, TabsTrigger } from '@cogito/design/components/tabs'
import { debounce } from 'lodash-es'
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
import { useMarketplaceHotkeys } from '@/views/marketplace/workspace/hooks/use-marketplace-hotkeys.ts'
import { useMirrorStore } from '@/stores/mirror.ts'

type Meta = {
  label: string
  count: number
  unit: string
}

type MirrorOption = {
  value: string
  label: string
}

const MODES: Array<{ label: string; value: MarketplaceMode }> = [
  { label: '磁贴', value: 'booth' },
  { label: '网址', value: 'navigate' },
  { label: '定制', value: 'customize' }
]

const QUERY_DEBOUNCE_MS = 180

/** 顶栏控件统一高度，对齐 TabsList size=sm（h-8） */
const CONTROL_H = 'h-8'

const MIRROR_COMBO_CLASS =
  'w-[7.5rem] max-w-[32vw] shrink-0 min-[900px]:w-[8.75rem]'

/** 市场窗口顶栏：镜像 · 模式 Tabs · 搜索壳 · 弱元信息 */
function Caption() {
  const {
    mode,
    onUpdateMode,
    boothBucket,
    navigateBucket,
    query,
    onUpdateQuery,
    targetMirrorID,
    onUpdateTargetMirrorID,
    searchInputRef,
    mirrorTriggerRef
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

  useMarketplaceHotkeys()

  useEffect(
    function () {
      if (targetMirrorID || !activeMirrorID) return
      onUpdateTargetMirrorID(activeMirrorID)
    },
    [activeMirrorID, targetMirrorID, onUpdateTargetMirrorID]
  )

  const commitDebounced = useMemo(
    function () {
      return debounce(function (value: string) {
        onUpdateQuery(value)
      }, QUERY_DEBOUNCE_MS)
    },
    [onUpdateQuery]
  )

  useEffect(
    function () {
      return function () {
        commitDebounced.cancel()
      }
    },
    [commitDebounced]
  )

  useEffect(
    function () {
      if (searchDraft === query) return
      commitDebounced(searchDraft)
      return function () {
        commitDebounced.cancel()
      }
    },
    [searchDraft, query, commitDebounced]
  )

  const mirrorOptions = useMemo(
    function () {
      return mirrors.map(function (mirror): MirrorOption {
        return { value: mirror.id, label: mirror.title }
      })
    },
    [mirrors]
  )

  const selectedMirror = useMemo(
    function () {
      if (!targetMirrorID) return null
      return (
        mirrorOptions.find(function (option) {
          return option.value === targetMirrorID
        }) ?? null
      )
    },
    [mirrorOptions, targetMirrorID]
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
    commitDebounced.cancel()
    onUpdateSearchDraft(value)
    onUpdateQuery(value)
  }

  return (
    <div className="flex w-full min-w-0 items-center gap-1.5 ps-1 min-[900px]:gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 min-[900px]:gap-2">
        <Combobox
          items={mirrorOptions}
          value={selectedMirror}
          autoHighlight
          isItemEqualToValue={function (item, value) {
            return item.value === value.value
          }}
          onValueChange={function (next) {
            onUpdateTargetMirrorID(next?.value)
          }}>
          <div
            data-region="false"
            className={MIRROR_COMBO_CLASS}>
            <ComboboxInput
              ref={mirrorTriggerRef}
              size="sm"
              data-region="false"
              placeholder="选择镜像"
              aria-label="选择镜像"
            />
          </div>
          <ComboboxContent
            size="sm"
            align="start">
            <ComboboxEmpty>无匹配镜像</ComboboxEmpty>
            <ComboboxList>
              {function (item: MirrorOption) {
                return (
                  <ComboboxItem
                    key={item.value}
                    value={item}>
                    {item.label}
                  </ComboboxItem>
                )
              }}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>

        <Separator
          orientation="vertical"
          className="hidden h-4 shrink-0 min-[720px]:block"
        />

        <Tabs
          value={mode}
          onValueChange={function (value) {
            if (!value) return
            commitQuery('')
            onUpdateMode(value as MarketplaceMode)
          }}
          className="min-w-0 shrink">
          <TabsList
            size="sm"
            className="gap-0.5">
            {MODES.map(function (item) {
              return (
                <TabsTrigger
                  key={item.value}
                  value={item.value}
                  data-region="false"
                  className="min-w-0 px-2.5 text-xs min-[900px]:min-w-12 min-[900px]:px-3">
                  {item.label}
                </TabsTrigger>
              )
            })}
          </TabsList>
        </Tabs>

        {mode !== 'customize' ? (
          <div className="relative min-w-0 max-w-[20rem] flex-1">
            <Icon
              icon="lucide:search"
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/70"
              aria-hidden
            />
            <Input
              ref={searchInputRef}
              data-region="false"
              value={searchDraft}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className={`${CONTROL_H} rounded-lg border-border/50 bg-muted/40 pr-8 pl-8 text-xs shadow-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:bg-background`}
              onChange={function (event) {
                onUpdateSearchDraft(event.target.value)
              }}
              onKeyDown={function (event) {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commitQuery(searchDraft)
                  return
                }
                if (event.key === 'Escape' && searchDraft) {
                  event.preventDefault()
                  commitQuery('')
                }
              }}
            />
            {searchDraft ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                data-region="false"
                aria-label="清除搜索"
                className="absolute inset-y-0 right-0.5 my-auto size-7 text-muted-foreground hover:text-foreground"
                onClick={function () {
                  commitQuery('')
                }}>
                <Icon
                  icon="lucide:x"
                  className="size-3.5"
                />
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {meta ? (
        <div className="ml-auto hidden min-w-0 shrink-0 items-center gap-1.5 pe-1 text-xs text-muted-foreground tabular-nums min-[1000px]:flex">
          <span className="truncate font-medium text-foreground/75">{meta.label}</span>
          <span
            className="text-muted-foreground/35"
            aria-hidden>
            ·
          </span>
          <span className="whitespace-nowrap">
            {meta.count} {meta.unit}
          </span>
        </div>
      ) : null}
    </div>
  )
}

export { Caption }
