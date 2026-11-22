import { discoverChromeProfiles } from '@/views/bookmark/import/chrome-profile'
import { flattenBookmarkLeaves } from '@/views/bookmark/import/flatten'
import { parseChromeBookmarksJson } from '@/views/bookmark/import/parse-chrome-json'
import { parseBookmarkHtml } from '@/views/bookmark/import/parse-html'
import { findDefaultSelectedFolders, findSelectedLeaves } from '@/views/bookmark/import/tree'
import type { BookmarkNode, ImportPreview } from '@/views/bookmark/import/types'

function buildPreview(roots: BookmarkNode[], sourceLabel: string): ImportPreview {
  return {
    roots,
    leaves: flattenBookmarkLeaves(roots),
    sourceLabel
  }
}

function pickFile(accept: string): Promise<File | null> {
  return new Promise(function (resolve) {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.addEventListener('change', function () {
      resolve(input.files?.[0] ?? null)
    })
    input.addEventListener('cancel', function () {
      resolve(null)
    })
    input.click()
  })
}

async function previewFromHtmlFile(): Promise<ImportPreview | null> {
  const file = await pickFile('.html,.htm')
  if (!file) return null
  const raw = await file.text()
  const roots = parseBookmarkHtml(raw)
  if (!roots.length) {
    throw new Error('未能从 HTML 解析出书签，请确认是 Chrome「导出书签」文件')
  }
  return buildPreview(roots, file.name)
}

function previewFromChromeJsonText(raw: string, label: string): ImportPreview {
  const roots = parseChromeBookmarksJson(raw)
  if (!roots.length) {
    throw new Error('未能从 Chrome Bookmarks JSON 解析出书签')
  }
  return buildPreview(roots, label)
}

async function previewFromJsonFile(): Promise<ImportPreview | null> {
  const file = await pickFile('.json')
  if (!file) return null
  const raw = await file.text()
  return previewFromChromeJsonText(raw, file.name)
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
