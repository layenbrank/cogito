import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'

import { VENDOR_DIR } from '../infra/constants.ts'
import { fetchVerified } from '../infra/download.ts'
import { extractArchive, findFileInTree, parseArchiveExt } from '../infra/extract.ts'
import { findToolPin, parseToolsLock } from '../infra/lock.ts'
import { findPlatformKey } from '../infra/platform.ts'
import { isVendorReady, writeVendorVersion } from '../infra/vendor.ts'

import type { ToolStrategy } from './types.ts'

function findPdfiumVendorDir(key = findPlatformKey()): string {
  return path.join(VENDOR_DIR, 'pdfium', key)
}

function findPdfiumBinDir(key = findPlatformKey()): string {
  return path.join(findPdfiumVendorDir(key), 'bin')
}

/** 运行时库文件名（按平台换名） */
function findPdfiumLibraryName(key = findPlatformKey()): string {
  const platform = key.split('-')[0]
  if (platform === 'win32') {
    return 'pdfium.dll'
  }
  return platform === 'darwin' ? 'libpdfium.dylib' : 'libpdfium.so'
}

function findPdfiumLibrary(key = findPlatformKey()): string {
  return path.join(findPdfiumBinDir(key), findPdfiumLibraryName(key))
}

function isDirectLibraryUrl(url: string): boolean {
  const lower = url.toLowerCase()
  return (
    lower.endsWith('.dll') ||
    lower.endsWith('.so') ||
    lower.endsWith('.dylib') ||
    lower.includes('/pdfium.dll')
  )
}

/**
 * 按 tools.lock 的 `pdfium` pin 落盘运行时库到 pdfium/<platform>/bin。
 *
 * 支持两种 pin：
 * - 直链库文件（如 R2 `…/7881/pdfium.dll`）
 * - 归档（tgz/zip，解压后找库文件）
 *
 * 版本要与 corex 的 `assets/pdfium/VERSION` 对齐。
 */
async function ensurePdfiumVendor(key = findPlatformKey()): Promise<string> {
  const lock = parseToolsLock()
  if (!lock.pdfium) {
    throw new Error('[pdfium] tools.lock 中无钉死版本')
  }
  const pin = findToolPin(lock.pdfium, 'pdfium', key)
  const vendorDir = findPdfiumVendorDir(key)
  const library = findPdfiumLibrary(key)
  if (isVendorReady(vendorDir, pin.version, library)) {
    console.log(`[pdfium] 缓存命中 ${pin.version} → ${library}`)
    return library
  }

  mkdirSync(vendorDir, { recursive: true })
  const libraryName = findPdfiumLibraryName(key)
  const binDir = findPdfiumBinDir(key)
  rmSync(binDir, { recursive: true, force: true })
  mkdirSync(binDir, { recursive: true })
  const dest = path.join(binDir, libraryName)

  if (isDirectLibraryUrl(pin.url)) {
    const downloadPath = path.join(vendorDir, `${libraryName}.download`)
    await fetchVerified(pin.url, downloadPath, pin.sha256)
    cpSync(downloadPath, dest)
  } else {
    const archivePath = path.join(vendorDir, `pdfium-${pin.version}${parseArchiveExt(pin.url)}`)
    const extractDir = path.join(vendorDir, 'extract')
    await fetchVerified(pin.url, archivePath, pin.sha256)
    rmSync(extractDir, { recursive: true, force: true })
    extractArchive(archivePath, extractDir)
    const found = findFileInTree(extractDir, libraryName)
    if (!found) {
      throw new Error(`[pdfium] 归档内未找到 ${libraryName}`)
    }
    cpSync(found, dest)
    rmSync(extractDir, { recursive: true, force: true })
  }

  if (process.platform !== 'win32') {
    chmodSync(dest, 0o755)
  }

  writeVendorVersion(vendorDir, pin.version)
  console.log(`[pdfium] 已落盘 ${pin.version} → ${binDir}`)
  return library
}

function listPdfiumRuntimeFiles(key = findPlatformKey()): string[] {
  const binDir = findPdfiumBinDir(key)
  if (!existsSync(binDir)) {
    return []
  }
  return readdirSync(binDir)
    .filter(function (name) {
      return !name.startsWith('.')
    })
    .map(function (name) {
      return path.join(binDir, name)
    })
}

const PdfiumTool: ToolStrategy = {
  key: 'pdfium',
  async ensure(platformKey) {
    await ensurePdfiumVendor(platformKey)
  },
  findRuntimeFiles(platformKey) {
    return listPdfiumRuntimeFiles(platformKey)
  }
}

export {
  ensurePdfiumVendor,
  findPdfiumBinDir,
  findPdfiumLibrary,
  findPdfiumVendorDir,
  listPdfiumRuntimeFiles,
  PdfiumTool
}
