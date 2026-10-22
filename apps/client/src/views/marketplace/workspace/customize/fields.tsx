import { Button } from '@i-thinking/design/components/button'
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from '@i-thinking/design/components/form'
import { Input } from '@i-thinking/design/components/input'
import { Skeleton } from '@i-thinking/design/components/skeleton'
import { parseSliderValue, Slider } from '@i-thinking/design/components/slider'
import { Spinner } from '@i-thinking/design/components/spinner'
import { cn } from 'cn'
import type { Control } from 'react-hook-form'

import { TEXT_COLOR, type ColorFieldName } from '@/views/marketplace/workspace/customize/colors.ts'
import { ColorField } from '@/views/marketplace/workspace/customize/color-field'
import {
  BLUR_MAX,
  IMAGE_NONE,
  IMAGE_SWATCH_CLASS,
  PICSUM_LIMIT,
  PICSUM_THUMB_HEIGHT,
  PICSUM_THUMB_WIDTH,
  buildPicsumUrl,
  isUrl,
  type FormValues,
  type PicsumImage
} from '@/views/marketplace/workspace/customize/form'

interface FieldsProps {
  control: Control<FormValues>
  canEditUrl: boolean
  colorShades: string[]
  textShades: string[]
  hues: string[]
  values: Partial<FormValues>
  themePrimary: string
  images: PicsumImage[]
  isImagesLoading: boolean
  submitting: boolean
  isCreateMode: boolean
  onPickColor: (field: ColorFieldName) => (value: string) => void
  onClearKeptImage: () => void
}

function Fields(props: FieldsProps) {
  const {
    control,
    canEditUrl,
    colorShades,
    textShades,
    hues,
    values,
    themePrimary,
    images,
    isImagesLoading,
    submitting,
    isCreateMode,
    onPickColor,
    onClearKeptImage
  } = props

  return (
    <>
      <FormField
        control={control}
        name="title"
        rules={{ required: '标题是必填的!' }}
        render={function ({ field }) {
          return (
            <FormItem>
              <FormLabel>标题</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder="请输入标题"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )
        }}
      />

      <FormField
        control={control}
        name="url"
        rules={
          canEditUrl
            ? {
                validate: {
                  required: function (value: string) {
                    return value.trim().length > 0 || '链接是必填的!'
                  },
                  url: function (value: string) {
                    const trimmed = value.trim()
                    if (!trimmed) return true
                    return isUrl(trimmed) || '链接不是有效链接!'
                  }
                }
              }
            : undefined
        }
        render={function ({ field }) {
          return (
            <FormItem>
              <FormLabel>链接</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  disabled={!canEditUrl}
                  placeholder={canEditUrl ? '请输入链接' : '非网址磁贴无需链接'}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )
        }}
      />

      <ColorField
        name="color"
        label="背景颜色"
        shades={colorShades}
        hues={hues}
        value={values.color}
        fallback={themePrimary}
        onPick={onPickColor('color')}
      />

      <ColorField
        name="textColor"
        label="文字颜色"
        shades={textShades}
        hues={hues}
        value={values.textColor}
        fallback={TEXT_COLOR}
        onPick={onPickColor('textColor')}
      />

      <FormField
        control={control}
        name="backdropBlur"
        render={function ({ field }) {
          return (
            <FormItem>
              <div className="flex items-center justify-between">
                <FormLabel>背景模糊</FormLabel>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {field.value ?? 0}px
                </span>
              </div>
              <FormControl>
                <Slider
                  min={0}
                  max={BLUR_MAX}
                  value={field.value ?? 0}
                  aria-label="背景模糊"
                  onValueChange={function (next) {
                    field.onChange(parseSliderValue(next))
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )
        }}
      />

      <FormField
        control={control}
        name="backdropOpacity"
        render={function ({ field }) {
          return (
            <FormItem>
              <div className="flex items-center justify-between">
                <FormLabel>背景透明</FormLabel>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {Math.round((field.value ?? 0) * 100)}%
                </span>
              </div>
              <FormControl>
                <Slider
                  min={0}
                  max={1}
                  step={0.05}
                  value={field.value ?? 0}
                  aria-label="背景透明"
                  onValueChange={function (next) {
                    field.onChange(parseSliderValue(next))
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )
        }}
      />

      <FormField
        control={control}
        name="image"
        render={function ({ field }) {
          return (
            <FormItem>
              <FormLabel>背景图片</FormLabel>
              <div
                role="radiogroup"
                aria-label="背景图片"
                className="flex items-center gap-2 overflow-x-auto pb-1">
                <button
                  type="button"
                  role="radio"
                  aria-checked={field.value === IMAGE_NONE}
                  aria-label="清空背景图"
                  className={cn(
                    IMAGE_SWATCH_CLASS,
                    'grid shrink-0 cursor-pointer place-items-center rounded-lg border-2 border-dashed text-sm font-medium text-muted-foreground transition-colors',
                    field.value === IMAGE_NONE
                      ? 'border-primary text-primary'
                      : 'border-border'
                  )}
                  onClick={function () {
                    onClearKeptImage()
                    field.onChange(IMAGE_NONE)
                  }}>
                  无
                </button>
                {isImagesLoading
                  ? Array.from({ length: PICSUM_LIMIT }).map(function (_, index) {
                      return (
                        <Skeleton
                          key={index}
                          className={cn(IMAGE_SWATCH_CLASS, 'shrink-0 rounded-lg')}
                        />
                      )
                    })
                  : images.map(function (image) {
                      const thumbUrl = buildPicsumUrl(
                        image,
                        PICSUM_THUMB_WIDTH,
                        PICSUM_THUMB_HEIGHT
                      )
                      const isSelected = field.value === image.id

                      return (
                        <button
                          key={image.id}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          aria-label={`背景图片 ${image.id}`}
                          className={cn(
                            IMAGE_SWATCH_CLASS,
                            'shrink-0 cursor-pointer overflow-hidden rounded-lg border-2 transition-colors',
                            isSelected ? 'border-primary' : 'border-border'
                          )}
                          onClick={function () {
                            onClearKeptImage()
                            field.onChange(image.id)
                          }}>
                          <img
                            src={thumbUrl}
                            alt=""
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        </button>
                      )
                    })}
              </div>
              <FormMessage />
            </FormItem>
          )
        }}
      />

      <div className="flex justify-end">
        <Button
          type="submit"
          aria-busy={submitting}
          disabled={submitting}>
          {submitting ? <Spinner /> : null}
          {isCreateMode ? '添加' : '保存'}
        </Button>
      </div>
    </>
  )
}

export type { FieldsProps }
export { Fields }
