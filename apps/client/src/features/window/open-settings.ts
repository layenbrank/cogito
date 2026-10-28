/**
 * 同窗打开全局设置：与磁贴 / Omnibar 一样走 admitSession + router.navigate。
 * 不再创建 `settings:global` 独立窗口（主页头像入口尤禁止另开窗）。
 */
import { openComponentRoute } from '@/features/command-bar/open-route'
import { SECTION, type SectionKey } from '@/views/settings/constant'

function findSettingsPath(section?: SectionKey) {
  const target = section ?? SECTION.ACCOUNT
  return `/settings?section=${encodeURIComponent(target)}`
}

async function openSettings(section?: SectionKey) {
  await openComponentRoute('settings', { path: findSettingsPath(section) })
}

export { findSettingsPath, openSettings }
