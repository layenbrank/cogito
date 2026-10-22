import { Button } from '@i-thinking/design/components/button'
import { ScrollArea } from '@i-thinking/design/components/scroll-area'
import { parseSliderValue, Slider } from '@i-thinking/design/components/slider'
import { Icon } from '@iconify/react/offline'
import { clsx } from 'clsx'
import { throttle } from 'lodash-es'
import { useEffect, useMemo } from 'react'

import { findSelectedClip, useClipchampStore } from '@/stores/clipchamp.ts'
import type { Clip, ColorAdjust, InspectorTab } from '@/views/clipchamp/lib/project'

const TAB_LABELS: Record<InspectorTab, string> = {
  captions: '字幕',
  audio: '音频',
  fade: '淡入/淡出',
  filters: '滤镜',
  color: '颜色',
  transform: '变换',
  speed: '速率',
  mask: '蒙版'
}

const TABS: { id: InspectorTab; icon: string }[] = [
  { id: 'captions', icon: 'lucide:captions' },
  { id: 'audio', icon: 'lucide:volume-2' },
  { id: 'fade', icon: 'lucide:sunset' },
  { id: 'filters', icon: 'lucide:sparkles' },
  { id: 'color', icon: 'lucide:palette' },
  { id: 'transform', icon: 'lucide:move' },
  { id: 'speed', icon: 'lucide:gauge' },
  { id: 'mask', icon: 'lucide:circle-dashed' }
]

const MASK_OPTIONS = [
  { kind: 'none' as const, label: '无' },
  { kind: 'circle' as const, label: '圆形' },
  { kind: 'rect' as const, label: '矩形' },
  { kind: 'rounded' as const, label: '圆角' }
]

const ENTER_KINDS = ['none', 'fade', 'slide-up', 'zoom'] as const
const EXIT_KINDS = ['none', 'fade', 'slide-down', 'zoom'] as const

/** 各 Tab 面板共用的状态与回调 */ interface SurfaceProps {
  clip: Clip
  onCapture: () => void
  onPatch: (patch: Partial<Clip>) => void
  onCommit: (patch: Partial<Clip>) => void
  onPatchColor: (partial: Partial<ColorAdjust>) => void
  onFlushColor: () => void
  onDetachAudio: () => void
  onAddCaptionCue: () => void
}

function EmptyClipHint() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border/80 bg-muted/15 px-3 py-10 text-center">
      <Icon
        icon="lucide:sliders-horizontal"
        className="size-7 text-muted-foreground/70"
      />
      <p className="text-xs leading-relaxed text-muted-foreground">
        {'选中时间轴上的片段以编辑属性'}
      </p>
    </div>
  )
}

function CaptionsSurface(props: SurfaceProps) {
  const { clip } = props
  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        size="sm"
        className="w-full"
        onClick={props.onAddCaptionCue}>
        {'添加字幕片段'}
      </Button>
      {(clip.kind === 'caption' || clip.kind === 'text') && clip.text ? (
        <label className="flex flex-col gap-1.5 text-xs">
          <span className="text-muted-foreground">{'内容'}</span>
          <textarea
            className="min-h-24 rounded-md border border-border bg-background px-2.5 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            value={clip.text.content}
            onFocus={props.onCapture}
            onChange={function (event) {
              props.onPatch({
                text: { ...clip.text!, content: event.target.value },
                label: event.target.value.slice(0, 16)
              })
            }}
          />
        </label>
      ) : (
        <p className="text-xs text-muted-foreground">{'选中字幕或文本片段可编辑内容'}</p>
      )}
    </div>
  )
}

