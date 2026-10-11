import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { CHANNELS } from '@/shared/ipc/channels'

import type { SurfaceStyleInput } from '@/features/magnetic-tile/surface-style'
import type { MarkerLayout } from '@/features/magnetic-tile/size'
import type { CaptureRegion } from '@/features/capture/region'

/**
 * Tauri 截图能力的轻量封装，前端通过这些函数与 Rust 端的
 * `capture:*` 命令通信。
 */

interface ScreenshotResult {
  /** 截图保存后的磁盘绝对路径 */
  path: string
  width: number
  height: number
  scale_factor: number
  regions?: CaptureRegion[]
}

interface MountOverlayOptions extends Partial<MarkerLayout>, SurfaceStyleInput {
  title?: string
  mark?: string | null
}

/** 主显示器即时截图（不弹窗，返回截图文件路径） */
async function takeScreenshot(): Promise<ScreenshotResult> {
  return invoke<ScreenshotResult>(CHANNELS.CAPTURE.SCREENSHOT)
}

/** 消费 capture:open 预截好的结果；无则返回 null */
async function takePendingScreenshot(): Promise<ScreenshotResult | null> {
  return invoke<ScreenshotResult | null>(CHANNELS.CAPTURE.TAKE_PENDING)
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

async function ensureOverlay(): Promise<void> {
  await invoke(CHANNELS.OVERLAY.ENSURE)
}

async function hideOverlay(): Promise<void> {
  await invoke(CHANNELS.OVERLAY.HIDE)
}

async function updateOverlayMode(mode: 'idle' | 'screenshot'): Promise<void> {
  await invoke(CHANNELS.OVERLAY.UPDATE_MODE, { mode })
}

/** 主窗磁贴右键「浮层 → 添加」 */
async function mountOverlayTile(
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
      mark: options?.mark ?? null
    }
  })
}

/** 主窗 / 浮层「移除」共用 */
async function removeOverlayTile(magneticTileID: string): Promise<void> {
  await invoke(CHANNELS.OVERLAY.UNMOUNT, {
    payload: { magneticTileID }
  })
}

export {
  ensureOverlay,
  fetchImageFromPath,
  hideOverlay,
  mountOverlayTile,
  removeOverlayTile,
  takePendingScreenshot,
  takeScreenshot,
  updateOverlayMode
}
export type { CaptureRegion, MountOverlayOptions, ScreenshotResult }
