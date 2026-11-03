/**
 * 代码窗标题栏的编辑器设置（排版 / 换行 / 显示 / 缩进）。
 *
 * 放在窗内而不是设置窗：`tiles.json` 由 code 窗的 store 独占写入，
 * 跨窗改写会被下一次写回覆盖，就地改最省事也最直观。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
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

function Group(props: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
        {props.title}
      </h4>
      {props.children}
    </section>
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
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            data-region="false"
            aria-label="编辑器设置"
            title="编辑器设置"
            className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-7 items-center justify-center rounded-md border-0">
            <Icon
              icon="lucide:settings-2"
              className="size-4"
            />
          </Button>
        }
      />
      <PopoverContent
        align="end"
        className="max-h-[70vh] w-80 space-y-4 overflow-y-auto p-3">
        <Group title="排版">
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
        </Group>

        <Group title="换行">
          <Row label="超出可视区">
            <ToggleGroup
              variant="outline"
              spacing={0}
              value={[editorPrefs.wordWrap]}
              onValueChange={function (value) {
                const next = value[0]
                if (next === 'off' || next === 'on' || next === 'bounded') {
                  toSetEditorPrefs({ wordWrap: next })
                }
              }}>
              <ToggleGroupItem
                value="off"
                className={TOGGLE_ITEM}>
                不换行
              </ToggleGroupItem>
              <ToggleGroupItem
                value="on"
                className={TOGGLE_ITEM}>
                换行
              </ToggleGroupItem>
              <ToggleGroupItem
                value="bounded"
                className={TOGGLE_ITEM}>
                按宽度
              </ToggleGroupItem>
            </ToggleGroup>
          </Row>
          <Row label="列宽">
            <Input
              type="number"
              min={40}
              max={200}
              value={editorPrefs.wordWrapColumn}
              disabled={editorPrefs.wordWrap !== 'bounded'}
              className="h-7 w-20 text-xs"
              onChange={function (event) {
                const next = Number(event.target.value)
                if (Number.isFinite(next)) {
                  toSetEditorPrefs({
                    wordWrapColumn: Math.min(200, Math.max(40, Math.round(next)))
                  })
                }
              }}
            />
          </Row>
        </Group>

        <Group title="显示">
          <Row label="小地图">
            <Switch
              checked={editorPrefs.isMinimapEnabled}
              onCheckedChange={function (checked) {
                toSetEditorPrefs({ isMinimapEnabled: checked === true })
              }}
            />
          </Row>
          <Row label="空白字符">
            <ToggleGroup
              variant="outline"
              spacing={0}
              value={[editorPrefs.renderWhitespace]}
              onValueChange={function (value) {
                const next = value[0]
                if (next === 'none' || next === 'selection' || next === 'all') {
                  toSetEditorPrefs({ renderWhitespace: next })
                }
              }}>
              <ToggleGroupItem
                value="none"
                className={TOGGLE_ITEM}>
                无
              </ToggleGroupItem>
              <ToggleGroupItem
                value="selection"
                className={TOGGLE_ITEM}>
                选中
              </ToggleGroupItem>
              <ToggleGroupItem
                value="all"
                className={TOGGLE_ITEM}>
                全部
              </ToggleGroupItem>
            </ToggleGroup>
          </Row>
          <Row label="粘性滚动">
            <Switch
              checked={editorPrefs.isStickyScrollEnabled}
              onCheckedChange={function (checked) {
                toSetEditorPrefs({ isStickyScrollEnabled: checked === true })
              }}
            />
          </Row>
          <Row label="括号导线">
            <Switch
              checked={editorPrefs.isBracketGuidesEnabled}
              onCheckedChange={function (checked) {
                toSetEditorPrefs({ isBracketGuidesEnabled: checked === true })
              }}
            />
          </Row>
          <Row label="语义高亮">
            <Switch
              checked={editorPrefs.isSemanticHighlightingEnabled}
              onCheckedChange={function (checked) {
                toSetEditorPrefs({ isSemanticHighlightingEnabled: checked === true })
              }}
            />
          </Row>
        </Group>

        <Group title="缩进">
          <Row label="新文档缩进">
            <ToggleGroup
              variant="outline"
              spacing={0}
              value={[String(editorPrefs.tabSize)]}
              onValueChange={function (value) {
                const next = Number(value[0])
                if (Number.isFinite(next)) toSetEditorPrefs({ tabSize: next })
              }}>
              <ToggleGroupItem
                value="2"
                className={TOGGLE_ITEM}>
                2
              </ToggleGroupItem>
              <ToggleGroupItem
                value="4"
                className={TOGGLE_ITEM}>
                4
              </ToggleGroupItem>
            </ToggleGroup>
          </Row>
          <Row label="使用制表符">
            <Switch
              checked={!editorPrefs.insertSpaces}
              onCheckedChange={function (checked) {
                toSetEditorPrefs({ insertSpaces: checked !== true })
              }}
            />
          </Row>
        </Group>
      </PopoverContent>
    </Popover>
  )
}

export { EditorAppearance }
