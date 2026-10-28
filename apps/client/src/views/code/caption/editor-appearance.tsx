/**
 * 代码窗标题栏的编辑器外观设置。
 *
 * 放在窗内而不是设置窗：`tiles.json` 由 code 窗的 store 独占写入，
 * 跨窗改写会被下一次写回覆盖，就地改最省事也最直观。
 */
import { Icon } from '@iconify/react/offline'
import { Input } from '@cogito/design/components/input'
import { Popover, PopoverContent, PopoverTrigger } from '@cogito/design/components/popover'
import { Switch } from '@cogito/design/components/switch'
import { ToggleGroup, ToggleGroupItem } from '@cogito/design/components/toggle-group'
import type { ReactNode } from 'react'

import { useCodeStore } from '@/stores/code'

const FONT_SIZES = [12, 13, 14, 16]

const LINE_HEIGHTS: { label: string; value: number }[] = [
  { label: '紧凑', value: 1.35 },
  { label: '标准', value: 1.55 },
  { label: '宽松', value: 1.75 }
]

const TOGGLE_ITEM =
  'cursor-pointer px-2.5 text-xs data-[pressed]:bg-primary/10 data-[pressed]:text-primary'

/** 手改过倍数时不需要精确等于预设，取最接近的一项高亮即可 */
function findLineHeightPreset(ratio: number): string {
  let closest = LINE_HEIGHTS[0]
  for (const preset of LINE_HEIGHTS) {
    if (Math.abs(preset.value - ratio) < Math.abs(closest.value - ratio)) closest = preset
  }
  return String(closest.value)
}

function Row(props: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground text-xs">{props.label}</span>
      {props.children}
    </div>
  )
}

function EditorAppearance() {
  const editorPrefs = useCodeStore(function (state) {
    return state.editorPrefs
  })
  const toSetEditorPrefs = useCodeStore(function (state) {
    return state.toSetEditorPrefs
  })

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            data-region="false"
            aria-label="编辑器外观"
            title="编辑器外观"
            className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-7 items-center justify-center rounded-md border-0">
            <Icon
              icon="lucide:settings-2"
              className="size-4"
            />
          </button>
        }
      />
      <PopoverContent
        align="end"
        className="w-64 space-y-3 p-3">
        <Row label="字号">
          <ToggleGroup
            variant="outline"
            spacing={0}
            value={[String(editorPrefs.fontSize)]}
            onValueChange={function (value) {
              const next = Number(value[0])
              if (Number.isFinite(next)) toSetEditorPrefs({ fontSize: next })
            }}>
            {FONT_SIZES.map(function (size) {
              return (
                <ToggleGroupItem
                  key={size}
                  value={String(size)}
                  className={TOGGLE_ITEM}>
                  {size}
                </ToggleGroupItem>
              )
            })}
          </ToggleGroup>
        </Row>

        <Row label="行高">
          <ToggleGroup
            variant="outline"
            spacing={0}
            value={[findLineHeightPreset(editorPrefs.lineHeightRatio)]}
            onValueChange={function (value) {
              const next = Number(value[0])
              if (Number.isFinite(next)) toSetEditorPrefs({ lineHeightRatio: next })
            }}>
            {LINE_HEIGHTS.map(function (preset) {
              return (
                <ToggleGroupItem
                  key={preset.value}
                  value={String(preset.value)}
                  className={TOGGLE_ITEM}>
                  {preset.label}
                </ToggleGroupItem>
              )
            })}
          </ToggleGroup>
        </Row>

        <Row label="连字">
          <Switch
            checked={editorPrefs.isLigaturesEnabled}
            onCheckedChange={function (checked) {
              toSetEditorPrefs({ isLigaturesEnabled: checked === true })
            }}
          />
        </Row>

        <div className="space-y-1.5">
          <span className="text-muted-foreground text-xs">字体</span>
          <Input
            value={editorPrefs.fontFamily}
            placeholder="留空使用默认等宽字体"
            className="h-7 text-xs"
            onChange={function (event) {
              toSetEditorPrefs({ fontFamily: event.target.value })
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

export { EditorAppearance }
