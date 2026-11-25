import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { CHANNELS } from '@/shared/ipc/channels'

import type { SurfaceStyleInput } from '@/features/magnetic-tile/surface-style'
import type { MarkerLayout } from '@/features/magnetic-tile/size'
import type { CaptureRegion } from '@/features/capture/region'

/**
 * Tauri 截图能力的轻量封装，前端通过这些函数与 Rust 端的
 * `capture:*` 命令通信。
 */

/** 取 pending 的重试间隔；总预算 ≈ 250ms，正常路径第一次就命中 */
const PENDING_RETRY_DELAYS_MS = [16, 32, 64, 128]

interface ScreenshotResult {
  /** 截图保存后的磁盘绝对路径 */
  path: string
  width: number
  height: number
  scale_factor: number
  regions?: CaptureRegion[]
}

/** 矩形（overlay 局部逻辑像素） */
interface CaptureRect {
  x: number
  y: number
  w: number
  h: number
}

interface MountOverlayOptions extends Partial<MarkerLayout>, SurfaceStyleInput {
  title?: string
  mark?: string | null
  url?: string | null
}

/** 主显示器即时截图（不弹窗，返回截图文件路径） */
async function POST_CAPTURE_SCREENSHOT(): Promise<ScreenshotResult> {
  return invoke<ScreenshotResult>(CHANNELS.CAPTURE.SCREENSHOT)
}

/**
 * 消费 `capture:open` 预截好的结果；无则返回 null。
 *
 * 宿主是「先发布 pending 再切截屏态」的，正常一次就能取到；这里仍留几次短重试，
 * 兜住浮层刚重载完、事件比 IPC 先到的极端时序（否则会直接跳「未找到预截图」）。
 *
 * `shouldStop`：组件已卸载/取消时别再继续 take —— pending 是一次性的，
 * 让已经废弃的实例把新一帧抢走，新实例就只能拿到空值。
 */
async function GET_CAPTURE_PENDING(shouldStop?: () => boolean): Promise<ScreenshotResult | null> {
  for (let attempt = 0; attempt <= PENDING_RETRY_DELAYS_MS.length; attempt += 1) {
    if (shouldStop?.()) return null
    const result = await invoke<ScreenshotResult | null>(CHANNELS.CAPTURE.TAKE_PENDING)
    if (result) return result
    const delay = PENDING_RETRY_DELAYS_MS[attempt]
    if (delay === undefined) break
    await new Promise(function (resolve) {
      setTimeout(resolve, delay)
    })
  }
  return null
}

/** 重新抓一帧（整体重来），新帧直接返回，不走 pending */
async function POST_CAPTURE_REFRESH(): Promise<ScreenshotResult> {
  return invoke<ScreenshotResult>(CHANNELS.CAPTURE.REFRESH)
}

/** 告知宿主「冻结帧已画上屏」，宿主收到后才撤掉 conceal */
async function POST_CAPTURE_READY(): Promise<void> {
  await invoke(CHANNELS.CAPTURE.READY)
}

/** 光标位置（overlay 局部逻辑像素）；进入截屏态后种首次悬停用 */
async function GET_CAPTURE_CURSOR(): Promise<{ x: number; y: number } | null> {
  return invoke<{ x: number; y: number } | null>(CHANNELS.CAPTURE.CURSOR)
}

/**
 * 可用矩形（overlay 局部逻辑像素，扣掉任务栏）。读不到返回 null。
 *
 * 浮层铺满**整屏**（含任务栏那条），所以工具栏不能拿 `innerHeight` 当边界：
 * 任务栏是 topmost，会把贴底那一块压住。任务栏自动隐藏时它等于整屏，
 * 前端仍按 GAP 内缩，避免刚好落在任务栏的探出条上。
 */
async function GET_CAPTURE_VIEWPORT(): Promise<CaptureRect | null> {
  return invoke<CaptureRect | null>(CHANNELS.CAPTURE.VIEWPORT)
}

/** 光标下的元素级候选（overlay 逻辑像素入参） */
async function GET_CAPTURE_ELEMENTS(x: number, y: number): Promise<CaptureRegion[]> {
  return invoke<CaptureRegion[]>(CHANNELS.CAPTURE.ELEMENTS, { params: { x, y } })
}

/**
 * 磁盘路径 → HTMLImageElement（Konva / toDataURL 可用）。
 * 使用 asset URL + crossOrigin 直解码；勿走 plugin-http fetch（那是远程 HTTP，会多一次 IPC 整图拷贝）。
 */
async function fetchImageFromPath(filePath: string): Promise<HTMLImageElement> {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.decoding = 'async'
  image.src = convertFileSrc(filePath)
  try {
    await image.decode()
  } catch {
    throw new Error(`fetchImageFromPath: 图片解码失败 - ${filePath}`)
  }
  return image
}

/* ─── Overlay 窗口管理 ─── */

