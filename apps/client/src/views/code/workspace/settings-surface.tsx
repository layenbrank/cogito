/**
 * 编辑器独立页「设置」。
 *
 * 以前是标题栏齿轮的浮层 Popover：面板窄、滚动受限，改完还得点空白处收起。
 * 现在改成独立标签页（对齐 VS Code 的设置标签）：整页滚动、分组用卡片分隔，
 * 改动仍然即时生效并写回 `tiles.json`，没有「应用」按钮。
 */
import { Input } from '@cogito/design/components/input'
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

function Row(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <div className="text-foreground/85 text-[13px] leading-5">{props.label}</div>
        {props.hint ? (
          <div className="text-muted-foreground/75 text-[11px] leading-4">{props.hint}</div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{props.children}</div>
    </div>
  )
}

function Card(props: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border/60 bg-background/70">
      <header className="border-b border-border/50 bg-muted/20 px-4 py-2">
        <h3 className="text-foreground/90 text-[13px] font-medium">{props.title}</h3>
        {props.description ? (
          <p className="text-muted-foreground/75 text-[11px] leading-4">{props.description}</p>
        ) : null}
      </header>
      <div className="divide-border/40 divide-y px-4 py-1">{props.children}</div>
    </section>
  )
}

function SettingsSurface() {
  const editorPrefs = useCodeStore(function (state) {
    return state.editorPrefs
  })
  const toSetEditorPrefs = useCodeStore(function (state) {
    return state.toSetEditorPrefs
  })
  const isHiddenVisible = useCodeStore(function (state) {
    return state.isHiddenVisible
  })
  const tsTypesMode = useCodeStore(function (state) {
    return state.tsTypesMode
  })

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <p className="text-muted-foreground/75 shrink-0 px-4 py-2 text-[11px]">
        这些偏好只作用于代码窗，改动即时生效并保存到本机
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl space-y-3 px-4 py-4">
          <Card
            title="排版"
            description="字体、字号与行距">
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

            <Row
              label="字体"
              hint="留空使用默认等宽字体">
              <Input
                value={editorPrefs.fontFamily}
                placeholder="留空使用默认等宽字体"
                className="h-7 w-56 text-xs"
                onChange={function (event) {
                  toSetEditorPrefs({ fontFamily: event.target.value })
                }}
              />
            </Row>
          </Card>

          <Card
            title="换行"
            description="长行的折行方式与列宽">
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
            <Row
              label="列宽"
              hint="仅「按宽度」换行时生效">
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
          </Card>

          <Card
            title="显示"
            description="编辑器里的辅助信息">
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
          </Card>

          <Card
            title="缩进"
            description="新打开文档的默认缩进">
            <Row label="缩进宽度">
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
          </Card>

          <Card
            title="工作区"
            description="资源管理器与 TS 语言服务的显示口径">
            <Row
              label="显示隐藏文件"
              hint="以 . 开头的文件与目录">
              <Switch
                checked={isHiddenVisible}
                onCheckedChange={function () {
                  useCodeStore.getState().toToggleHiddenVisible()
                }}
              />
            </Row>
            <Row
              label="TS 类型提示"
              hint="注入 node 类型定义，按需更省内存">
              <ToggleGroup
                variant="outline"
                spacing={0}
                value={[tsTypesMode]}
                onValueChange={function (value) {
                  const next = value[0]
                  if (next === 'full' || next === 'lean' || next === 'off') {
                    useCodeStore.getState().toSetTsTypesMode(next)
                  }
                }}>
                <ToggleGroupItem
                  value="full"
                  className={TOGGLE_ITEM}>
                  总是
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="lean"
                  className={TOGGLE_ITEM}>
                  按需
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="off"
                  className={TOGGLE_ITEM}>
                  关闭
                </ToggleGroupItem>
              </ToggleGroup>
            </Row>
          </Card>
        </div>
      </div>
    </div>
  )
}

export { SettingsSurface }
