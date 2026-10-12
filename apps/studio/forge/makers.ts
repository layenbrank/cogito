import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { MakerDeb } from '@electron-forge/maker-deb'
import { MakerDMG } from '@electron-forge/maker-dmg'
import { MakerFlatpak } from '@electron-forge/maker-flatpak'
import { MakerMSIX } from '@electron-forge/maker-msix'
import { MakerPKG } from '@electron-forge/maker-pkg'
import { MakerRpm } from '@electron-forge/maker-rpm'
import { MakerWix } from '@electron-forge/maker-wix'
import { MakerZIP } from '@electron-forge/maker-zip'
import MakerNSIS from '@felixrieseberg/electron-forge-maker-nsis'
import type { ForgeConfig } from '@electron-forge/shared-types'
import type { MSICreator } from 'electron-wix-msi/lib/creator'

const require = createRequire(import.meta.url)

import {
  APP_AUMID,
  APP_AUTHORS,
  APP_DESCRIPTION,
  APP_EXECUTABLE,
  APP_ID,
  APP_NAME,
  APP_PUBLISHER,
  PACKAGE_ROOT,
  PRODUCT_NAME,
  START_MENU_FOLDER,
  WIX_CULTURES,
  WIX_LANGUAGE,
  WIX_UPGRADE_CODE
} from './constants'
import {
  MAKE_FLATPAK,
  MAKE_MSIX,
  MAKE_PKG,
  MAKE_WIX,
  MSIX_IDENTITY,
  MSIX_PUBLISHER,
  S3_UPDATE_BASE,
  UPDATE_URL,
  WINDOWS_CERTIFICATE_FILE,
  WINDOWS_CERTIFICATE_PASSWORD
} from './env'

function findSetupIcon(): string | undefined {
  const ico = path.join(PACKAGE_ROOT, 'resources', 'icon.ico')
  return existsSync(ico) ? ico : undefined
}

function findNsisHooks(): string {
  return path.join(PACKAGE_ROOT, 'nsis', 'installer-hooks.nsh')
}

/**
 * 打包进 Forge 产物的 package.json 仍写着 pnpm `catalog:`；
 * app-builder-lib 无法从中解析 electron 版本，需显式注入。
 */
function findElectronVersion(): string {
  try {
    const pkgPath = require.resolve('electron/package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
    if (pkg.version) return pkg.version
    throw new Error(`electron/package.json 没写 version：${pkgPath}`)
  } catch (error) {
    // 原来这里直接吞掉原因，报错只剩一句「无法解析」，排查时看不出是哪一步失败。
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`[forge] 无法解析已安装的 electron 版本（NSIS maker 需要）：${reason}`)
  }
}

/** generic feed 目录：与运行时 findFeedUrl / Vite 注入一致 */
function findUpdaterFeedUrl(): string | undefined {
  if (UPDATE_URL) return UPDATE_URL.replace(/\/$/, '')
  if (!S3_UPDATE_BASE) return undefined
  return `${S3_UPDATE_BASE.replace(/\/$/, '')}/win32/x64`
}

/**
 * 修补 electron-wix-msi 默认 WXS 模板，使 `defaultInstallMode: perUser` 真能按当前用户安装。
 *
 * 上游同时写了 `InstallScope=perUser` 与 `MSIINSTALLPERUSER=1`。按微软单包双用途规则，
 * 带 InstallScope 时引擎会**删掉** MSIINSTALLPERUSER → SetProperty 永不跑（标题永远
 * `(Machine - MSI)`），且 ProgramFiles64 **不会**重定向到用户目录 → 非管理员 1303。
 * 残留/中断安装还可能表现为 2349。
 *
 * 修补：去掉 InstallScope（保留 MSIINSTALLPERUSER 做真正 per-user 重定向）、干净产品名、
 * MediaTemplate。目录仍用 ProgramFiles64（由 MSI 重定向到 `%LOCALAPPDATA%\Programs\…`）。
 */
