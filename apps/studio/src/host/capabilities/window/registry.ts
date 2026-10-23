import { BrowserWindow } from 'electron'

import { LAZY_WINDOW_KEYS, type LazyWindowKey } from '@/shared/windows'
import type { Context } from '@/host/framework/context'
import {
  attachLifecycle,
  buildWebPreferences,
  findBundlePaths,
  toRedirect,
  TITLE_BAR_OVERLAY
} from './factory'

/**
 * 按需创建的子窗口注册表。
 *
 * 规格表是窗口的**唯一声明处**：建窗、窗口复用、日志名、加载路由、IPC 分派全从这里派生。
 * 以前每加一个窗口要手抄四遍同一份事实（capabilities 端口 + channels + specs + api + preload），
 * 抄漏一处就是运行时白屏。
 *
 * 这些窗口**不是主窗口的子窗口**（刻意不传 `parent`）：Windows 上子窗口会跟着父窗口一起
 * 最小化，而且没有自己的任务栏按钮 —— 而「主窗口收起来、子窗口继续干活」正是它们的用法。
 */

interface WindowSpec {
  title: string
  /** 渲染侧 Hash 路由路径，如 `/agent/chat` */
  hash: string
  /** 建窗尺寸；`min*` 为拖拽下限 */
  size: { width: number; height: number; minWidth: number; minHeight: number }
}

const WINDOW_SPECS = {
  agent: {
    title: 'cogito · Agent',
    hash: '/agent/chat',
    size: { width: 960, height: 720, minWidth: 640, minHeight: 480 }
  },
  directive: {
    title: 'cogito · 指令',
    hash: '/directive',
    size: { width: 1160, height: 780, minWidth: 820, minHeight: 600 }
  }
} as const satisfies Record<LazyWindowKey, WindowSpec>

/** 一个按需窗口的端口：窗口引用归端口独占，外部只表达「打开」这个意图 */
interface WindowPort {
  /** 已开则聚焦（顺带从最小化恢复），未开则创建 */
  toOpen(): void
}

type WindowPorts = Record<LazyWindowKey, WindowPort>

function buildWindow(ctx: Context, key: LazyWindowKey): BrowserWindow {
  const spec = WINDOW_SPECS[key]
  const paths = findBundlePaths()

  const win = new BrowserWindow({
    ...spec.size,
    show: false,
    center: true,
    title: spec.title,
    frame: true,
    backgroundMaterial: 'mica',
    titleBarStyle: 'hidden',
    titleBarOverlay: TITLE_BAR_OVERLAY,
    icon: paths.iconPath,
    webPreferences: buildWebPreferences(ctx, paths.preloadPath)
  })

  const log = ctx.logger.child('window').child(key)
  attachLifecycle(ctx, win, log)
  toRedirect(win, paths.route, spec.hash)

  log.info('window created')
  return win
}

function buildWindowPort(ctx: Context, key: LazyWindowKey): WindowPort {
  let win: BrowserWindow | null = null

  return {
    toOpen() {
      const existing = win
      if (existing && !existing.isDestroyed()) {
        if (existing.isMinimized()) existing.restore()
        existing.focus()
        return
      }

      const created = buildWindow(ctx, key)
      win = created
      win.on('closed', function () {
        if (win === created) win = null
      })
    }
  }
}

/** 组合根调用：建好全部端口后交给 IPC 分派与托盘 */
function buildWindowPorts(ctx: Context): WindowPorts {
  return Object.fromEntries(
    LAZY_WINDOW_KEYS.map(function (key) {
      return [key, buildWindowPort(ctx, key)]
    })
  ) as WindowPorts
}

export { buildWindowPorts }
export type { WindowPort, WindowPorts }
