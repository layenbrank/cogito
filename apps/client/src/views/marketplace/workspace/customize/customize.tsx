import { Card } from '@cogito/design/components/card'
import { Form } from '@cogito/design/components/form'
import { Label } from '@cogito/design/components/label'
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

import { parsePresetHues } from '@/features/capture/components/colors'
import { readAppearance } from '@/features/window/appearance'
import { useMirrorStore, type MagneticTileUpdate } from '@/stores/mirror.ts'
import { MarketplaceContext } from '@/views/marketplace/workspace/context.tsx'
import {
  findShade,
  parseFieldShades,
  TEXT_COLOR,
  TEXT_SEED,
  type ColorFieldName
} from '@/views/marketplace/workspace/customize/colors.ts'
import {
  CREATE_KEY,
  buildCreateValues,
  findFormSchema,
  parseFormChange,
  parseFormWrite,
  parseTileOptions,
  parseTileToForm,
  tileOptionKey,
  type FormValues,
  type PicsumImage
} from '@/views/marketplace/workspace/customize/form'
import { Fields } from '@/views/marketplace/workspace/customize/fields'
import {
  picsumImagesReady,
  readPicsumImages,
  subscribePicsumImages
} from '@/views/marketplace/workspace/customize/picsum'
import { Preview } from '@/views/marketplace/workspace/customize/preview'

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
  const [selectedKey, updateSelectedKey] = useState(CREATE_KEY)
  const [keptImageUrl, updateKeptImageUrl] = useState<string | null>(null)
  const [colorShades, updateColorShades] = useState(function () {
    return parseFieldShades('color', themePrimary)
  })
  const [textShades, updateTextShades] = useState(function () {
    return parseFieldShades('textColor', TEXT_SEED)
  })
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
    defaultValues: buildCreateValues(colorShades, textShades, themePrimary)
  })
  const watched = useWatch({ control: form.control })
  const values = watched ?? form.getValues()

  useEffect(
    function () {
      form.clearErrors()
    },
    [canEditUrl, form]
  )

  const hues = useMemo(
    function () {
      return parsePresetHues(themePrimary)
    },
    [themePrimary]
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

  function syncPalette(field: ColorFieldName, primary: string) {
    const shades = parseFieldShades(field, primary)
    if (field === 'color') updateColorShades(shades)
    else updateTextShades(shades)
    form.setValue(field, findShade(shades, primary))
  }

  function resetCreate() {
    const nextColorShades = parseFieldShades('color', themePrimary)
    const nextTextShades = parseFieldShades('textColor', TEXT_SEED)
    updateColorShades(nextColorShades)
    updateTextShades(nextTextShades)
    updateKeptImageUrl(null)
    form.reset(buildCreateValues(nextColorShades, nextTextShades, themePrimary))
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
    const bgPrimary = parsed.values.color || themePrimary
    const textPrimary = parsed.values.textColor || TEXT_COLOR
    const nextColorShades = parseFieldShades('color', bgPrimary)
    const nextTextShades = parseFieldShades('textColor', textPrimary)

    updateKeptImageUrl(parsed.keptImageUrl)
    updateColorShades(nextColorShades)
    updateTextShades(nextTextShades)
    form.reset({
      ...parsed.values,
      color: findShade(nextColorShades, bgPrimary),
      textColor: findShade(nextTextShades, textPrimary)
    })
  }

  function onPickColor(field: ColorFieldName) {
    return function (value: string) {
      syncPalette(field, value)
    }
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
        const write = parseFormWrite(
          value,
          images,
          mirrorID,
          magneticTiles.length,
          keptImageUrl
        )
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
    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3 min-[900px]:flex-row min-[900px]:p-4">
        <div className="w-full shrink-0 min-[900px]:max-w-[28rem]">
          <Card className="gap-4 border-0 bg-card py-4 shadow-sm">
            <div className="flex flex-col gap-4 px-6">
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
                                  {item.description ? (
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

              <Form {...form}>
                <form
                  noValidate
                  className="flex flex-col gap-4"
                  onSubmit={form.handleSubmit(handleFinish)}>
                  <Fields
                    control={form.control}
                    canEditUrl={canEditUrl}
                    colorShades={colorShades}
                    textShades={textShades}
                    hues={hues}
                    values={values}
                    themePrimary={themePrimary}
                    images={images}
                    isImagesLoading={isImagesLoading}
                    submitting={submitting}
                    isCreateMode={isCreateMode}
                    onPickColor={onPickColor}
                    onClearKeptImage={function () {
                      updateKeptImageUrl(null)
                    }}
                  />
                </form>
              </Form>
            </div>
          </Card>
        </div>

        <div className="min-w-0 flex-1 self-stretch min-[900px]:sticky min-[900px]:top-3 min-[900px]:self-start">
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
