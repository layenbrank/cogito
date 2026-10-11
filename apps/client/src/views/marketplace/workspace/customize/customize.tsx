import { Card } from '@i-thinking/design/components/card'
import { Form } from '@i-thinking/design/components/form'
import { Label } from '@i-thinking/design/components/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '@i-thinking/design/components/select'
import { useMemo, useState, useSyncExternalStore } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'

import { parsePresetHues } from '@/features/capture/components/colors'
import { readAppearance } from '@/features/window/appearance'
import { useMirrorStore, type MagneticTileUpdate } from '@/stores/mirror.ts'
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
  const themePrimary = useMemo(function () {
    return readAppearance().color
  }, [])
  const mirror = useMirrorStore((state) => state.active.mirror)
  const magneticTiles = useMirrorStore((state) => state.magneticTiles)
  const toInsertMagneticTile = useMirrorStore((state) => state.toInsertMagneticTile)
  const toUpdateMagneticTile = useMirrorStore((state) => state.toUpdateMagneticTile)
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

  const form = useForm<FormValues>({
    defaultValues: buildCreateValues(colorShades, textShades, themePrimary)
  })
  const watched = useWatch({ control: form.control })
  const values = watched ?? form.getValues()

  const hues = useMemo(
    function () {
      return parsePresetHues(themePrimary)
    },
    [themePrimary]
  )

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

  const tileOptions = useMemo(
    function () {
      return parseTileOptions(tiles)
    },
    [tiles]
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
    const mirrorID = mirror?.id
    if (!mirrorID) {
      toast.error('请先选择镜像')
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
      <div className="flex min-h-0 flex-1 gap-4 p-3 max-md:flex-col">
        <div className="h-full w-120 shrink-0 overflow-y-auto max-md:w-full">
          <Card className="min-h-full gap-4 py-4">
            <div className="flex flex-col gap-4 px-6">
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

        <Preview
          watched={values}
          images={images}
          fallbackColor={themePrimary}
          keptImageUrl={keptImageUrl}
          component={component}
        />
      </div>
    </div>
  )
}

export default Customize
