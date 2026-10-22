/**
 * 发现本机 Chrome Profile 的 Bookmarks 文件。
 */
import { localDataDir } from '@tauri-apps/api/path'
import { exists, readDir, readTextFile } from '@tauri-apps/plugin-fs'

import { parseChromeBookmarksJson } from '@/views/bookmark/import/parse-chrome-json'
import type { BookmarkNode } from '@/views/bookmark/import/types'

interface ChromeProfileBookmarks {
  label: string
  path: string
  roots: BookmarkNode[]
}

async function findChromeUserDataRoots() {
  const local = await localDataDir()
  const candidates = [
    `${local}\\Google\\Chrome\\User Data`,
    `${local}\\Chromium\\User Data`,
    `${local}\\Microsoft\\Edge\\User Data`
  ]
  const found: string[] = []
  for (const root of candidates) {
    if (await exists(root)) found.push(root)
  }
  return found
}

async function readBookmarksFile(path: string) {
  // Chrome 占用时直接读通常仍可读；失败则抛错由上层提示先关闭浏览器
  return readTextFile(path)
}

async function discoverChromeProfiles(): Promise<ChromeProfileBookmarks[]> {
  const roots = await findChromeUserDataRoots()
  const profiles: ChromeProfileBookmarks[] = []

  for (const userData of roots) {
    let entries
    try {
      entries = await readDir(userData)
    } catch (error) {
      console.warn('[bookmark-import] 读取 User Data 失败', userData, error)
      continue
    }

    const brand = userData.includes('Edge')
      ? 'Edge'
      : userData.includes('Chromium')
        ? 'Chromium'
        : 'Chrome'

    for (const entry of entries) {
      const name = entry.name
      if (!name) continue
      if (name !== 'Default' && !/^Profile \d+$/i.test(name)) continue
      const bookmarksPath = `${userData}\\${name}\\Bookmarks`
      if (!(await exists(bookmarksPath))) continue
      try {
        const raw = await readBookmarksFile(bookmarksPath)
        const tree = parseChromeBookmarksJson(raw)
        if (!tree.length) continue
        profiles.push({
          label: `${brand} · ${name}`,
          path: bookmarksPath,
          roots: tree
        })
      } catch (error) {
        console.warn('[bookmark-import] 读取 Profile 失败', bookmarksPath, error)
      }
    }
  }

  return profiles
}

export { discoverChromeProfiles }
export type { ChromeProfileBookmarks }
