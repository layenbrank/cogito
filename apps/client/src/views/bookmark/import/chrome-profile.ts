/**
 * 发现本机 Chrome Profile 的 Bookmarks 文件。
 */
import { localDataDir } from '@tauri-apps/api/path'
import { exists, readDir, readTextFile } from '@tauri-apps/plugin-fs'

import { parseChromeBookmarksJson } from '@/views/bookmark/import/parse-chrome-json'
import type { BookmarkNode } from '@/views/bookmark/import/types'
import { grantPaths } from '@/shared/ipc/grants'

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
  // 收窄 fs:scope 后浏览器目录在授权集之外：先放行再检测，否则 exists 恒为 false
  await grantPaths(candidates, true)
  const checks = await Promise.allSettled(
    candidates.map(async function (root) {
      if (await exists(root)) return root
      return null
    })
  )
  const found: string[] = []
  for (const result of checks) {
    if (result.status === 'rejected') {
      console.warn('[bookmark-import] 检测浏览器目录失败', result.reason)
      continue
    }
    if (result.value) found.push(result.value)
  }
  return found
}

async function readBookmarksFile(path: string) {
  // Chrome 占用时直接读通常仍可读；失败则抛错由上层提示先关闭浏览器
  return readTextFile(path)
}

async function discoverProfilesInRoot(userData: string): Promise<ChromeProfileBookmarks[]> {
  let entries
  try {
    entries = await readDir(userData)
  } catch (error) {
    console.warn('[bookmark-import] 读取 User Data 失败', userData, error)
    return []
  }

  const brand = userData.includes('Edge')
    ? 'Edge'
    : userData.includes('Chromium')
      ? 'Chromium'
      : 'Chrome'

  const profileNames = entries
    .map(function (entry) {
      return entry.name
    })
    .filter(function (name): name is string {
      if (!name) return false
      return name === 'Default' || /^Profile \d+$/i.test(name)
    })

  const reads = await Promise.allSettled(
    profileNames.map(async function (name) {
      const bookmarksPath = `${userData}\\${name}\\Bookmarks`
      if (!(await exists(bookmarksPath))) return null
      const raw = await readBookmarksFile(bookmarksPath)
      const tree = parseChromeBookmarksJson(raw)
      if (!tree.length) return null
      return {
        label: `${brand} · ${name}`,
        path: bookmarksPath,
        roots: tree
      } satisfies ChromeProfileBookmarks
    })
  )

  const profiles: ChromeProfileBookmarks[] = []
  for (const result of reads) {
    if (result.status === 'rejected') {
      console.warn('[bookmark-import] 读取 Profile 失败', result.reason)
      continue
    }
    if (result.value) profiles.push(result.value)
  }
  return profiles
}

async function discoverChromeProfiles(): Promise<ChromeProfileBookmarks[]> {
  const roots = await findChromeUserDataRoots()
  const batches = await Promise.allSettled(
    roots.map(function (userData) {
      return discoverProfilesInRoot(userData)
    })
  )
  const profiles: ChromeProfileBookmarks[] = []
  for (const result of batches) {
    if (result.status === 'rejected') {
      console.warn('[bookmark-import] 扫描 User Data 失败', result.reason)
      continue
    }
    profiles.push(...result.value)
  }
  return profiles
}

export { discoverChromeProfiles }
export type { ChromeProfileBookmarks }
