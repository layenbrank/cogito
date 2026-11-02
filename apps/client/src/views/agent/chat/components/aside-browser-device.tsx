/**
 * 右栏浏览器的「设备模拟」菜单：预设 + 自定义 + 旋转 + 退出。
 *
 * 只负责**收集意图**：真正的 CDP 下发、fit 计算与状态回灌都在 `aside-browser.tsx`
 * 里（它才知道面板多大）。这里保持纯展示 + 一个 `onSelect`，方便单测与复用。
 *
 * 菜单本身带 `data-webview="false"`（`DropdownMenuContent` 内置），所以弹出时
 * `rect.ts` 的 `findBlocker` 会让原生 webview 暂停，不会被盖住。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { Input } from '@cogito/design/components/input'
import { clsx } from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import {
  DEVICE_PRESETS,
  buildDevice,
  describeDpr,
  findPreset,
  rotateDevice
} from '@/features/browser/device'
import type { DeviceProfile } from '@/features/browser/device'

interface AsideBrowserDeviceProps {
  device: DeviceProfile | null
  disabled?: boolean
  /** 选中设备（`null` = 退出模拟）；fit 由父组件按面板尺寸算 */
  onSelect: (device: DeviceProfile | null) => void
}

/** 自定义表单的默认值：手机竖屏，和第一个预设对齐 */
const CUSTOM_DEFAULTS = { width: '390', height: '844', dpr: '3' }

