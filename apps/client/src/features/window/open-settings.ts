import { emit } from '@tauri-apps/api/event'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { toast } from 'sonner'

import { findTileWindowOptions } from '@/constants/magnetic-tile/window'
import { openWindow } from '@/features/window/open'
import { reportCaught } from '@/utils/exception-report'
import type { SectionKey } from '@/views/settings/constant'

/** 程序化打开全局设置窗时的固定 label（与磁贴窗 `settings:<id>` 分离） */
const SETTINGS_WINDOW_LABEL = 'settings:global'

const SETTINGS_NAVIGATE_EVENT = 'settings:navigate'

interface SettingsNavigatePayload {
  section: SectionKey
}

/**
 * 打开全局设置窗；已存在则聚焦并广播目标分区（壳层监听后切换）。
 */
async function openSettingsWindow(section?: SectionKey) {
  const target = section ?? 'account'
  const route = `/settings?section=${encodeURIComponent(target)}`

  try {
    const existing = await WebviewWindow.getByLabel(SETTINGS_WINDOW_LABEL)
    if (existing) {
      await emit(SETTINGS_NAVIGATE_EVENT, { section: target } satisfies SettingsNavigatePayload)
      await existing.setFocus()
      return existing
    }

    return await openWindow(
      SETTINGS_WINDOW_LABEL,
      route,
      '设置',
      findTileWindowOptions('settings')
    )
  } catch (error) {
    reportCaught('settings.openWindow', error)
    toast.error('设置窗口打开失败')
    return null
  }
}

export { openSettingsWindow, SETTINGS_NAVIGATE_EVENT, SETTINGS_WINDOW_LABEL }
export type { SettingsNavigatePayload }
