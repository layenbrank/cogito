import { invoke } from '@tauri-apps/api/core'

/**
 * 打开（或聚焦）浏览窗口。
 *
 * 浏览是**独立窗口**：工作台里没有网页，也就不存在"DOM 盖不住原生网页"和切换闪烁。
 * 带 `url` 时由浏览窗口把它开成一个标签；不带时只聚焦已有窗口或开一个空的。
 */
function openBrowser(url?: string) {
  return invoke('browser:open', { url: url ?? null })
}

/** 再开一扇浏览窗口（不抢已有窗口）。 */
function spawnBrowser(url?: string) {
  return invoke('browser:spawn', { url: url ?? null })
}

export { openBrowser, spawnBrowser }
