import { existsSync } from 'node:fs'
import path from 'node:path'
import type { ForgeConfig } from '@electron-forge/shared-types'

import {
  APP_EXECUTABLE,
  APP_ID,
  APP_NAME,
  APP_VERSION,
  PACKAGE_ROOT
} from './constants'
import {
  APPLE_ID,
  APPLE_ID_PASSWORD,
  APPLE_TEAM_ID,
  OSX_NOTARIZE,
  OSX_SIGN,
  WINDOWS_CERTIFICATE_FILE,
  WINDOWS_CERTIFICATE_PASSWORD,
  WINDOWS_CERTIFICATE_SUBJECT
} from './env'
import { copyAndVerifySidecars } from './hooks/sidecar'
import { copyExternalDependencies } from './hooks/external-deps'

/** 国内默认镜像；Turbo strict 下需 turbo.json globalPassThroughEnv 透传 ELECTRON_MIRROR */
const ELECTRON_DOWNLOAD_MIRROR =
  process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/'

/**
 * Vite 已打包业务与 workspace 依赖；asar 保留：
 * - `.vite/` 构建产物
 * - `package.json`
 * - `drizzle/`（迁移 SQL + meta/journal，运行时 migrator 要读）
 * - `node_modules/`（external 模块：better-sqlite3 及其依赖闭包需进 asar，
 *   因 Fuses OnlyLoadAppFromAsar 禁止从 asar 外加载）
 * 排除 `@cogito/*`：pnpm workspace 符号链接指向包外，asar 无法处理；
 * Vite 已将这些 workspace 依赖打包进 .vite/build/main.js
 * hoisted 到仓库根的 external 依赖与 native 侧车由 afterCopy 写入
 *
 * prune:false：跳过 flora-colossus（pnpm hoisted + 嵌套 apps/* 会误报缺依赖）
 */
function isIgnoredPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/')
  if (normalized === '' || normalized === '/') return false

  const keep = [
    /^\/\.vite(\/|$)/,
    /^\/package\.json$/,
    // 运行时 Drizzle migrator 需要读取 drizzle/migrations/（SQL + meta/journal）
    /^\/drizzle(\/|$)/,
    /^\/node_modules(\/(?!@cogito\/)|$)/
  ]
  if (keep.some(function (pattern) {
    return pattern.test(normalized)
  })) {
    return false
  }

  return true
}

function findIconPath(): string | undefined {
  const candidates = [
    path.join(PACKAGE_ROOT, 'resources', 'icon.ico'),
    path.join(PACKAGE_ROOT, 'resources', 'icon.icns'),
    path.join(PACKAGE_ROOT, 'resources', 'icon.png')
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

function findExtraResources(): string[] {
  const files = ['icon.ico', 'icon.png', 'icon.icns']
  const found: string[] = []
  for (const file of files) {
    const candidate = path.join(PACKAGE_ROOT, 'resources', file)
    if (existsSync(candidate)) found.push(candidate)
  }
  return found
}

function runAfterCopy(
  buildPath: string,
  electronVersion: string,
  platform: string,
  arch: string,
  done: (err?: Error) => void
): void {
  copyExternalDependencies(buildPath, electronVersion, platform, arch, function (err) {
    if (err) {
      done(err)
      return
    }
    copyAndVerifySidecars(buildPath, electronVersion, platform, arch, done)
  })
}

function buildWindowsSign():
  | NonNullable<ForgeConfig['packagerConfig']>['windowsSign']
  | undefined {
  if (WINDOWS_CERTIFICATE_FILE) {
    return {
      certificateFile: WINDOWS_CERTIFICATE_FILE,
      certificatePassword: WINDOWS_CERTIFICATE_PASSWORD
    }
  }
  // 证书存储：通过 signtool /n 按主题名选择
  if (WINDOWS_CERTIFICATE_SUBJECT) {
    return {
      signWithParams: `/n "${WINDOWS_CERTIFICATE_SUBJECT}"`
    }
  }
  return undefined
}

function buildOsxNotarize():
  | NonNullable<ForgeConfig['packagerConfig']>['osxNotarize']
  | undefined {
  if (!OSX_NOTARIZE) return undefined
  return {
    appleId: APPLE_ID!,
    appleIdPassword: APPLE_ID_PASSWORD!,
    teamId: APPLE_TEAM_ID!
  }
}

function buildPackagerConfig(): NonNullable<ForgeConfig['packagerConfig']> {
  const icon = findIconPath()
  const windowsSign = buildWindowsSign()
  const osxNotarize = buildOsxNotarize()

  return {
    asar: true,
    prune: false,
    overwrite: true,
    // 跳过临时目录中转，直接在 out/ 构建；避免 Windows Defender 锁 electron.exe 导致 rename EPERM
    tmpdir: false,
    appVersion: APP_VERSION,
    name: APP_NAME,
    executableName: APP_EXECUTABLE,
    appBundleId: APP_ID,
    appCategoryType: 'public.app-category.developer-tools',
    appCopyright: `Copyright © ${new Date().getFullYear()} cogito`,
    ignore: isIgnoredPath,
    extraResource: findExtraResources(),
    download: {
      mirrorOptions: {
        mirror: ELECTRON_DOWNLOAD_MIRROR
      }
    },
    ...(icon ? { icon } : {}),
    ...(windowsSign ? { windowsSign } : {}),
    ...(OSX_SIGN ? { osxSign: {} } : {}),
    ...(osxNotarize ? { osxNotarize } : {}),
    afterCopy: [runAfterCopy]
  }
}

export { buildPackagerConfig }
