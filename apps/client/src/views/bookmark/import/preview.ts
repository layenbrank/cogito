import { open as dialogOpen } from '@tauri-apps/plugin-dialog'
import { readTextFile } from '@tauri-apps/plugin-fs'

import { discoverChromeProfiles } from '@/views/bookmark/import/chrome-profile'
import { flattenBookmarkLeaves } from '@/views/bookmark/import/flatten'
import { parseChromeBookmarksJson } from '@/views/bookmark/import/parse-chrome-json'
import { parseBookmarkHtml } from '@/views/bookmark/import/parse-html'
import {
  findDefaultSelectedFolders,
  findSelectedLeaves
} from '@/views/bookmark/import/tree'
import type { BookmarkNode, ImportPreview } from '@/views/bookmark/import/types'

function buildPreview(roots: BookmarkNode[], sourceLabel: string): ImportPreview {
  return {
    roots,
    leaves: flattenBookmarkLeaves(roots),
    sourceLabel
  }
}

async function previewFromHtmlFile(): Promise<ImportPreview | null> {
  const selected = await dialogOpen({
    multiple: false,
    filters: [{ name: 'Bookmarks HTML', extensions: ['html', 'htm'] }]
  })
  if (!selected || Array.isArray(selected)) return null
  const raw = await readTextFile(selected)
  const roots = parseBookmarkHtml(raw)
  if (!roots.length) {
    throw new Error('未能从 HTML 解析出书签，请确认是 Chrome「导出书签」文件')
  }
  return buildPreview(roots, selected)
}

function previewFromChromeJsonText(raw: string, label: string): ImportPreview {
  const roots = parseChromeBookmarksJson(raw)
  if (!roots.length) {
    throw new Error('未能从 Chrome Bookmarks JSON 解析出书签')
  }
  return buildPreview(roots, label)
}

async function previewFromJsonFile(): Promise<ImportPreview | null> {
  const selected = await dialogOpen({
    multiple: false,
    filters: [{ name: 'Chrome Bookmarks', extensions: ['json', ''] }]
  })
  if (!selected || Array.isArray(selected)) return null
  const raw = await readTextFile(selected)
  return previewFromChromeJsonText(raw, selected)
}

function updateFolderSelection(preview: ImportPreview, selectedFolders: string[]) {
  return findSelectedLeaves(preview.leaves, selectedFolders)
}

export {
  updateFolderSelection,
  discoverChromeProfiles,
  findDefaultSelectedFolders,
  previewFromChromeJsonText,
  previewFromHtmlFile,
  previewFromJsonFile
}
