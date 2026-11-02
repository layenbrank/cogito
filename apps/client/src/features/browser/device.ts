/**
 * 设备模拟的**纯逻辑**：预设表、适配比例、旋转、文案。
 *
 * 与 Rust 侧 `browser/emulate.rs` 的 `preset()` 一一对应 —— 两边都存一份是故意的：
 * 前端要立刻画出盒子与角标（不能等 IPC 回来），Rust 要能独立应答 agent。
 * 改预设时**两处一起改**，`device.test.ts` 锁字段，`emulate.rs` 的
 * `presets_cover_the_documented_ids` 锁后端那份。
 */

/** 一份设备档案。`dpr = null` = 跟随系统；`userAgent = null` = 不覆盖 UA。 */
interface DeviceProfile {
  /** CSS px */
  width: number
  height: number
  dpr: number | null
  /** true = 触摸 + `pointer: coarse` + 移动端 UA 语义 */
  mobile: boolean
  userAgent: string | null
}

interface DevicePreset extends DeviceProfile {
  id: string
  name: string
}

/** 预设设备的 UA；与 Rust `UA_*` 常量保持一致 */
const UA_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const UA_IPHONE_SE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
const UA_IPAD =
  'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const UA_PIXEL =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
const UA_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'

/**
 * 预设顺序 = 菜单顺序。桌面放最后：它是「退出模拟」之外唯一一个 mobile:false 的档案。
 *
 * 桌面预设的 `dpr` 是 `null`（跟随系统）而不是 1 —— 强制 1 会让 125% 缩放的机器上
 * 1px 边框看起来和真实桌面不一样；「跟随系统」才是桌面态的默认。
 */
const DEVICE_PRESETS: readonly DevicePreset[] = [
  {
    id: 'iphone-15-pro',
    name: 'iPhone 15 Pro',
    width: 393,
    height: 852,
    dpr: 3,
    mobile: true,
    userAgent: UA_IPHONE
  },
  {
    id: 'iphone-se',
    name: 'iPhone SE',
    width: 375,
    height: 667,
    dpr: 2,
    mobile: true,
    userAgent: UA_IPHONE_SE
  },
  {
    id: 'pixel-8',
    name: 'Pixel 8',
    width: 412,
    height: 915,
    dpr: 2.625,
    mobile: true,
    userAgent: UA_PIXEL
  },
  {
    id: 'ipad-mini',
    name: 'iPad Mini',
    width: 768,
    height: 1024,
    dpr: 2,
    mobile: true,
    userAgent: UA_IPAD
  },
  {
    id: 'android',
    name: 'Android',
    width: 360,
    height: 780,
    dpr: 3,
    mobile: true,
    userAgent: UA_ANDROID
  },
  {
    id: 'desktop',
    name: '桌面',
    width: 1440,
    height: 900,
    dpr: null,
    mobile: false,
    userAgent: null
  }
]

/** fit 下限与 Rust `MIN_FIT` 对齐：再小就看不清了 */
const MIN_FIT = 0.1
const MAX_FIT = 1

interface BoxSize {
  width: number
  height: number
}

/** 夹到 `[0.1, 1]`；非有限值按 1 处理（不缩放永远安全） */
function clampFit(fit: number): number {
  if (!Number.isFinite(fit)) return MAX_FIT
  return Math.min(MAX_FIT, Math.max(MIN_FIT, fit))
}

/**
 * 设备盒子相对面板的缩放比：宽、高各算一次，取小者，且不超过 1（不放大小面板）。
 *
 * 面板还没量出来（宽高 ≤ 0）时返回 1：先按原尺寸显示，量到后再缩。
 */
function fitFor(device: DeviceProfile, box: BoxSize): number {
  if (box.width <= 0 || box.height <= 0) return MAX_FIT
  return clampFit(
    Math.min(box.width / device.width, box.height / device.height, MAX_FIT)
  )
}

/** 旋转 90°（宽高互换），其余字段不变 */
function rotateDevice(device: DeviceProfile): DeviceProfile {
  return { ...device, width: device.height, height: device.width }
}

/** 按尺寸找预设（旋转过的设备也能认出来），找不到返回 null = 自定义 */
function findPreset(device: DeviceProfile | null): DevicePreset | null {
  if (!device) return null
  const portrait = DEVICE_PRESETS.find(function (preset) {
    return preset.width === device.width && preset.height === device.height
  })
  if (portrait) return portrait
  const landscape = DEVICE_PRESETS.find(function (preset) {
    return preset.width === device.height && preset.height === device.width
  })
  return landscape ?? null
}

/** 预设 id → 预设（给菜单用） */
function findPresetById(id: string): DevicePreset | null {
  return (
    DEVICE_PRESETS.find(function (preset) {
      return preset.id === id
    }) ?? null
  )
}

/** DPR 文案：`null` 是「跟随系统」，不是缺省错误 */
function describeDpr(device: DeviceProfile): string {
  return device.dpr === null ? 'DPR 跟随系统' : `DPR ${device.dpr}`
}

/**
 * 一行设备描述，角标与菜单共用：
 * `iPhone 15 Pro · 393×852 · 92%` / `自定义 · 360×780 · 100%` / `桌面`
 */
function describeDevice(device: DeviceProfile | null, fit = MAX_FIT): string {
  if (!device) return '桌面'
  const preset = findPreset(device)
  const name = preset ? preset.name : '自定义'
  const ratio = `${Math.round(clampFit(fit) * 100)}%`
  return `${name} · ${device.width}×${device.height} · ${ratio}`
}

/** 设备盒子是否非空（宽高都得是正数才敢拿去 set_bounds） */
function isUsableDevice(device: DeviceProfile | null): device is DeviceProfile {
  return (
    device !== null &&
    Number.isFinite(device.width) &&
    Number.isFinite(device.height) &&
    device.width > 0 &&
    device.height > 0
  )
}

/** 自定义表单 → 档案；宽高非法时返回 null（UI 侧禁用「应用」） */
function buildDevice(input: {
  width: number
  height: number
  dpr: number | null
  mobile?: boolean
  userAgent?: string | null
}): DeviceProfile | null {
  if (!Number.isFinite(input.width) || !Number.isFinite(input.height)) return null
  if (input.width < 1 || input.height < 1) return null
  const userAgent = input.userAgent?.trim() ?? ''
  return {
    width: Math.round(input.width),
    height: Math.round(input.height),
    dpr: input.dpr !== null && Number.isFinite(input.dpr) && input.dpr > 0 ? input.dpr : null,
    mobile: input.mobile ?? true,
    userAgent: userAgent.length > 0 ? userAgent : null
  }
}

export {
  DEVICE_PRESETS,
  MAX_FIT,
  MIN_FIT,
  buildDevice,
  clampFit,
  describeDevice,
  describeDpr,
  findPreset,
  findPresetById,
  fitFor,
  isUsableDevice,
  rotateDevice
}
export type { BoxSize, DevicePreset, DeviceProfile }