function AudioSurface(props: SurfaceProps) {
  const { clip } = props
  return (
    <div className="flex flex-col gap-3">
      <RangeField
        label={'音量'}
        min={0}
        max={1}
        step={0.01}
        value={clip.volume}
        display={`${Math.round(clip.volume * 100)}%`}
        onPointerDown={props.onCapture}
        onChange={function (value) {
          props.onPatch({ volume: value })
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={props.onDetachAudio}>
        {'分离音频'}
      </Button>
    </div>
  )
}

function FadeSurface(props: SurfaceProps) {
  const { clip } = props
  return (
    <div className="flex flex-col gap-3">
      <RangeField
        label={'淡入'}
        min={0}
        max={3000}
        step={50}
        value={clip.fadeInMs}
        display={`${(clip.fadeInMs / 1000).toFixed(2)}s`}
        onPointerDown={props.onCapture}
        onChange={function (value) {
          props.onPatch({
            fadeInMs: value,
            enterAnim: {
              kind: value > 0 ? 'fade' : 'none',
              durationMs: value
            }
          })
        }}
      />
      <RangeField
        label={'淡出'}
        min={0}
        max={3000}
        step={50}
        value={clip.fadeOutMs}
        display={`${(clip.fadeOutMs / 1000).toFixed(2)}s`}
        onPointerDown={props.onCapture}
        onChange={function (value) {
          props.onPatch({
            fadeOutMs: value,
            exitAnim: {
              kind: value > 0 ? 'fade' : 'none',
              durationMs: value
            }
          })
        }}
      />
      <AnimButtons
        label={'入场动画'}
        kinds={[...ENTER_KINDS]}
        active={clip.enterAnim.kind}
        onPick={function (kind) {
          props.onCommit({
            enterAnim: {
              kind,
              durationMs: kind === 'none' ? 0 : 400
            }
          })
        }}
      />
      <AnimButtons
        label={'出场动画'}
        kinds={[...EXIT_KINDS]}
        active={clip.exitAnim.kind}
        onPick={function (kind) {
          props.onCommit({
            exitAnim: {
              kind,
              durationMs: kind === 'none' ? 0 : 400
            }
          })
        }}
      />
    </div>
  )
}

function FiltersSurface(props: SurfaceProps) {
  const { clip } = props
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs leading-relaxed text-muted-foreground">
        {'在左侧「转场」面板可选滤镜预设'}
      </p>
      <label className="flex flex-col gap-1.5 text-xs">
        <span className="text-muted-foreground">{'混合模式'}</span>
        <select
          className="h-8 rounded-md border border-border bg-background px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          value={clip.blend}
          onChange={function (event) {
            props.onCommit({ blend: event.target.value })
          }}>
          <option value="normal">Normal</option>
          <option value="multiply">Multiply</option>
          <option value="screen">Screen</option>
          <option value="overlay">Overlay</option>
        </select>
      </label>
    </div>
  )
}

function ColorSurface(props: SurfaceProps) {
  const { clip } = props
  return (
    <div className="flex flex-col gap-3">
      <RangeField
        label={'曝光'}
        min={-0.5}
        max={0.5}
        step={0.01}
        value={clip.filter.exposure}
        display={clip.filter.exposure.toFixed(2)}
        onPointerDown={props.onCapture}
        onPointerUp={props.onFlushColor}
        onChange={function (value) {
          props.onPatchColor({ exposure: value })
        }}
      />
      <RangeField
        label={'对比度'}
        min={-0.5}
        max={0.5}
        step={0.01}
        value={clip.filter.contrast}
        display={clip.filter.contrast.toFixed(2)}
        onPointerDown={props.onCapture}
        onPointerUp={props.onFlushColor}
        onChange={function (value) {
          props.onPatchColor({ contrast: value })
        }}
      />
      <RangeField
        label={'饱和度'}
        min={-1}
        max={1}
        step={0.01}
        value={clip.filter.saturation}
        display={clip.filter.saturation.toFixed(2)}
        onPointerDown={props.onCapture}
        onPointerUp={props.onFlushColor}
        onChange={function (value) {
          props.onPatchColor({ saturation: value })
        }}
      />
      <RangeField
        label={'色温'}
        min={-1}
        max={1}
        step={0.01}
        value={clip.filter.temperature}
        display={clip.filter.temperature.toFixed(2)}
        onPointerDown={props.onCapture}
        onPointerUp={props.onFlushColor}
        onChange={function (value) {
          props.onPatchColor({ temperature: value })
        }}
      />
      <RangeField
        label={'透明度'}
        min={0}
        max={1}
        step={0.01}
        value={clip.filter.transparency}
        display={`${Math.round(clip.filter.transparency * 100)}%`}
        onPointerDown={props.onCapture}
        onPointerUp={props.onFlushColor}
        onChange={function (value) {
          props.onPatchColor({ transparency: value })
        }}
      />
    </div>
  )
}

function TransformSurface(props: SurfaceProps) {
  const { clip } = props
  return (
    <div className="flex flex-col gap-3">
      <RangeField
        label={'水平位置'}
        min={0}
        max={1}
        step={0.01}
        value={clip.x}
        display={clip.x.toFixed(2)}
        onPointerDown={props.onCapture}
        onChange={function (value) {
          props.onPatch({ x: value })
        }}
      />
      <RangeField
        label={'垂直位置'}
        min={0}
        max={1}
        step={0.01}
        value={clip.y}
        display={clip.y.toFixed(2)}
        onPointerDown={props.onCapture}
        onChange={function (value) {
          props.onPatch({ y: value })
        }}
      />
      <RangeField
        label={'缩放'}
        min={0.1}
        max={3}
        step={0.01}
        value={clip.scale}
        display={`${Math.round(clip.scale * 100)}%`}
        onPointerDown={props.onCapture}
        onChange={function (value) {
          props.onPatch({ scale: value })
        }}
      />
      <RangeField
        label={'旋转'}
        min={-180}
        max={180}
        step={1}
        value={clip.rotation}
        display={`${Math.round(clip.rotation)}°`}
        onPointerDown={props.onCapture}
        onChange={function (value) {
          props.onPatch({ rotation: value })
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={function () {
          props.onCommit({ x: 0.78, y: 0.78, scale: 0.35, rotation: 0 })
        }}>
        {'画中画布局'}
      </Button>
    </div>
  )
}

function SpeedSurface(props: SurfaceProps) {
  const { clip } = props
  return (
    <RangeField
      label={'速率'}
      min={0.1}
      max={16}
      step={0.1}
      value={clip.speed}
      display={`${clip.speed.toFixed(1)}x`}
      onPointerDown={props.onCapture}
      onChange={function (value) {
        props.onPatch({ speed: value })
      }}
    />
  )
}

function MaskSurface(props: SurfaceProps) {
  const { clip } = props
  return (
    <div className="grid grid-cols-2 gap-2">
      {MASK_OPTIONS.map(function (item) {
        return (
          <Button
            key={item.kind}
            type="button"
            variant={clip.mask.kind === item.kind ? 'default' : 'outline'}
            size="sm"
            className="h-8"
            onClick={function () {
              props.onCommit({ mask: { kind: item.kind, feather: 0 } })
            }}>
            {item.label}
          </Button>
        )
      })}
    </div>
  )
}

function TabRail(props: { activeTab: InspectorTab; onSelect: (tab: InspectorTab) => void }) {
  return (
    <nav className="flex w-11 shrink-0 flex-col items-center gap-0.5 border-l border-border/80 bg-muted/20 py-2">
      {TABS.map(function (tab) {
        const isActive = props.activeTab === tab.id
        return (
          <Button
            key={tab.id}
            type="button"
            variant="ghost"
            size="icon-sm"
            title={TAB_LABELS[tab.id]}
            className={clsx(
              'size-8 rounded-md text-muted-foreground',
              isActive && 'bg-primary/12 text-primary hover:bg-primary/15 hover:text-primary'
            )}
            onClick={function () {
              props.onSelect(tab.id)
            }}>
            <Icon
              icon={tab.icon}
              className="size-3.5"
            />
          </Button>
        )
      })}
    </nav>
  )
}

function findInspectorSurface(tab: InspectorTab, props: SurfaceProps) {
  switch (tab) {
    case 'captions':
      return <CaptionsSurface {...props} />
    case 'audio':
      return <AudioSurface {...props} />
    case 'fade':
      return <FadeSurface {...props} />
    case 'filters':
      return <FiltersSurface {...props} />
    case 'color':
      return <ColorSurface {...props} />
    case 'transform':
      return <TransformSurface {...props} />
    case 'speed':
      return <SpeedSurface {...props} />
    case 'mask':
      return <MaskSurface {...props} />
    default:
      return null
  }
}

function Inspector() {
  const inspectorTab = useClipchampStore(function (s) {
    return s.inspectorTab
  })
  const updateInspectorTab = useClipchampStore(function (s) {
    return s.updateInspectorTab
  })
  const clip = useClipchampStore(findSelectedClip)
  const patchSelected = useClipchampStore(function (s) {
    return s.patchSelected
  })
  const captureUndoPoint = useClipchampStore(function (s) {
    return s.captureUndoPoint
  })
  const detachSelectedAudio = useClipchampStore(function (s) {
    return s.detachSelectedAudio
  })
  const addCaptionCue = useClipchampStore(function (s) {
    return s.addCaptionCue
  })

  function commitPatch(patch: Partial<Clip>) {
    captureUndoPoint()
    patchSelected(patch)
  }

  const emitColor = useMemo(function () {
    return throttle(function (patch: Partial<Clip>) {
      useClipchampStore.getState().patchSelected(patch)
    }, 48)
  }, [])

  useEffect(
    function () {
      return function () {
        emitColor.cancel()
      }
    },
    [emitColor]
  )

  function patchColor(partial: Partial<ColorAdjust>) {
    // 节流回调可能在渲染后触发，取 store 当前选中项而不是闭包里的快照
    const current = findSelectedClip(useClipchampStore.getState())
    if (!current) return
    const filter = { ...current.filter, ...partial }
    const patch: Partial<Clip> = { filter }
    if (partial.transparency !== undefined) patch.opacity = 1 - partial.transparency
    emitColor(patch)
  }

  function flushColor() {
    emitColor.flush()
  }

  return (
    <div className="flex h-full min-h-0 border-l border-border/80 bg-background">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-10 shrink-0 items-center border-b border-border/80 px-3">
          <h2 className="text-sm font-medium tracking-tight">{TAB_LABELS[inspectorTab]}</h2>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-3 p-3">
            {clip ? (
              findInspectorSurface(inspectorTab, {
                clip,
                onCapture: captureUndoPoint,
                onPatch: patchSelected,
                onCommit: commitPatch,
                onPatchColor: patchColor,
                onFlushColor: flushColor,
                onDetachAudio: detachSelectedAudio,
                onAddCaptionCue: addCaptionCue
              })
            ) : (
              <EmptyClipHint />
            )}
          </div>
        </ScrollArea>
      </div>
      <TabRail
        activeTab={inspectorTab}
        onSelect={updateInspectorTab}
      />
    </div>
  )
}

interface AnimButtonsProps {
  label: string
  kinds: Array<'none' | 'fade' | 'slide-up' | 'slide-down' | 'zoom'>
  active: string
  onPick: (kind: 'none' | 'fade' | 'slide-up' | 'slide-down' | 'zoom') => void
}

function AnimButtons(props: AnimButtonsProps) {
  const { label, kinds, active, onPick } = props
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1">
        {kinds.map(function (kind) {
          return (
            <Button
              key={kind}
              type="button"
              size="sm"
              variant={active === kind ? 'default' : 'outline'}
              className="h-7 px-2 text-xs"
              onClick={function () {
                onPick(kind)
              }}>
              {kind}
            </Button>
          )
        })}
      </div>
    </div>
  )
}

interface RangeFieldProps {
  label: string
  min: number
  max: number
  step: number
  value: number
  display: string
  onChange: (value: number) => void
  onPointerDown?: () => void
  onPointerUp?: () => void
}

function RangeField(props: RangeFieldProps) {
  const { label, min, max, step, value, display, onChange, onPointerDown, onPointerUp } = props
  return (
    <label className="flex flex-col gap-1.5 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">{label}</span>
        <span className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-xs tabular-nums text-foreground/80">
          {display}
        </span>
      </div>
      <div
        onPointerDown={function () {
          onPointerDown?.()
        }}
        onPointerUp={function () {
          onPointerUp?.()
        }}>
        <Slider
          min={min}
          max={max}
          step={step}
          value={value}
          onValueChange={function (next: number | readonly number[]) {
            onChange(parseSliderValue(next))
          }}
        />
      </div>
    </label>
  )
}

export { Inspector }
