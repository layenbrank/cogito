/**
 * 读侧白名单：只有白名单内的键可以公开 GET/HEAD（写侧不限 key）。
 *
 * 宿主 worker 与上传脚本共用这一份 —— 上传前先按它校验，避免传完大文件才发现读不回来。
 */

/** 版本目录：`1.5.0` 或预发 `1.5.0-alpha.1` */
const VERSION_DIR = String.raw`\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?`

/** Store / 直链 NSIS 安装包 */
const SETUP_EXE_KEY = new RegExp(`^${VERSION_DIR}/[\\w.-]+-setup\\.exe$`)

/** WiX MSI（含语言后缀，如 cogito_1.5.0_x64_zh-CN.msi） */
const SETUP_MSI_KEY = new RegExp(`^${VERSION_DIR}/[\\w.-]+\\.msi$`)

/** Tauri updater 包（createUpdaterArtifacts） */
const UPDATER_ZIP_KEY = new RegExp(`^${VERSION_DIR}/[\\w.-]+-setup\\.nsis\\.zip$`)

/** 渠道浮动清单（覆盖写） */
const CHANNEL_MANIFEST_KEY = /^updater-(stable|alpha|beta|rc)\/latest\.json$/

/** 兼容旧名：与 SETUP_EXE_KEY 相同 */
const SETUP_KEY = SETUP_EXE_KEY

function isManifestKey(key: string): boolean {
  return CHANNEL_MANIFEST_KEY.test(key)
}

function isPublicKey(key: string): boolean {
  return (
    SETUP_EXE_KEY.test(key) ||
    SETUP_MSI_KEY.test(key) ||
    UPDATER_ZIP_KEY.test(key) ||
    CHANNEL_MANIFEST_KEY.test(key)
  )
}

/** @deprecated 使用 isPublicKey */
function isSetupKey(key: string): boolean {
  return isPublicKey(key)
}

export {
  SETUP_KEY,
  SETUP_EXE_KEY,
  SETUP_MSI_KEY,
  UPDATER_ZIP_KEY,
  CHANNEL_MANIFEST_KEY,
  isManifestKey,
  isPublicKey,
  isSetupKey
}