function patchWixCreatorForPerUser(creator: MSICreator): void {
  let template = creator.wixTemplate

  template = template.replace(
    'Name = "{{ApplicationName}} (Machine - MSI)"',
    'Name = "{{ApplicationName}}"'
  )
  template = template.replace(
    'Value="{{ApplicationName}} (Machine)"',
    'Value="{{ApplicationName}}"'
  )
  // 标题已固定为产品名；去掉依赖 MSIINSTALLPERUSER 的 Machine/User 改名
  template = template.replace(
    /\s*<!-- Lets change the product name[\s\S]*?<\/SetProperty>\s*<!-- Again we give thee MSI[\s\S]*?<\/SetProperty>/,
    '\n'
  )
  // 去掉 InstallScope，否则 MSIINSTALLPERUSER 会被删、ProgramFiles 无法 per-user 重定向
  template = template.replace(/\s*InstallScope="\{\{PackageScope\}\}"/, '')
  // 双用途包：ALLUSERS=2 + MSIINSTALLPERUSER=1 → 默认 per-user 并重定向 ProgramFiles*
  if (!template.includes('Id="ALLUSERS"')) {
    template = template.replace(
      '<Property Id="MSIINSTALLPERUSER" Secure="yes" Value="{{InstallPerUser}}" />',
      '<Property Id="ALLUSERS" Secure="yes" Value="2" />\n    <Property Id="MSIINSTALLPERUSER" Secure="yes" Value="{{InstallPerUser}}" />'
    )
  }
  // 大 Electron 包用单 CAB 易在安装阶段触发 2349；MediaTemplate 可拆柜并提高压缩稳定性
  template = template.replace(
    '<Media Id="1" Cabinet="product.cab" EmbedCab="yes"/>',
    '<MediaTemplate EmbedCab="yes" CompressionLevel="high" />'
  )

  creator.wixTemplate = template
}

