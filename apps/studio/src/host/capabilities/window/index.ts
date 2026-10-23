import { BrowserWindow } from 'electron'

import { type Context } from '@/host/framework/context'
import { type Plugin } from '@/host/framework/module'
import { type OverlayWindowPort } from '@/host/capabilities/overlay/window-port'
import {
  attachLifecycle,
  buildWebPreferences,
  findBundlePaths,
  toRedirect,
  TITLE_BAR_OVERLAY
} from './factory'

/**
 * 主窗口的端口。
 *
 * 托盘、「二次启动」、以及需要主窗口作宿主的功能（对话框 parent、更新事件推送）都从这里取，
 * 而窗口引用只在 window 插件内部流转 —— 单一持有者，不再出现插件与 ctx 两份状态对不上的情况。
 *
 * 主窗口运行时**只会被隐藏、不会被销毁**（关闭 = 收进托盘），所以这里不需要「重建窗口」那条路。
 */
interface MainWindowPort {
  /** 主窗口引用；未建或已销毁时为 null */
  toRead(): BrowserWindow | null
  /** 显示并聚焦主窗口（最小化则先恢复） */
  toReveal(): void
}

interface WindowPlugin extends Plugin {
  /** 供给托盘 / 二次启动 / 对话框宿主 */
  mainWindow: MainWindowPort
}

function buildPlugin(overlay: OverlayWindowPort): WindowPlugin {
  /** 真退出时才放行关闭；否则「关闭」= 收进托盘（托盘里有「退出」） */
  let isQuitting = false
  let mainWindow: BrowserWindow | null = null

  function toReadMainWindow(): BrowserWindow | null {
    const win = mainWindow
    return win && !win.isDestroyed() ? win : null
  }

  const mainWindowPort: MainWindowPort = {
    toRead: toReadMainWindow,

    toReveal() {
      const win = toReadMainWindow()
      if (!win) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  }

  return {
    name: 'window',
    mainWindow: mainWindowPort,
    register(ctx: Context) {
      const log = ctx.logger.child('window')
      const paths = findBundlePaths()

      ctx.app.on('before-quit', function () {
        isQuitting = true
      })

      if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
        try {
          const origin = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin
          ctx.toUpdateOrigins([origin])
        } catch (error) {
          console.warn('[window] VITE_DEV_SERVER_URL 不是合法 URL，不放开任何 origin', error)
          ctx.toUpdateOrigins([])
        }
      }

      function buildMainWindow() {
        const win = new BrowserWindow({
          width: 1200,
          height: 800,
          minWidth: 800,
          minHeight: 600,
          show: false,
          fullscreen: false,
          minimizable: true,
          maximizable: true,
          resizable: true,
          transparent: false,
          center: true,
          hasShadow: true,
          backgroundColor: '#00000000',
          title: 'cogito',
          frame: true,
          backgroundMaterial: 'mica',
          titleBarStyle: 'hidden',
          titleBarOverlay: TITLE_BAR_OVERLAY,
          icon: paths.iconPath,
          webPreferences: buildWebPreferences(ctx, paths.preloadPath)
        })

        mainWindow = win

        // 必须先于 attachLifecycle 注册：它按注册顺序跑，而它要在同一次 close 里
        // 看到 `event.defaultPrevented` 才不撤信任（撤了这窗口就再也发不出 IPC）
        win.on('close', function (event) {
          if (isQuitting) return
          event.preventDefault()
          win.hide()
        })

        attachLifecycle(ctx, win, log)
        toRedirect(win, paths.route)

        win.on('closed', function () {
          if (mainWindow === win) mainWindow = null
        })

        log.info('main window created')
        return win
      }

      ctx.app.on('window-all-closed', function () {
        if (process.platform !== 'darwin') ctx.app.quit()
      })

      ctx.app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) {
          buildMainWindow()
          overlay.toCreate()
        }
      })

      buildMainWindow()
      overlay.toCreate()
    }
  }
}

export { buildPlugin }
export type { MainWindowPort, WindowPlugin }
