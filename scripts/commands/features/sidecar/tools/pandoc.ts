import { chmodSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'

import { PANDOC_BINARY, VENDOR_DIR } from '../infra/constants.ts'
import { fetchVerified } from '../infra/download.ts'
import { extractArchive, findFileInTree, parseArchiveExt } from '../infra/extract.ts'
import { readToolsLock, requireLockPin } from '../infra/lock.ts'
import { findBinaryName, findPlatformKey } from '../infra/platform.ts'
import { isVendorReady, writeVendorVersion } from '../infra/vendor.ts'

import type { ToolStrategy } from './types.ts'

function findPandocVendorDir(key = findPlatformKey()): string {
  return path.join(VENDOR_DIR, 'pandoc', key)
}

function findPandocBinary(key = findPlatformKey()): string {
  return path.join(findPandocVendorDir(key), 'bin', findBinaryName(PANDOC_BINARY))
}

/** 缓存命中不是「有文件就算」，而是「有 lock 里那个版本」：见 infra/vendor.ts */
async function ensurePandocVendor(key = findPlatformKey()): Promise<string> {
  const lock = readToolsLock()
  const pin = requireLockPin(lock, 'pandoc', key)
  const vendorDir = findPandocVendorDir(key)
  const binary = findPandocBinary(key)
  if (isVendorReady(vendorDir, pin.version, binary)) {
    console.log(`[pandoc] 缓存命中 ${pin.version} → ${binary}`)
    return binary
  }

  mkdirSync(vendorDir, { recursive: true })

  const ext = parseArchiveExt(pin.url)
  const archivePath = path.join(vendorDir, `pandoc-${pin.version}${ext}`)
  const extractDir = path.join(vendorDir, 'extract')

  await fetchVerified(pin.url, archivePath, pin.sha256)

  rmSync(extractDir, { recursive: true, force: true })
  extractArchive(archivePath, extractDir)

  const found = findFileInTree(extractDir, findBinaryName(PANDOC_BINARY))
  if (!found) {
    throw new Error(`[pandoc] 归档内未找到二进制: ${key}`)
  }

  const binDir = path.join(vendorDir, 'bin')
  rmSync(binDir, { recursive: true, force: true })
  mkdirSync(binDir, { recursive: true })
  const dest = path.join(binDir, findBinaryName(PANDOC_BINARY))
  cpSync(found, dest)
  if (process.platform !== 'win32') {
    chmodSync(dest, 0o755)
  }

  rmSync(extractDir, { recursive: true, force: true })
  writeVendorVersion(vendorDir, pin.version)
  console.log(`[pandoc] 已落盘 ${pin.version} → ${dest}`)
  return dest
}

function listPandocRuntimeFiles(key = findPlatformKey()): string[] {
  const binary = findPandocBinary(key)
  if (!existsSync(binary)) {
    return []
  }
  return [binary]
}

const PandocTool: ToolStrategy = {
  key: 'pandoc',
  async ensure(platformKey) {
    await ensurePandocVendor(platformKey)
  },
  findRuntimeFiles(platformKey) {
    return listPandocRuntimeFiles(platformKey)
  }
}

export {
  ensurePandocVendor,
  findPandocBinary,
  findPandocVendorDir,
  listPandocRuntimeFiles,
  PandocTool
}
