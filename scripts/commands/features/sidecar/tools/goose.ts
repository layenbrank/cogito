import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'

import { GOOSE_BINARY, VENDOR_DIR } from '../infra/constants.ts'
import { fetchVerified } from '../infra/download.ts'
import { extractArchive, findFileInTree, parseArchiveExt } from '../infra/extract.ts'
import { readToolsLock, requireLockPin } from '../infra/lock.ts'
import { findBinaryName, findPlatformKey } from '../infra/platform.ts'
import { LOCAL_VENDOR_VERSION, isVendorReady, writeVendorVersion } from '../infra/vendor.ts'

import type { ToolStrategy } from './types.ts'

function findGooseVendorDir(key = findPlatformKey()): string {
  return path.join(VENDOR_DIR, 'goose', key)
}

function findGooseBinDir(key = findPlatformKey()): string {
  return path.join(findGooseVendorDir(key), 'bin')
}

function findGooseBinary(key = findPlatformKey()): string {
  return path.join(findGooseBinDir(key), findBinaryName(GOOSE_BINARY))
}

/**
 * 本机二进制：只认显式的 `GOOSE_BINARY`（对齐 corex 的 `COREX_LOCAL_BIN`）。
 *
 * 不探测 PATH —— 用户可能装了 goose CLI / 桌面版，把它误判成「本机开发二进制」会让
 * lock 里的 pin 升级永远不生效（bootstrap 一直 stage 那份 PATH 里的旧 goose）。
 */
function findLocalGoosePath(): string | null {
  const fromEnv = process.env.GOOSE_BINARY?.trim()
  if (fromEnv && existsSync(fromEnv)) {
    return path.resolve(fromEnv)
  }
  return null
}

function isRuntimeSidecar(name: string): boolean {
  const lower = name.toLowerCase()
  return (
    lower.endsWith('.dll') ||
    lower.endsWith('.so') ||
    lower.endsWith('.dylib') ||
    lower.endsWith('.pdb')
  )
}

function copyRuntimeSidecars(sourceDir: string, destDir: string): void {
  if (!existsSync(sourceDir)) {
    return
  }
  for (const entry of readdirSync(sourceDir)) {
    if (!isRuntimeSidecar(entry)) {
      continue
    }
    cpSync(path.join(sourceDir, entry), path.join(destDir, entry))
    console.log(`[goose] 附带运行时 ${entry}`)
  }
}

function resetBinDir(key: string): string {
  const binDir = findGooseBinDir(key)
  rmSync(binDir, { recursive: true, force: true })
  mkdirSync(binDir, { recursive: true })
  return binDir
}

function stageGooseFiles(binaryPath: string, key: string): string {
  const binaryName = findBinaryName(GOOSE_BINARY)
  const binDir = resetBinDir(key)
  const dest = path.join(binDir, binaryName)
  cpSync(binaryPath, dest)
  if (process.platform !== 'win32') {
    chmodSync(dest, 0o755)
  }
  copyRuntimeSidecars(path.dirname(binaryPath), binDir)
  console.log(`[goose] 已落盘 → ${dest}`)
  return dest
}

async function ensureGooseFromRelease(key: string): Promise<string> {
  const lock = readToolsLock()
  const pin = requireLockPin(lock, 'goose', key)
  const vendorDir = findGooseVendorDir(key)
  mkdirSync(vendorDir, { recursive: true })

  const ext = parseArchiveExt(pin.url)
  const archivePath = path.join(vendorDir, `goose-${pin.version}${ext}`)
  const extractDir = path.join(vendorDir, 'extract')

  await fetchVerified(pin.url, archivePath, pin.sha256)

  rmSync(extractDir, { recursive: true, force: true })
  extractArchive(archivePath, extractDir)

  const binaryName = findBinaryName(GOOSE_BINARY)
  const found = findFileInTree(extractDir, binaryName)
  if (!found) {
    throw new Error(`[goose] 归档内未找到 ${binaryName}`)
  }

  const staged = stageGooseFiles(found, key)
  rmSync(extractDir, { recursive: true, force: true })
  writeVendorVersion(vendorDir, pin.version)
  console.log(`[goose] 已从 release 安装 ${pin.version}`)
  return staged
}

async function ensureGooseVendor(key = findPlatformKey()): Promise<string> {
  const vendorDir = findGooseVendorDir(key)

  // 本机那份（`local`）：只有显式设了 GOOSE_BINARY 才优先用它。不能因为目录里残留过
  // local 标记就锁死旧版本 —— pin 升级后必须回落到 release（缓存命中按 lock 里的版本）。
  const local = findLocalGoosePath()
  if (local) {
    console.log(`[goose] 使用本机二进制 ${local}`)
    const staged = stageGooseFiles(local, key)
    writeVendorVersion(vendorDir, LOCAL_VENDOR_VERSION)
    return staged
  }

  const lock = readToolsLock()
  const pin = requireLockPin(lock, 'goose', key)
  const binary = findGooseBinary(key)

  // 缓存命中不是「有文件就算」，而是「有 lock 里那个版本」
  if (isVendorReady(vendorDir, pin.version, binary)) {
    console.log(`[goose] 缓存命中 ${pin.version} → ${binary}`)
    return binary
  }

  return ensureGooseFromRelease(key)
}

function listGooseRuntimeFiles(key = findPlatformKey()): string[] {
  const binDir = findGooseBinDir(key)
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

const GooseTool: ToolStrategy = {
  key: 'goose',
  async ensure(platformKey) {
    await ensureGooseVendor(platformKey)
  },
  findRuntimeFiles(platformKey) {
    return listGooseRuntimeFiles(platformKey)
  }
}

export {
  GooseTool,
  ensureGooseVendor,
  findGooseBinDir,
  findGooseBinary,
  findGooseVendorDir,
  listGooseRuntimeFiles
}
