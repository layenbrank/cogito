#!/usr/bin/env node
/**
 * 带**侧车档位** / 可选 makers 跑 electron-forge。
 *
 *   node scripts/run-forge.ts <package|make|publish> [lite|full] [--wix] [--msix] [--flatpak] [...forge 参数]
 *
 * 为什么要这个 runner：档位与可选 makers 经环境变量传给 `forge/env.ts`，而
 * `VAR=value electron-forge …` 这种前置赋值在 Windows 的 cmd/pwsh 里不成立（仓库不引 cross-env）。
 * 解析 `@electron-forge/cli` 的 bin 后用当前 Node 起子进程，参数不经过 shell，两边都干净。
 *
 * 默认 lite：pandoc / ffmpeg / opencode 不进安装包，由 Studio 运行时在线下载。
 * Windows 默认 makers：NSIS Setup.exe + ZIP；`--wix` / `--msix` 额外开 MSI / MSIX
 * （需本机 WiX Toolset / Windows SDK，见 docs/apps/studio/packaging.md）。
 *
 * 本目录有 `package.json` `"type":"module"`，使 `node *.ts` 在 studio 根仍为 CJS 时能按 ESM 跑。
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

type SidecarVariant = 'lite' | 'full'
type ForgeAction = 'package' | 'make' | 'publish' | 'start'

interface ForgeCliPackage {
  bin?: string | Record<string, string>
}

const VARIANTS = new Set<string>(['lite', 'full'])
const ACTIONS = new Set<string>(['package', 'make', 'publish', 'start'])

/** runner 自用开关 → forge/env.ts 认的环境变量（不转给 electron-forge CLI） */
const MAKER_FLAGS: Record<string, string> = {
  '--wix': 'STUDIO_MAKE_WIX',
  '--msix': 'STUDIO_MAKE_MSIX',
  '--flatpak': 'STUDIO_MAKE_FLATPAK'
}

function isAction(value: string): value is ForgeAction {
  return ACTIONS.has(value)
}

function isVariant(value: string): value is SidecarVariant {
  return VARIANTS.has(value)
}

function findForgeBin(): string {
  const pkgPath = require.resolve('@electron-forge/cli/package.json')
  const pkg = require(pkgPath) as ForgeCliPackage
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.['electron-forge']
  if (!bin) {
    throw new Error('@electron-forge/cli 没声明 electron-forge bin')
  }
  return path.join(path.dirname(pkgPath), bin)
}

/** 当前 env 里 `candle` 是否已被 electron-wix-msi 那种 `candle -?` 探测认到。 */
function canRunCandle(env: NodeJS.ProcessEnv): boolean {
  // 用 spawnSync 而非 execSync：命令不存在时只返回 error，不必再用 catch 吞异常
  const probe = spawnSync('candle', ['-?'], { env, stdio: 'ignore', windowsHide: true })
  return probe.status === 0
}

/**
 * Windows 上 MakerWix 用 `execSync('candle -?')` 探测；Cursor / 旧终端常拿不到
 * 刚写进「用户 PATH」的 WiX。把常见安装目录 prepend 进传给 forge 的 PATH。
 */
function ensureWixOnPath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (process.platform !== 'win32') {
    return env
  }
  if (canRunCandle(env)) {
    return env
  }

  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
  const home = os.homedir()
  const candidates = [
    path.join(programFilesX86, 'WiX Toolset v3.14', 'bin'),
    path.join(programFilesX86, 'WiX Toolset v3.11', 'bin'),
    path.join(programFiles, 'WiX Toolset v3.14', 'bin'),
    // 安装器偶发写的 WIX=…\WiX Toolset v3.14\
    process.env.WIX ? path.join(process.env.WIX, 'bin') : '',
    path.join(home, 'AppData', 'Local', 'Programs', 'WiX Toolset v3.14', 'bin')
  ].filter(Boolean)

  for (const bin of candidates) {
    if (!existsSync(path.join(bin, 'candle.exe')) || !existsSync(path.join(bin, 'light.exe'))) {
      continue
    }
    const next = { ...env }
    // Windows 上 Node 可能同时有 Path / PATH；只改一个时另一个仍是旧值，
    // electron-wix-msi 的 execSync('candle -?') 会继续失败。
    const merged = `${bin}${path.delimiter}${next.Path ?? next.PATH ?? ''}`
    next.Path = merged
    next.PATH = merged
    // 部分工具认 WIX=安装根
    next.WIX = path.dirname(bin) + path.sep
    if (!canRunCandle(next)) {
      continue
    }
    console.log(`[forge] WiX 不在当前 PATH，已注入: ${bin}`)
    return next
  }

  console.warn(
    '[forge] 未找到 candle.exe / light.exe。请安装 WiX Toolset v3.14，或把其 bin 写进 PATH（见 docs/apps/studio/packaging.md）'
  )
  return env
}

function main(): void {
  const [, , action, ...rest] = process.argv
  if (!action || !isAction(action)) {
    console.error(
      `用法: node scripts/run-forge.ts <${[...ACTIONS].join('|')}> [lite|full] [--wix|--msix|--flatpak] [...参数]`
    )
    process.exit(1)
  }

  let variant: SidecarVariant = 'lite'
  if (rest[0] !== undefined && isVariant(rest[0])) {
    variant = rest[0]
    rest.shift()
  }

  const makerEnv: Record<string, string> = {}
  const forgeArgs: string[] = []
  for (const arg of rest) {
    const envName = MAKER_FLAGS[arg]
    if (envName) {
      makerEnv[envName] = '1'
      continue
    }
    forgeArgs.push(arg)
  }

  const enabledMakers = Object.keys(makerEnv)
  if (enabledMakers.length) {
    console.log(`[forge] 额外 makers: ${enabledMakers.join(', ')}`)
  }

  let childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    STUDIO_SIDECAR_VARIANT: variant,
    ...makerEnv
  }
  // NSIS maker 经 app-builder 拉 nsis-*.7z；国内默认走 npmmirror（与 ELECTRON_MIRROR 同理）
  if (!childEnv.ELECTRON_BUILDER_BINARIES_MIRROR?.trim()) {
    childEnv.ELECTRON_BUILDER_BINARIES_MIRROR =
      'https://npmmirror.com/mirrors/electron-builder-binaries/'
  }
  if (makerEnv.STUDIO_MAKE_WIX) {
    childEnv = ensureWixOnPath(childEnv)
  }

  const result = spawnSync(process.execPath, [findForgeBin(), action, ...forgeArgs], {
    stdio: 'inherit',
    env: childEnv,
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  })

  console.log(`[forge] 侧车档位: ${variant}`)
  process.exit(result.status ?? 1)
}

main()
