/** Forge / 发版相关环境变量解析（未设置则跳过可选能力，避免本地/CI 误失败） */

const TRUE = /^(1|true|yes|on)$/i

/**
 * 侧车档位：
 * - `lite`（默认）：pandoc / ffmpeg / opencode 不进安装包，由 Studio 运行时从在线源下载；
 * - `full`：全部侧车内置，离线可用。
 *
 * 用 `apps/studio/scripts/run-forge.ts` 跑打包（`pnpm --filter @cogito/studio make:full`）。
 */
type SidecarVariant = 'lite' | 'full'

function parseVariant(raw: string | undefined): SidecarVariant {
  return raw?.trim().toLowerCase() === 'full' ? 'full' : 'lite'
}

function isEnabled(name: string): boolean {
  return TRUE.test(process.env[name] ?? '')
}

function findEnv(name: string): string | undefined {
  const value = process.env[name]
  if (!value || !value.trim()) return undefined
  return value.trim()
}

/** 可选 makers：需本机安装对应工具链后显式开启 */
const MAKE_MSIX = isEnabled('STUDIO_MAKE_MSIX')
const MAKE_WIX = isEnabled('STUDIO_MAKE_WIX')
const MAKE_FLATPAK = isEnabled('STUDIO_MAKE_FLATPAK')
/** macOS .pkg；默认开启（仅 darwin 生效） */
const MAKE_PKG = !isEnabled('STUDIO_MAKE_PKG_OFF')

const PUBLISH_GITHUB = isEnabled('STUDIO_PUBLISH_GITHUB')
const PUBLISH_S3 = isEnabled('STUDIO_PUBLISH_S3')

const GITHUB_OWNER = findEnv('STUDIO_GITHUB_OWNER') ?? 'layenbrank'
const GITHUB_REPO = findEnv('STUDIO_GITHUB_REPO') ?? 'cogito'
const GITHUB_TOKEN = findEnv('GITHUB_TOKEN') ?? findEnv('STUDIO_GITHUB_TOKEN')

const S3_BUCKET = findEnv('STUDIO_S3_BUCKET')
const S3_REGION = findEnv('STUDIO_S3_REGION')
const S3_FOLDER = findEnv('STUDIO_S3_FOLDER')
const S3_PUBLIC = isEnabled('STUDIO_S3_PUBLIC')
const S3_UPDATE_BASE = findEnv('STUDIO_S3_UPDATE_BASE')

const WINDOWS_CERTIFICATE_FILE = findEnv('WINDOWS_CERTIFICATE_FILE')
const WINDOWS_CERTIFICATE_PASSWORD = findEnv('WINDOWS_CERTIFICATE_PASSWORD')
const WINDOWS_CERTIFICATE_SUBJECT = findEnv('WINDOWS_CERTIFICATE_SUBJECT')

const OSX_SIGN = isEnabled('STUDIO_OSX_SIGN') || Boolean(findEnv('APPLE_IDENTITY'))
const APPLE_ID = findEnv('APPLE_ID')
const APPLE_ID_PASSWORD = findEnv('APPLE_APP_SPECIFIC_PASSWORD') ?? findEnv('APPLE_PASSWORD')
const APPLE_TEAM_ID = findEnv('APPLE_TEAM_ID')
const OSX_NOTARIZE = Boolean(APPLE_ID && APPLE_ID_PASSWORD && APPLE_TEAM_ID)

/** electron-updater generic feed：STUDIO_UPDATE_URL 或 STUDIO_S3_UPDATE_BASE（make 时写入 STUDIO_UPDATE_FEED_URL） */
const UPDATE_URL = findEnv('STUDIO_UPDATE_URL')

const MSIX_PUBLISHER = findEnv('STUDIO_MSIX_PUBLISHER') ?? 'CN=cogito'
const MSIX_IDENTITY = findEnv('STUDIO_MSIX_IDENTITY') ?? 'cogito.studio'

const SIDECAR_VARIANT = parseVariant(process.env.STUDIO_SIDECAR_VARIANT)

export {
  APPLE_ID,
  APPLE_ID_PASSWORD,
  APPLE_TEAM_ID,
  findEnv,
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_TOKEN,
  isEnabled,
  MAKE_FLATPAK,
  MAKE_MSIX,
  MAKE_PKG,
  MAKE_WIX,
  MSIX_IDENTITY,
  MSIX_PUBLISHER,
  OSX_NOTARIZE,
  OSX_SIGN,
  PUBLISH_GITHUB,
  PUBLISH_S3,
  S3_BUCKET,
  S3_FOLDER,
  S3_PUBLIC,
  S3_REGION,
  S3_UPDATE_BASE,
  SIDECAR_VARIANT,
  UPDATE_URL,
  WINDOWS_CERTIFICATE_FILE,
  WINDOWS_CERTIFICATE_PASSWORD,
  WINDOWS_CERTIFICATE_SUBJECT
}
export type { SidecarVariant }