function AsideBrowserDevice(props: AsideBrowserDeviceProps) {
  const [open, updateOpen] = useState(false)
  const [width, setWidth] = useState(CUSTOM_DEFAULTS.width)
  const [height, setHeight] = useState(CUSTOM_DEFAULTS.height)
  const [dpr, setDpr] = useState(CUSTOM_DEFAULTS.dpr)
  const [mobile, setMobile] = useState(true)
  const [userAgent, setUserAgent] = useState('')
  /** 菜单每次从关到开只回填一次表单，避免应答回来时把正在输入的内容冲掉 */
  const seededRef = useRef(false)

  // 每次打开都用「当前设备」回填，避免上一次的临时输入留在表单里
  useEffect(
    function () {
      if (!open) {
        seededRef.current = false
        return
      }
      // 只在「打开的那一刻」回填：应答回来时 store 会换一个 device 对象，
      // 如果跟着对象身份重置，正打字的宽高会被清掉。
      if (seededRef.current) return
      seededRef.current = true
      const current = props.device
      setWidth(String(current?.width ?? CUSTOM_DEFAULTS.width))
      setHeight(String(current?.height ?? CUSTOM_DEFAULTS.height))
      setDpr(current?.dpr === null || current?.dpr === undefined ? '' : String(current.dpr))
      setMobile(current?.mobile ?? true)
      setUserAgent(current?.userAgent ?? '')
    },
    [open, props.device]
  )

  const current = findPreset(props.device)

  function applyCustom() {
    const device = buildDevice({
      width: Number(width),
      height: Number(height),
      dpr: dpr.trim() === '' ? null : Number(dpr),
      mobile,
      userAgent
    })
    if (!device) {
      toast.error('宽高必须是不小于 1 的整数')
      return
    }
    props.onSelect(device)
    updateOpen(false)
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={function (next) {
        updateOpen(next)
      }}>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={props.device ? '切换设备模拟' : '设备模拟'}
            title={
              props.device
                ? `设备模拟中：${props.device.width}×${props.device.height}（点击切换 / 退出）`
                : '设备模拟：按手机 / 平板尺寸预览 H5'
            }
            disabled={props.disabled}
            className={clsx(
              'size-6 shrink-0',
              props.device
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          />
        }>
        <Icon
          icon="lucide:smartphone"
          className="size-3.5"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>设备模拟</DropdownMenuLabel>
          {DEVICE_PRESETS.map(function (preset) {
            // 桌面预设 = 退出模拟：device=null 时高亮「桌面」，避免与「退出」分叉两套态
            const active =
              preset.id === 'desktop' ? props.device === null : current?.id === preset.id
            return (
              <DropdownMenuItem
                key={preset.id}
                onClick={function () {
                  props.onSelect(preset.id === 'desktop' ? null : preset)
                  updateOpen(false)
                }}>
                <Icon
                  icon={active ? 'lucide:check' : 'lucide:circle'}
                  className={clsx(
                    'size-3.5',
                    active ? 'text-primary' : 'text-muted-foreground/40'
                  )}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{preset.name}</span>
                  <span className="text-muted-foreground text-[11px]">
                    {preset.id === 'desktop'
                      ? '恢复系统视口'
                      : `${preset.width}×${preset.height} · ${describeDpr(preset)}`}
                  </span>
                </span>
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>自定义</DropdownMenuLabel>
          {/* 表单要能正常键入：把按键从菜单的键盘导航里摘出来 */}
          <div
            className="flex flex-col gap-1.5 px-1.5 pb-1"
            onKeyDown={function (event) {
              event.stopPropagation()
            }}>
            <div className="flex items-center gap-1.5">
              <Input
                aria-label="设备宽度"
                className="h-7 px-2 text-xs"
                inputMode="numeric"
                value={width}
                onChange={function (event) {
                  setWidth(event.target.value)
                }}
              />
              <span className="text-muted-foreground text-xs">×</span>
              <Input
                aria-label="设备高度"
                className="h-7 px-2 text-xs"
                inputMode="numeric"
                value={height}
                onChange={function (event) {
                  setHeight(event.target.value)
                }}
              />
              <Input
                aria-label="设备像素比"
                className="h-7 px-2 text-xs"
                placeholder="DPR"
                inputMode="decimal"
                value={dpr}
                onChange={function (event) {
                  setDpr(event.target.value)
                }}
              />
            </div>
            <Input
              aria-label="User-Agent"
              className="h-7 px-2 text-xs"
              placeholder="User-Agent（留空 = 不覆盖）"
              value={userAgent}
              onChange={function (event) {
                setUserAgent(event.target.value)
              }}
            />
            <div className="flex items-center justify-between">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className={clsx(
                  'h-6 gap-1 px-1.5 text-[11px]',
                  mobile ? 'text-primary' : 'text-muted-foreground'
                )}
                title="移动端语义：触摸合成 + pointer: coarse + hover: none"
                onClick={function () {
                  setMobile(!mobile)
                }}>
                <Icon
                  icon={mobile ? 'lucide:toggle-right' : 'lucide:toggle-left'}
                  className="size-4"
                />
                移动端语义
              </Button>
              <Button
                type="button"
                size="xs"
                className="h-6 px-2 text-[11px]"
                onClick={applyCustom}>
                应用
              </Button>
            </div>
          </div>
        </DropdownMenuGroup>

        {props.device ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={function () {
                if (!props.device) return
                props.onSelect(rotateDevice(props.device))
                updateOpen(false)
              }}>
              <Icon
                icon="lucide:rotate-ccw"
                className="size-3.5"
              />
              旋转 90°（{props.device.height}×{props.device.width}）
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={function () {
                // 与上方「桌面」预设同义：都是 device=null，不另开 1440×900 模拟态
                props.onSelect(null)
                updateOpen(false)
              }}>
              <Icon
                icon="lucide:monitor"
                className="size-3.5"
              />
              退出模拟（同「桌面」）
            </DropdownMenuItem>
          </>
        ) : null}

        <DropdownMenuSeparator />
        <p className="text-muted-foreground px-1.5 py-1 text-[11px] leading-snug">
          只作用于当前标签页，退出即恢复；DPR 覆盖下预览是缩放图，模糊属正常现象。
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { AsideBrowserDevice }
export type { AsideBrowserDeviceProps }
