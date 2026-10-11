import { invoke } from '@tauri-apps/api/core'
import { ask } from '@tauri-apps/plugin-dialog'
import { check } from '@tauri-apps/plugin-updater'
import { toast } from 'sonner'
import { CHANNELS } from '@/shared/ipc/channels'

import { relaunchApp } from '@/utils/process'

/**
 * 已发现的可用版本（标题栏「可更新」状态芯片的数据源）。
 *
 * `checkUpdate` 弹窗询问、`autoCheckUpdate` 静默检查都会写这里；用户点「稍后」时保留，
 * 芯片因此成了不打扰的提醒 —— 想再装就点芯片。
 */
let pendingVersion: string | null = null
const statusListeners = new Set<() => void>()

function setPendingVersion(version: string | null) {
  if (pendingVersion === version) return
  pendingVersion = version
  for (const listener of statusListeners) listener()
}

function findPendingUpdateVersion() {
  return pendingVersion
}

function subscribeUpdateStatus(listener: () => void) {
  statusListeners.add(listener)
  return function () {
    statusListeners.delete(listener)
  }
}

/** 忽略本次提醒；下次检查发现更新会重新出现 */
function dismissPendingUpdate() {
  setPendingVersion(null)
}

async function prepareUpdate() {
  try {
    await invoke(CHANNELS.SIDECAR.SHUTDOWN)
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    console.warn('[updater] sidecar:shutdown failed (NSIS hook will retry):', text)
  }
}

/** 主动检查：发现更新即弹窗询问是否安装（托盘菜单 / 设置页 / 状态芯片走这里） */
async function checkUpdate() {
  try {
    const update = await check()
    if (!update) {
      setPendingVersion(null)
      toast.info('当前已是最新版本')
      return
    }

    setPendingVersion(update.version)
    const confirmed = await ask(
      `发现新版本 ${update.version}${update.body ? `\n\n${update.body}` : ''}\n\n是否下载并安装？`,
      {
        title: '检查更新',
        kind: 'info',
        okLabel: '安装',
        cancelLabel: '稍后'
      }
    )

    if (!confirmed) return

    toast.loading('正在准备更新…', { id: 'updater' })
    await prepareUpdate()

    toast.loading('正在下载更新…', { id: 'updater' })
    await update.downloadAndInstall()
    toast.dismiss('updater')
    toast.success('更新已安装，即将重启')
    await relaunchApp()
  } catch (error) {
    toast.dismiss('updater')
    const text = error instanceof Error ? error.message : String(error)
    toast.info(`更新失败：${text}`)
  }
}

/** 静默检查：只更新状态芯片，不弹窗、不打扰（启动时用） */
async function autoCheckUpdate() {
  try {
    const update = await check()
    setPendingVersion(update ? update.version : null)
  } catch (error) {
    // 离线、未配置更新端点等都可能失败，静默检查不打扰用户
    console.warn('[updater] 自动检查更新失败', error)
  }
}

export {
  autoCheckUpdate,
  checkUpdate,
  dismissPendingUpdate,
  findPendingUpdateVersion,
  subscribeUpdateStatus
}
