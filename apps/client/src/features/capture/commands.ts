/**
 * 截屏命令接线。
 *
 * 全局键（OS 级 `Alt+Q`）与插件入口最终都落到 `capture.screenshot` 这一个命令上。
 * 旧代码里磁贴还额外注册了一个处理器来「接管」这个键，但它做的事情与这里的兜底
 * **完全一样**（都是 `capture:open`），属于新旧两条路并存 —— 已删。
 */

import { invoke } from '@tauri-apps/api/core'
import { useEffect } from 'react'
import { toast } from 'sonner'

import { runCapturePrune } from '@/features/capture/retention'
import { SHORTCUT_COMMAND } from '@/keyboard/definitions'
import { isMainWindow } from '@/keyboard/global'
import { useCommands } from '@/keyboard/react'
import type { Command } from '@/keyboard/types'
import { CHANNELS } from '@/shared/ipc/channels'
import { reportCaught } from '@/utils/exception-report'

async function openCapture(): Promise<void> {
  try {
    await invoke(CHANNELS.CAPTURE.OPEN)
  } catch (error) {
    reportCaught('capture.open', error)
    const text = error instanceof Error ? error.message : String(error)
    toast.error(`截屏没能打开：${text}`)
  }
}

const CAPTURE_COMMANDS: Command[] = [
  {
    id: SHORTCUT_COMMAND.CAPTURE_SCREENSHOT,
    title: '截屏',
    keywords: 'screenshot capture',
    group: '截屏',
    run: openCapture
  }
]

/** 主窗常驻：登记截屏命令 + 顺手跑一次留存清理 */
function useCaptureCommands(): void {
  useCommands(CAPTURE_COMMANDS)

  useEffect(function () {
    // 只在主窗跑：overlay 与磁贴窗不重复清理
    if (!isMainWindow()) return
    void runCapturePrune({ silent: true })
  }, [])
}

export { CAPTURE_COMMANDS, openCapture, useCaptureCommands }
