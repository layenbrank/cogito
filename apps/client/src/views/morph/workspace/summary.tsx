import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@cogito/design/components/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { Separator } from '@cogito/design/components/separator'
import { ToggleGroup, ToggleGroupItem } from '@cogito/design/components/toggle-group'
import { save } from '@tauri-apps/plugin-dialog'
import { clsx } from 'clsx'
import { useState } from 'react'

import styles from '@/views/morph/workspace/summary.module.scss'
import { selectSelectedAnnotation, useMorphStore } from '@/stores/morph.ts'
import { normalizeHex, PRESET_PRIMARY_COLORS } from '@/utils/color.ts'

const NUMBER_INPUT =
  'h-7 w-full min-w-0 rounded-md border border-input bg-background px-1.5 text-xs tabular-nums outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40'

const SEGMENT_ITEM =
  'grow basis-0 text-xs font-medium text-muted-foreground data-[pressed]:bg-primary/10 data-[pressed]:text-primary hover:text-foreground'

interface NumberFieldProps {
  label?: string
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (value: number) => void
}

function NumberField(props: NumberFieldProps) {
  const control = (
    <input
      type="number"
      aria-label={props.label}
      value={props.value}
      min={props.min}
      max={props.max}
      step={props.step}
      className={NUMBER_INPUT}
      onChange={function (event) {
        const next = event.target.valueAsNumber
        if (Number.isFinite(next)) props.onChange(next)
      }}
    />
  )

  if (!props.label) return control

  return (
    <label className={styles.numberField}>
      <span className={styles.numberLabel}>{props.label}</span>
      {control}
    </label>
  )
}

interface ColorFieldProps {
  value: string
  onChange: (color: string) => void
}

