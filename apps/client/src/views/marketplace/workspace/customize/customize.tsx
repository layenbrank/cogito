import { Button } from '@cogito/design/components/button'
import { Card } from '@cogito/design/components/card'
import { Form } from '@cogito/design/components/form'
import { Label } from '@cogito/design/components/label'
import { Spinner } from '@cogito/design/components/spinner'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { zodResolver } from '@hookform/resolvers/zod'
import { useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'

import { readAppearance } from '@/features/window/appearance'
import { fetchSiteFavicon } from '@/lib/site-favicon.ts'
import { useMirrorStore, type MagneticTileUpdate } from '@/stores/mirror.ts'
import { MarketplaceContext } from '@/views/marketplace/workspace/context.tsx'
import { Fields } from '@/views/marketplace/workspace/customize/fields'
import {
  CREATE_KEY,
  buildCreateValues,
  findFormSchema,
  isUrl,
  parseFormChange,
  parseFormWrite,
  parseTileOptions,
  parseTileToForm,
  tileOptionKey,
  type FormValues,
  type PicsumImage
} from '@/views/marketplace/workspace/customize/form'
import {
  picsumImagesReady,
  readPicsumImages,
  subscribePicsumImages
} from '@/views/marketplace/workspace/customize/picsum'
import { Preview } from '@/views/marketplace/workspace/customize/preview'

const FAVICON_DEBOUNCE_MS = 450

function Customize() {
  const marketplace = useContext(MarketplaceContext)
  const { targetMirrorID } = marketplace
  const themePrimary = useMemo(function () {
    return readAppearance().color
  }, [])
  const { mirrors, magneticTiles, toInsertMagneticTile, toUpdateMagneticTile } = useMirrorStore(
    useShallow(function (state) {
      return {
        mirrors: state.mirrors,
        magneticTiles: state.magneticTiles,
        toInsertMagneticTile: state.toInsertMagneticTile,
        toUpdateMagneticTile: state.toUpdateMagneticTile
      }
    })
  )
  const [submitting, updateSubmitting] = useState(false)
  const [isFaviconLoading, updateFaviconLoading] = useState(false)
  const [selectedKey, updateSelectedKey] = useState(CREATE_KEY)
  const [keptImageUrl, updateKeptImageUrl] = useState<string | null>(null)
  const faviconRequestRef = useRef(0)
  const images = useSyncExternalStore(
    subscribePicsumImages,
    readPicsumImages,
    readPicsumImages
  ) as PicsumImage[]
  const isImagesLoading = !picsumImagesReady()

  const tiles = useMemo(
    function () {
      return [...magneticTiles].sort(function (a, b) {
        return a.index - b.index
      })
    },
    [magneticTiles]
  )

  const isCreateMode = selectedKey === CREATE_KEY
  const selectedTile = isCreateMode
    ? null
    : (tiles.find(function (tile) {
        return tile.id === selectedKey
      }) ?? null)
  const component = selectedTile?.component ?? 'navigation'
  const canEditUrl = isCreateMode || component === 'navigation'

  const canEditUrlRef = useRef(canEditUrl)
  useEffect(
    function () {
      canEditUrlRef.current = canEditUrl
    },
    [canEditUrl]
  )

  const form = useForm<FormValues>({
    resolver: function (values, context, options) {
      return zodResolver(findFormSchema(canEditUrlRef.current))(values, context, options)
    },
    defaultValues: buildCreateValues(themePrimary)
  })
  const watched = useWatch({ control: form.control })
  const values = watched ?? form.getValues()

  useEffect(
    function () {
      form.clearErrors()
    },
    [canEditUrl, form]
  )

  const watchedUrl = values.url ?? ''

  useEffect(
    function () {
      if (!canEditUrl) return
      const trimmed = watchedUrl.trim()
      if (!trimmed || !isUrl(trimmed)) return

      const requestId = faviconRequestRef.current + 1
      faviconRequestRef.current = requestId
      const timer = window.setTimeout(function () {
        updateFaviconLoading(true)
        void fetchSiteFavicon(trimmed)
          .then(function (favicon) {
            if (faviconRequestRef.current !== requestId) return
            if (favicon) form.setValue('mark', favicon, { shouldDirty: true })
          })
          .catch(function (error) {
            console.warn('[Customize] favicon 解析失败:', error)
          })
          .finally(function () {
            if (faviconRequestRef.current === requestId) {
              updateFaviconLoading(false)
            }
          })
      }, FAVICON_DEBOUNCE_MS)

      return function () {
        window.clearTimeout(timer)
      }
    },
    [canEditUrl, watchedUrl, form]
  )

  const tileOptions = useMemo(
    function () {
      return parseTileOptions(tiles)
    },
    [tiles]
  )

  const targetMirror = useMemo(
    function () {
      if (!targetMirrorID) return undefined
      return mirrors.find(function (mirror) {
        return mirror.id === targetMirrorID
      })
    },
    [mirrors, targetMirrorID]
  )

  function resetCreate() {
    updateKeptImageUrl(null)
    form.reset(buildCreateValues(themePrimary))
  }

  function onSelectTile(key: string) {
    updateSelectedKey(key)

    if (key === CREATE_KEY) {
      resetCreate()
      return
    }

    const tile = tiles.find(function (item) {
      return item.id === key
    })
    if (!tile) return

    const parsed = parseTileToForm(tile, images, themePrimary)
    updateKeptImageUrl(parsed.keptImageUrl)
    form.reset(parsed.values)
  }

  async function handleFinish(value: FormValues) {
    const mirrorID = targetMirrorID
    if (!mirrorID) {
      toast.error('请先选择镜像')
      marketplace.focusMirrorSelect()
      return
    }

    updateSubmitting(true)
    try {
      if (isCreateMode) {
        const write = parseFormWrite(value, images, mirrorID, magneticTiles.length, keptImageUrl)
        await toInsertMagneticTile([write])
        toast.success('添加成功')
        resetCreate()
      } else {
        if (!selectedTile) {
          toast.error('未找到要编辑的磁贴')
          return
        }
        const change = parseFormChange(value, images, keptImageUrl, canEditUrl)
        const update: MagneticTileUpdate = {
          key: selectedKey,
          change
        }
        await toUpdateMagneticTile([update])
        toast.success('保存成功')
      }
    } catch (error) {
      console.error('[Customize] magnetic-tile save failed:', error)
      toast.error(error instanceof Error ? error.message : isCreateMode ? '添加失败' : '保存失败')
    } finally {
      updateSubmitting(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-1 overflow-hidden p-3 min-[900px]:p-4">
      <div className="flex min-h-0 w-full flex-1 flex-col gap-3 min-[900px]:flex-row min-[900px]:gap-4">
        <Card className="flex w-full shrink-0 flex-col gap-0 overflow-hidden border-0 bg-card py-0 shadow-sm max-[899px]:h-[54%] min-[900px]:h-full min-[900px]:w-[23rem]">
          <Form {...form}>
            <form
              noValidate
              className="flex min-h-0 flex-1 flex-col"
              onSubmit={form.handleSubmit(handleFinish)}>
              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-y-contain px-4 py-4">
              {targetMirror ? (
                <p className="text-xs text-muted-foreground">
                  写入：
                  <span className="font-medium text-foreground/80">{targetMirror.title}</span>
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">请先在顶栏选择镜像</p>
              )}

              <div className="grid gap-2">
                <Label htmlFor="customize-tile">磁贴</Label>
                <Select
                  items={tileOptions.flatMap(function (option) {
                    return 'options' in option ? option.options : [option]
                  })}
                  value={selectedKey}
                  onValueChange={function (value) {
                    if (value === null) return
                    onSelectTile(value)
                  }}>
                  <SelectTrigger
                    id="customize-tile"
                    className="w-full">
                    <SelectValue placeholder="选择要编辑的磁贴" />
                  </SelectTrigger>
                  <SelectContent>
                    {tileOptions.map(function (option) {
                      if (!('options' in option)) {
                        return (
                          <SelectItem
                            key={option.value}
                            value={option.value}>
                            {option.label}
                          </SelectItem>
                        )
                      }
                      return (
                        <SelectGroup key={tileOptionKey(option)}>
                          <SelectLabel>{option.label}</SelectLabel>
                          {option.options.map(function (item) {
                            return (
                              <SelectItem
                                key={item.value}
                                value={item.value}>
                                <span className="flex min-w-0 flex-col">
                                  <span className="truncate">{item.label}</span>
                                  {item.description && item.description !== item.label ? (
                                    <span className="truncate text-xs text-muted-foreground">
                                      {item.description}
                                    </span>
                                  ) : null}
                                </span>
                              </SelectItem>
                            )
                          })}
                        </SelectGroup>
                      )
                    })}
                  </SelectContent>
                </Select>
              </div>

                <Fields
                  control={form.control}
                  canEditUrl={canEditUrl}
                  themePrimary={themePrimary}
                  images={images}
                  isImagesLoading={isImagesLoading}
                  isFaviconLoading={isFaviconLoading}
                  onClearKeptImage={function () {
                    updateKeptImageUrl(null)
                  }}
                />
              </div>
              <div className="flex shrink-0 justify-end border-t border-border px-4 py-3">
                <Button
                  type="submit"
                  aria-busy={submitting}
                  disabled={submitting}>
                  {submitting ? <Spinner /> : null}
                  {isCreateMode ? '添加' : '保存'}
                </Button>
              </div>
            </form>
          </Form>
        </Card>

        <div className="flex min-h-0 min-w-0 flex-1">
          <Preview
            watched={values}
            images={images}
            fallbackColor={themePrimary}
            keptImageUrl={keptImageUrl}
            component={component}
          />
        </div>
      </div>
    </div>
  )
}

export default Customize