function buildMakers(): NonNullable<ForgeConfig['makers']> {
  const setupIcon = findSetupIcon()
  const displayName = PRODUCT_NAME || APP_NAME
  const feedUrl = findUpdaterFeedUrl()
  const makers: NonNullable<ForgeConfig['makers']> = [
    // Windows 默认：NSIS Setup.exe（对齐 Client Tauri NSIS 向导体验）+ ZIP 便携
    new MakerNSIS({
      ...(WINDOWS_CERTIFICATE_FILE
        ? {
            codesign: {
              certificateFile: WINDOWS_CERTIFICATE_FILE,
              certificatePassword: WINDOWS_CERTIFICATE_PASSWORD
            }
          }
        : {}),
      ...(feedUrl
        ? {
            updater: {
              url: feedUrl,
              channel: 'latest',
              updaterCacheDirName: `${APP_NAME}-updater`
            }
          }
        : {}),
      async getAppBuilderConfig() {
        return {
          appId: APP_ID,
          productName: displayName,
          copyright: `Copyright © ${APP_PUBLISHER}`,
          electronVersion: findElectronVersion(),
          nsis: {
            oneClick: false,
            perMachine: false,
            // 对齐 Client installMode: currentUser（不弹出 per-machine 选择页）
            // 由 include 里的 customInstallMode 强制当前用户
            allowToChangeInstallationDirectory: true,
            allowElevation: false,
            createDesktopShortcut: true,
            createStartMenuShortcut: true,
            menuCategory: START_MENU_FOLDER,
            shortcutName: displayName,
            installerLanguages: ['zh_CN', 'en_US'],
            displayLanguageSelector: false,
            include: findNsisHooks(),
            ...(setupIcon
              ? {
                  installerIcon: setupIcon,
                  uninstallerIcon: setupIcon,
                  installerHeaderIcon: setupIcon
                }
              : {})
          },
          win: {
            executableName: APP_EXECUTABLE,
            ...(setupIcon ? { icon: setupIcon } : {})
          }
        }
      }
    }),
    new MakerZIP({}, ['win32']),
    new MakerDMG({
      name: displayName,
      format: 'ULFO'
    }),
    new MakerZIP(
      S3_UPDATE_BASE
        ? {
            macUpdateManifestBaseUrl: `${S3_UPDATE_BASE}/darwin`
          }
        : {},
      ['darwin']
    ),
    new MakerDeb({
      options: {
        name: APP_NAME,
        productName: displayName,
        genericName: displayName,
        description: APP_DESCRIPTION,
        maintainer: APP_AUTHORS,
        categories: ['Development']
      }
    }),
    new MakerRpm({
      options: {
        name: APP_NAME,
        productName: displayName,
        genericName: displayName,
        description: APP_DESCRIPTION,
        categories: ['Development']
      }
    }),
    new MakerZIP({}, ['linux'])
  ]

  // macOS installer pkg（需 darwin）
  if (MAKE_PKG) {
    makers.push(
      new MakerPKG({
        name: displayName,
        identity: process.env.APPLE_IDENTITY
      })
    )
  }

  // Windows MSIX（需 Windows SDK / makeappx；STUDIO_MAKE_MSIX=1）
  if (MAKE_MSIX) {
    makers.push(
      new MakerMSIX({
        manifestVariables: {
          publisher: MSIX_PUBLISHER,
          packageIdentity: MSIX_IDENTITY
        },
        ...(WINDOWS_CERTIFICATE_FILE
          ? {
              windowsSignOptions: {
                certificateFile: WINDOWS_CERTIFICATE_FILE,
                certificatePassword: WINDOWS_CERTIFICATE_PASSWORD
              }
            }
          : {})
      })
    )
  }

  // Windows MSI（需 WiX Toolset；STUDIO_MAKE_WIX=1）— 企业旁路，默认不跑
  // 日常分发请用 NSIS Setup.exe；MSI 限制见 docs/apps/studio/packaging.md
  if (MAKE_WIX) {
    makers.push(
      new MakerWix({
        name: displayName,
        description: APP_DESCRIPTION,
        manufacturer: APP_PUBLISHER,
        exe: APP_EXECUTABLE,
        shortName: APP_NAME,
        appUserModelId: APP_AUMID,
        // 经 patch 后 per-user 重定向到用户 Programs 下（对齐 Client currentUser）
        programFilesFolderName: displayName,
        shortcutFolderName: START_MENU_FOLDER,
        shortcutName: displayName,
        upgradeCode: WIX_UPGRADE_CODE,
        language: WIX_LANGUAGE,
        cultures: WIX_CULTURES,
        // 对齐 Client NSIS installMode: currentUser（模板须 beforeCreate 修补，见上）
        defaultInstallMode: 'perUser',
        // Electron / corex 侧车仅 win32-x64；库默认 x86 会打错架构
        arch: 'x64',
        // 自动更新走 NSIS + electron-updater，不在 MSI 嵌 Update.exe
        features: {
          autoUpdate: false,
          autoLaunch: false
        },
        ...(setupIcon ? { icon: setupIcon } : {}),
        ui: {
          chooseDirectory: true
        },
        beforeCreate(creator) {
          patchWixCreatorForPerUser(creator)
        },
        ...(WINDOWS_CERTIFICATE_FILE
          ? {
              certificateFile: WINDOWS_CERTIFICATE_FILE,
              certificatePassword: WINDOWS_CERTIFICATE_PASSWORD
            }
          : {})
      })
    )
  }

  // Linux Flatpak（需 flatpak-builder；STUDIO_MAKE_FLATPAK=1）
  if (MAKE_FLATPAK) {
    makers.push(
      new MakerFlatpak({
        options: {
          id: APP_ID,
          productName: displayName,
          genericName: displayName,
          description: APP_DESCRIPTION,
          categories: ['Development'],
          runtime: 'org.freedesktop.Platform',
          runtimeVersion: '24.08',
          sdk: 'org.freedesktop.Sdk',
          files: []
        }
      })
    )
  }

  return makers
}

export { buildMakers }