async function POST_OVERLAY_ENSURE(): Promise<void> {
  await invoke(CHANNELS.OVERLAY.ENSURE)
}

async function DELETE_OVERLAY(): Promise<void> {
  await invoke(CHANNELS.OVERLAY.HIDE)
}

/** 真正隐藏浮层窗口（仅退出 / 渲染进程异常时用） */
async function PUT_OVERLAY_PARK(): Promise<void> {
  await invoke(CHANNELS.OVERLAY.PARK)
}

async function PUT_OVERLAY_MODE(mode: 'idle' | 'screenshot'): Promise<void> {
  await invoke(CHANNELS.OVERLAY.UPDATE_MODE, { mode })
}

/** 主窗磁贴右键「浮层 → 添加」 */
async function POST_OVERLAY_TILE(
  kind: MagneticTile.Component,
  magneticTileID: string,
  options?: MountOverlayOptions
): Promise<void> {
  await invoke(CHANNELS.OVERLAY.MOUNT, {
    payload: {
      kind,
      magneticTileID,
      size: options?.size ?? null,
      shape: options?.shape ?? null,
      direction: options?.direction ?? null,
      round: options?.round ?? null,
      background: options?.background ?? null,
      title: options?.title ?? '',
      mark: options?.mark ?? null,
      url: options?.url ?? null
    }
  })
}

/** 主窗 / 浮层「移除」共用 */
async function DELETE_OVERLAY_TILE(magneticTileID: string): Promise<void> {
  await invoke(CHANNELS.OVERLAY.UNMOUNT, {
    payload: { magneticTileID }
  })
}

// ------------------------------------------------------------ 落盘 / 识别 / 保活

/** 把截图贴成浮层磁贴，返回落盘路径 */
function POST_CAPTURE_PIN_TEXTURE(dataUrl: string): Promise<string> {
  return invoke<string>(CHANNELS.CAPTURE.PIN_TEXTURE, { dataUrl })
}

/** 弹系统保存对话框写 PNG；用户取消返回 `null` */
function POST_CAPTURE_SAVE_PNG(dataUrl: string, defaultName: string): Promise<string | null> {
  return invoke<string | null>(CHANNELS.CAPTURE.SAVE_PNG, { dataUrl, defaultName })
}

/** 取字：Rust 侧跑 OCR，返回纯文本 */
function POST_CAPTURE_OCR(params: {
  path: string
  crop?: unknown
  language?: string | null
}): Promise<{ text: string }> {
  return invoke<{ text: string }>(CHANNELS.CAPTURE.OCR, { params })
}

/** 容量清理策略：按种类给「保留天数 / 条数 / 字节」上限 */
interface CapturePrunePolicy {
  kind: 'screenshot' | 'recording'
  days: number
  count: number
  maxBytes: number
}

interface CapturePruneResult {
  /** 被删掉的素材 id */
  ids: string[]
  /** 实际释放的字节数 */
  freedBytes: number
}

/** 按策略清理截图/录屏，返回删了哪些、释放了多少 */
function POST_CAPTURE_PRUNE(params: { policies: CapturePrunePolicy[] }): Promise<CapturePruneResult> {
  return invoke<CapturePruneResult>(CHANNELS.CAPTURE.PRUNE, { params })
}

function POST_CAPTURE_OPEN(): Promise<void> {
  return invoke(CHANNELS.CAPTURE.OPEN)
}

function POST_CAPTURE_CLOSE(): Promise<void> {
  return invoke(CHANNELS.CAPTURE.CLOSE)
}

/** 注册 / 注销全局快捷键（传 `accelerator` 注册，传 `release` 注销） */
function POST_CAPTURE_HOTKEY(params: {
  accelerator: string | null
  release: string | null
}): Promise<void> {
  return invoke(CHANNELS.CAPTURE.HOTKEY, { params })
}

export {
  POST_OVERLAY_ENSURE,
  fetchImageFromPath,
  DELETE_OVERLAY,
  POST_OVERLAY_TILE,
  POST_CAPTURE_READY,
  PUT_OVERLAY_PARK,
  GET_CAPTURE_ELEMENTS,
  GET_CAPTURE_CURSOR,
  GET_CAPTURE_VIEWPORT,
  POST_CAPTURE_REFRESH,
  DELETE_OVERLAY_TILE,
  GET_CAPTURE_PENDING,
  POST_CAPTURE_SCREENSHOT,
  POST_CAPTURE_CLOSE,
  POST_CAPTURE_HOTKEY,
  POST_CAPTURE_OCR,
  POST_CAPTURE_OPEN,
  POST_CAPTURE_PIN_TEXTURE,
  POST_CAPTURE_PRUNE,
  POST_CAPTURE_SAVE_PNG,
  PUT_OVERLAY_MODE
}
export type {
  CapturePrunePolicy,
  CapturePruneResult,
  CaptureRect,
  CaptureRegion,
  MountOverlayOptions,
  ScreenshotResult
}