function ColorField(props: ColorFieldProps) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="选择颜色"
            className="h-7 w-full rounded-md border border-input"
            style={{ background: props.value }}
          />
        }
      />
      <PopoverContent
        align="start"
        className="w-56 gap-2">
        <div className="grid grid-cols-6 gap-1.5">
          {PRESET_PRIMARY_COLORS.map(function (hex) {
            return (
              <button
                key={hex}
                type="button"
                aria-label={hex}
                className="size-6 rounded-md border border-border"
                style={{ background: hex }}
                onClick={function () {
                  props.onChange(hex)
                }}
              />
            )
          })}
        </div>
        <input
          type="color"
          aria-label="自定义颜色"
          value={normalizeHex(props.value)}
          className="h-7 w-full cursor-pointer rounded-md border border-input bg-background"
          onChange={function (event) {
            props.onChange(event.target.value)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

// ─── Properties tab ──────────────────────────────────────────────────────────

function PropertiesTab() {
  const selected = useMorphStore(selectSelectedAnnotation)
  const updateAnnotation = useMorphStore((s) => s.toPatchAnnotation)
  const removeById = useMorphStore((s) => s.toRemoveAnnotation)

  if (!selected) {
    return (
      <div className={styles.emptyProps}>
        <span>请选择一个批注对象</span>
      </div>
    )
  }

  const { rect, data } = selected

  return (
    <div className={styles.propsForm}>
      <span className={styles.sectionLabel}>位置与尺寸</span>
      <div className={styles.rectForm}>
        <NumberField
          label="X"
          min={0}
          max={1}
          step={0.001}
          value={rect.x}
          onChange={(x) => void updateAnnotation(selected.id, { rect: { ...rect, x } })}
        />
        <NumberField
          label="Y"
          min={0}
          max={1}
          step={0.001}
          value={rect.y}
          onChange={(y) => void updateAnnotation(selected.id, { rect: { ...rect, y } })}
        />
        <NumberField
          label="W"
          min={0.001}
          max={1}
          step={0.001}
          value={rect.w}
          onChange={(w) => void updateAnnotation(selected.id, { rect: { ...rect, w } })}
        />
        <NumberField
          label="H"
          min={0.001}
          max={1}
          step={0.001}
          value={rect.h}
          onChange={(h) => void updateAnnotation(selected.id, { rect: { ...rect, h } })}
        />
      </div>

      <Separator className={styles.divider} />
      <span className={styles.sectionLabel}>样式</span>

      {'color' in data && (
        <div className={styles.styleForm}>
          <div className={styles.styleRow}>
            <span className={styles.fieldLabel}>颜色</span>
            <ColorField
              value={(data as Morph.Highlight).color}
              onChange={(color) =>
                void updateAnnotation(selected.id, {
                  data: { ...(data as Morph.Highlight), color }
                })
              }
            />
          </div>
          {'opacity' in data && (
            <div className={styles.styleRow}>
              <span className={styles.fieldLabel}>透明度</span>
              <NumberField
                min={0}
                max={1}
                step={0.1}
                value={data.opacity}
                onChange={(opacity) =>
                  void updateAnnotation(selected.id, { data: { ...data, opacity } })
                }
              />
            </div>
          )}
        </div>
      )}

      <Separator className={styles.divider} />
      <Button
        variant="destructive"
        size="sm"
        className={styles.deleteBtn}
        onClick={() => void removeById(selected.id)}>
        删除批注
      </Button>
    </div>
  )
}

// ─── Export tab ───────────────────────────────────────────────────────────────

function ExportTab() {
  const file = useMorphStore((s) => s.file)
  const toExportDoc = useMorphStore((s) => s.toExportDoc)

  async function handleExport() {
    if (!file) return
    const dest = await save({
      title: '导出 PDF',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      defaultPath: file.path.replace(/\.pdf$/i, '_export.pdf')
    })
    if (dest) await toExportDoc(dest)
  }

  return (
    <div className={styles.exportForm}>
      <p className="text-muted-foreground mb-3 text-xs leading-relaxed">
        将当前 PDF 完整复制到目标路径（与 morph.export 一致；PDF/A
        与按页导出请用「转换」）。
      </p>
      <Button
        className="w-full"
        onClick={handleExport}
        disabled={!file}>
        导出 PDF
      </Button>
    </div>
  )
}

// ─── History tab ─────────────────────────────────────────────────────────────

function HistoryTab() {
  const toUndoStack = useMorphStore((s) => s.toUndoStack)
  const toUndo = useMorphStore((s) => s.toUndo)

  if (!toUndoStack.length) {
    return (
      <div className={styles.emptyProps}>
        <span>暂无操作记录</span>
      </div>
    )
  }

  return (
    <div className={styles.historyList}>
      {[...toUndoStack].reverse().map((entry) => (
        <div
          key={entry.timestamp}
          className={styles.historyItem}>
          <span className={styles.historyLabel}>{entry.label}</span>
          <span className={styles.historyTime}>
            {new Date(entry.timestamp).toLocaleTimeString('zh-CN', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            })}
          </span>
        </div>
      ))}
      <Button
        size="sm"
        className={clsx(styles.undoBtn, 'w-full')}
        onClick={toUndo}
        disabled={!toUndoStack.length}>
        撤销最后操作
      </Button>
    </div>
  )
}

// ─── Summary root ─────────────────────────────────────────────────────────────

type SummaryTab = 'props' | 'export' | 'history'

export default function Summary() {
  const toToggleSummary = useMorphStore(function (s) {
    return s.toToggleSummary
  })
  const [tab, onUpdateTab] = useState<SummaryTab>('props')

  return (
    <div className={clsx(styles.summary, styles.root)}>
      <div className={styles.header}>
        <span className={styles.title}>属性</span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="关闭"
          className="rounded-md text-muted-foreground"
          onClick={toToggleSummary}>
          <Icon
            icon="mdi:close"
            className="size-3.5"
          />
        </Button>
      </div>

      <div className={styles.tabs}>
        <ToggleGroup
          size="sm"
          spacing={2}
          variant="outline"
          value={[tab]}
          className={clsx(styles.tabSegment, 'w-full')}
          onValueChange={function (value) {
            const next = value[0]
            if (next === 'props' || next === 'export' || next === 'history') onUpdateTab(next)
          }}>
          <ToggleGroupItem
            value="props"
            className={SEGMENT_ITEM}>
            属性
          </ToggleGroupItem>
          <ToggleGroupItem
            value="export"
            className={SEGMENT_ITEM}>
            导出
          </ToggleGroupItem>
          <ToggleGroupItem
            value="history"
            className={SEGMENT_ITEM}>
            历史
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className={styles.tabContent}>
        {tab === 'props' ? <PropertiesTab /> : null}
        {tab === 'export' ? <ExportTab /> : null}
        {tab === 'history' ? <HistoryTab /> : null}
      </div>
    </div>
  )
}
