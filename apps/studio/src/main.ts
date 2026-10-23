import { app, type BrowserWindow } from 'electron'
import path from 'node:path'

import { disposeEngine } from '@/host/capabilities/assistant'
import { buildPlugin as buildCapturePlugin } from '@/host/capabilities/capture'
import { buildPlugin as buildDatabasePlugin } from '@/host/capabilities/database'
import { buildThroughHost } from '@/host/capabilities/overlay/through'
import { buildOverlayWindowPort } from '@/host/capabilities/overlay/window-port'
import { buildPlugin as buildSecurityPlugin } from '@/host/capabilities/security'
import { buildPlugin as buildSidecarPlugin, CorexHost } from '@/host/capabilities/sidecar'
import { buildPlugin as buildWindowPlugin } from '@/host/capabilities/window'
import { buildWindowPorts } from '@/host/capabilities/window/registry'
import { buildPlugin as buildTrayPlugin } from '@/host/capabilities/window/tray'
import { buildContext } from '@/host/framework/context'
import { attachFileLog } from '@/host/framework/log-file'
import { buildLogger } from '@/host/framework/logger'
import type { Plugin } from '@/host/framework/module'
import { registerStudioIpc } from '@/host/ipc'
import {
  acquireSingleInstanceLock,
  attachSecondInstanceFocus
} from '@/host/lifecycle/single-instance'

/** 日志目录取不到就退回 stdout：取证少一份，但不能因此起不来 */
function findDataDir(): string | null {
  try {
    return app.getPath('userData')
  } catch (error) {
    console.warn('[bootstrap] 取不到 userData，日志只进 stdout', error)
    return null
  }
}

export async function bootstrap(): Promise<void> {
  const log = buildLogger('bootstrap')

  // 落盘越早越好：内存里的那份终端输出，用户报障时早就滚没了（排查时只有它能还原现场）
  const dataDir = findDataDir()
  const detachFileLog = dataDir ? attachFileLog(dataDir) : function () {}
  if (dataDir) log.info('日志文件', { dir: path.join(dataDir, 'logs') })

  if (!acquireSingleInstanceLock(app)) {
    log.info('another instance holds the lock; quitting')

    return app.quit()
  }

  // 与 forge/constants APP_AUMID / appId 一致（已离开 com.squirrel.*）
  if (process.platform === 'win32') app.setAppUserModelId('com.cogito.studio')

  process.on('uncaughtException', function (err) {
    log.error('uncaughtException', err)
  })
  process.on('unhandledRejection', function (reason) {
    log.error('unhandledRejection', reason)
  })

  // findWindow 在 ctx 建好后绑定；二次启动可能早于建窗，focus 为 no-op
  let findWindow: () => BrowserWindow | null = function () {
    return null
  }

  attachSecondInstanceFocus(app, findWindow)

  await app.whenReady()

  // 打包后为 app.asar / app 目录；开发为 apps/studio
  const appPath = app.getAppPath()
  process.env.APP_ROOT = appPath
  process.env.VITE_PUBLIC = path.join(appPath, 'public')

  const ctx = buildContext()
  // sidecar 宿主由组合根建好后交给使用者（插件与 IPC 分派），framework 不认识它
  const corex = new CorexHost(ctx.logger)

  // 窗口端口在组合根一次建好，再分发给三个消费者：IPC 分派、托盘、二次启动聚焦。
  // 端口构造无副作用（真正建窗在插件 register 里），所以能先于插件循环创建。
  const overlayPort = buildOverlayWindowPort(ctx)
  const through = buildThroughHost(function () {
    return overlayPort.findWindow()
  })
  const capturePlugin = buildCapturePlugin(corex, overlayPort, through)
  const captureService = { current: null as ReturnType<typeof buildCapturePlugin>['service'] }
  const windows = buildWindowPorts(ctx)
  const windowPlugin = buildWindowPlugin(overlayPort)

  findWindow = windowPlugin.mainWindow.toRead

  // IPC **必须先于插件循环注册**：window 插件会 loadURL，渲染进程随即 invoke；
  // 注册晚一拍会让首个 store:toRead 失败，而 /agent 在 loaded=false 时永远渲染 null（白屏）。
  const ipc = registerStudioIpc(ctx.ipc, {
    ctx,
    sidecar: corex,
    overlay: overlayPort,
    windows,
    mainWindow: windowPlugin.mainWindow,
    through,
    captureService
  })

  // 插件只负责生命周期（安全会话 / 关库 / 建窗 / 起 sidecar）；
  // 频道注册已由 IPC 装配层遍历契约完成
  const plugins: Plugin[] = [
    buildSecurityPlugin(),
    buildDatabasePlugin(),
    windowPlugin,
    buildSidecarPlugin(corex),
    capturePlugin,
    // 托盘放在最后：它要用主窗口端口把窗口叫回来
    buildTrayPlugin({ mainWindow: windowPlugin.mainWindow, agentWindow: windows.agent })
  ]

  try {
    for (const plugin of plugins) {
      await plugin.register(ctx)
      if (plugin === capturePlugin) {
        captureService.current = capturePlugin.service
      }
      log.info(`plugin registered: ${plugin.name}`)
    }
  } catch (error) {
    log.error('plugin registration failed', error)
    if (!windowPlugin.mainWindow.toRead()) return app.exit(1)
  }

  let isDisposing = false
  app.on('before-quit', function (event) {
    if (isDisposing) return
    event.preventDefault()
    isDisposing = true

    async function disposePlugins() {
      for (const plugin of [...plugins].reverse()) {
        if (!plugin.dispose) continue
        try {
          await plugin.dispose()
        } catch (error) {
          log.error(`dispose failed: ${plugin.name}`, error)
        }
      }

      // 拆除全部 owned 频道（LIFO，只拆自己注册的）
      try {
        ipc.dispose()
      } catch (error) {
        log.error('ipc dispose failed', error)
      }

      try {
        through.dispose()
      } catch (error) {
        log.error('through dispose failed', error)
      }

      // 内嵌 opencode server 不属于任何插件（它活在整个应用生命周期），单独收尾：
      // Windows 上父进程退出不会带走子进程，不显式停就会在后台留下孤儿进程
      try {
        await disposeEngine()
      } catch (error) {
        log.error('opencode engine dispose failed', error)
      }

      // 收尾日志写完之后再摘出口，避免最后几行（尤其是报错）留在内存里
      detachFileLog()

      app.exit(0)
    }

    void disposePlugins()
  })

  log.info('studio ready', {
    appPath,
    isDev: ctx.isDev
  })
}

void bootstrap()
