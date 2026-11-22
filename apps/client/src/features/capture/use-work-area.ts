import { useEffect, useState } from 'react'

import { GET_CAPTURE_VIEWPORT, type CaptureRect } from '@/features/capture/tauri'

/**
 * 这次截屏会话的可用矩形（overlay 局部 CSS 像素，已扣掉任务栏）。
 *
 * 浮层是按监视器**物理矩形**铺满的（含任务栏那条），而任务栏常驻 topmost、永远压在浮层上面，
 * 所以任何贴边的东西（跟随选区的工具栏、取字面板、加载角标）都不能拿 `innerWidth/innerHeight`
 * 当边界。任务栏自动隐藏时 RUST 侧还会再扣掉它探出来的那条（见 `ui/taskbar.rs`）。
 *
 * 读不到（窗口还没建好 / 多屏切换瞬间）返回 `null`，调用方退回整屏 —— 宁可贴边，不能不显示。
 */
function useCaptureWorkArea(): CaptureRect | null {
  const [work, setWork] = useState<CaptureRect | null>(null)

  useEffect(function () {
    let alive = true
    void GET_CAPTURE_VIEWPORT()
      .then(function (rect) {
        if (alive && rect) setWork(rect)
      })
      .catch(function (error: unknown) {
        console.warn('[capture] 读取可用区失败，贴边浮层按整屏定位', error)
      })
    return function () {
      alive = false
    }
  }, [])

  return work
}

export { useCaptureWorkArea }
