import { Command } from 'commander'

import { logger } from '../../core/logger.ts'
import { hasTty, promptSelect } from '../../core/prompt.ts'
import type { CommandModule } from '../../core/registry.ts'
import { hasLockPin, readToolsLock } from './infra/lock.ts'
import { findOnlineTools, verifyOnlineTool } from './infra/manifest.ts'
import { findPlatformKey } from './infra/platform.ts'
import { hasTool, stageVendoredTools } from './infra/stage.ts'
import { verifyStagedDir } from './infra/verify.ts'
import { TARGETS, findTarget, targetKeys } from './targets/catalog.ts'
import { TOOLS, findTool } from './tools/catalog.ts'

function findAppKeysText(): string {
  return targetKeys().join('|')
}

/** 优先位置参数 app；`--app` 为备用（经 pnpm 传参时可能需加 `--`）。 */
async function parseApp(positional?: string, optionApp?: string): Promise<string> {
  const raw = positional || optionApp
  if (raw) {
    if (TARGETS[raw]) {
      return raw
    }
    throw new Error(`[sidecar] 无效应用 "${raw}"（可选: ${findAppKeysText()}）`)
  }

  if (!hasTty()) {
    throw new Error(
      `[sidecar] 非交互环境必须指定应用: pnpm command sidecar <动作> <${findAppKeysText()}>`
    )
  }

  return promptSelect(
    '选择 sidecar 目标应用',
    targetKeys().map(function (id) {
      return { name: id, value: id }
    })
  )
}

async function ensureTool(toolKey: string): Promise<void> {
  await findTool(toolKey).ensure(findPlatformKey())
}

function isRequiredTool(toolKey: string, app: string): boolean {
  // corex 归档（含 mcp）+ pdfium 运行时：client / studio 都硬依赖
  if (toolKey === 'corex' || toolKey === 'pdfium') {
    return true
  }
  // client 另需 goose ACP 侧车（build.rs / externalBin）
  return app === 'client' && toolKey === 'goose'
}

async function runBootstrap(app: string): Promise<void> {
  const key = findPlatformKey()
  const lock = readToolsLock()
  const target = findTarget(app)

  for (const tool of Object.values(TOOLS)) {
    if (!hasTool(target, tool.key)) {
      console.log(`[sidecar] 跳过 ${tool.key}（${app} 用不到）`)
      continue
    }
    if (!hasLockPin(lock, tool.key, key)) {
      if (isRequiredTool(tool.key, app)) {
        throw new Error(`[sidecar] 当前平台无 ${tool.key} 钉死版本: ${key}（应用=${app}）`)
      }
      continue
    }
    await tool.ensure(key)
  }

  await stageVendoredTools(target, key)
  verifyStagedDir(target.findStagedDir(key), app, key)
  logger.success(`[sidecar] 引导完成（${app}）`)
}

async function runStage(app: string): Promise<void> {
  const target = findTarget(app)
  await stageVendoredTools(target, findPlatformKey())
}

async function runVerify(app: string): Promise<void> {
  const target = findTarget(app)
  const key = findPlatformKey()
  verifyStagedDir(target.findStagedDir(key), app, key)
}

function registerAppAction(
  parent: Command,
  name: string,
  description: string,
  run: (app: string) => Promise<void>
): void {
  const appsLabel = findAppKeysText()
  parent
    .command(name)
    .description(description)
    .argument(`[app]`, `目标应用（${appsLabel}）`)
    .option('--app <id>', `同位置参数 app（${appsLabel}）`)
    .action(async function (appArg: string | undefined, opts: { app?: string }) {
      const app = await parseApp(appArg, opts.app)
      await run(app)
    })
}

const SidecarCommand: CommandModule = {
  name: 'sidecar',
  description: '侧车工具下载 / 落盘 / 校验（按应用目标）',
  register(program) {
    const appsLabel = findAppKeysText()
    const sidecar = program
      .command('sidecar')
      .description(`侧车工具：下载、落盘、校验（${appsLabel}）`)
      .addHelpText(
        'after',
        `
按需工具（tools.lock 里标 onDemand 的：pandoc / ffmpeg / opencode）一并落盘；
「带不带进安装包」是打包侧的事（studio 的 SIDECAR_VARIANT，默认精简版），
所以切档不用重跑 bootstrap。在线包清单见 apps/studio/sidecar/manifest.json。

完整 corex 包需含 corex-mcp（+ win32 pdfium.dll）。本地联调可设 COREX_LOCAL_BIN。

示例:
  pnpm command sidecar bootstrap studio
  pnpm command sidecar manifest --verify
  pnpm command sidecar bootstrap client
  pnpm sidecar stage studio
  pnpm command sidecar verify client
  pnpm command sidecar corex
  pnpm command sidecar goose
  pnpm sidecar bootstrap -- --app studio
  set COREX_LOCAL_BIN=D:\\path\\to\\corex\\release && pnpm command sidecar bootstrap client
`
      )

    registerAppAction(sidecar, 'bootstrap', '按 lock 拉取工具 → 落盘 → 校验', runBootstrap)
    registerAppAction(sidecar, 'stage', '将已缓存工具拷贝到应用目录', runStage)
    registerAppAction(sidecar, 'verify', '校验落盘目录校验和', runVerify)

    sidecar
      .command('manifest')
      .description('在线包清单（studio 的 manifest.json）：打印当前平台声明，可选下载核对')
      .option('--verify', '真的下载并核 sha256（几十 ~ 几百 MB，缓存命中时不走网络）')
      .action(async function (opts: { verify?: boolean }) {
        const key = findPlatformKey()
        const tools = findOnlineTools(key)
        if (tools.length === 0) {
          console.log(`[manifest] ${key} 没有声明任何在线包（精简版在这台机器上无法下载工具）`)
          return
        }
        for (const item of tools) {
          console.log(`[manifest] ${item.key} ${item.tool.version} → ${item.package.url}`)
        }
        if (!opts.verify) {
          console.log('[manifest] 加上 --verify 可以下载并核对 sha256')
          return
        }
        for (const item of tools) {
          await verifyOnlineTool(item.key, item.package, key)
        }
        logger.success(`[manifest] ${key} 的 ${tools.length} 个在线包均与 manifest 一致`)
      })

    for (const toolKey of Object.keys(TOOLS)) {
      sidecar
        .command(toolKey)
        .description(`仅确保 ${toolKey} 进入共享下载缓存`)
        .action(async function () {
          await ensureTool(toolKey)
        })
    }
  }
}

export { SidecarCommand }
