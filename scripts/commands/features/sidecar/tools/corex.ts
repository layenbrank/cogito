import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'

import { COREX_CLI, COREX_DAEMON, COREX_MCP, VENDOR_DIR } from '../infra/constants.ts'
import { fetchVerified } from '../infra/download.ts'
import { extractArchive, findFileInTree } from '../infra/extract.ts'
import { readToolsLock, requireLockPin } from '../infra/lock.ts'
import { findBinaryName, findPlatformKey } from '../infra/platform.ts'
import { clearVendorVersion, isVendorReady, writeVendorVersion } from '../infra/vendor.ts'

import type { ToolStrategy } from './types.ts'

function findCorexVendorDir(key = findPlatformKey()): string {
  return path.join(VENDOR_DIR, 'corex', key)
}

function findCorexBinDir(key = findPlatformKey()): string {
  return path.join(findCorexVendorDir(key), 'bin')
}

function findDaemonBinary(key = findPlatformKey()): string {
  return path.join(findCorexBinDir(key), findBinaryName(COREX_DAEMON))
}

/** MCP 侧车：Agent / opencode 按名字拉起，必须随 corex 归档一起落盘 */
function findMcpBinary(key = findPlatformKey()): string {
  return path.join(findCorexBinDir(key), findBinaryName(COREX_MCP))
}

function findCliBinary(key = findPlatformKey()): string {
  return path.join(findCorexBinDir(key), findBinaryName(COREX_CLI))
}

/** vendor 命中所需：daemon + cli + mcp（pdfium 由独立 pdfium 工具兜底，也欢迎归档自带） */
function findRequiredVendorBinaries(key = findPlatformKey()): string[] {
  return [findDaemonBinary(key), findMcpBinary(key), findCliBinary(key)]
}

/**
 * 本地完整产物目录（开发用）：设 `COREX_LOCAL_BIN` 指向含
 * corex-daemon / corex / corex-mcp（及可选 pdfium.dll）的目录时，跳过远端 ZIP。
 */
function tryStageFromLocalBin(key: string): string | null {
  const local = process.env.COREX_LOCAL_BIN?.trim()
  if (!local) {
    return null
  }
  const srcDir = path.resolve(local)
  if (!existsSync(srcDir)) {
    throw new Error(`[corex] COREX_LOCAL_BIN 不存在: ${srcDir}`)
  }
  const daemonName = findBinaryName(COREX_DAEMON)
  const cliName = findBinaryName(COREX_CLI)
  const mcpName = findBinaryName(COREX_MCP)
  for (const name of [daemonName, cliName, mcpName]) {
    if (!existsSync(path.join(srcDir, name))) {
      throw new Error(`[corex] COREX_LOCAL_BIN 缺少 ${name}: ${srcDir}`)
    }
  }
  const binDir = findCorexBinDir(key)
  rmSync(binDir, { recursive: true, force: true })
  mkdirSync(binDir, { recursive: true })
  for (const name of readdirSync(srcDir)) {
    const src = path.join(srcDir, name)
    const lower = name.toLowerCase()
    const isBinary =
      name === daemonName ||
      name === cliName ||
      name === mcpName ||
      lower.endsWith('.dll') ||
      lower.endsWith('.so') ||
      lower.endsWith('.dylib')
    if (!isBinary) {
      continue
    }
    cpSync(src, path.join(binDir, name))
    if (process.platform !== 'win32' && !lower.endsWith('.dll') && !lower.endsWith('.so')) {
      chmodSync(path.join(binDir, name), 0o755)
    }
  }
  writeVendorVersion(findCorexVendorDir(key), 'local')
  console.log(`[corex] 已从 COREX_LOCAL_BIN 落盘 → ${binDir}`)
  return findDaemonBinary(key)
}

/**
 * 按 tools.lock 把 corex zip 下到缓存 corex/<platform>/bin —— 直链是自建 R2 镜像
 * （corex 是自研 sidecar，不依赖 GitHub releases）。
 *
 * 完整布局（缺一不可）：
 *   corex-daemon(.exe) · corex(.exe) · corex-mcp(.exe) · pdfium.dll（win32）
 *
 * 缓存命中不是「有文件就算」，而是「有 lock 里那个版本且该有的文件都在」。
 */
async function ensureCorexVendor(key = findPlatformKey()): Promise<string> {
  const fromLocal = tryStageFromLocalBin(key)
  if (fromLocal) {
    return fromLocal
  }

  const lock = readToolsLock()
  const pin = requireLockPin(lock, 'corex', key)
  const vendorDir = findCorexVendorDir(key)
  const daemonPath = findDaemonBinary(key)
  const required = findRequiredVendorBinaries(key)

  if (isVendorReady(vendorDir, pin.version, required)) {
    console.log(`[corex] 缓存命中 ${pin.version} → ${daemonPath}`)
    return daemonPath
  }

  mkdirSync(vendorDir, { recursive: true })

  const archivePath = path.join(vendorDir, `corex-${pin.version}.zip`)
  const extractDir = path.join(vendorDir, 'extract')

  await fetchVerified(pin.url, archivePath, pin.sha256)

  rmSync(extractDir, { recursive: true, force: true })
  extractArchive(archivePath, extractDir)

  const daemonName = findBinaryName(COREX_DAEMON)
  const cliName = findBinaryName(COREX_CLI)
  const mcpName = findBinaryName(COREX_MCP)
  const foundDaemon = findFileInTree(extractDir, daemonName)
  if (!foundDaemon) {
    throw new Error(`[corex] 归档内未找到 ${daemonName}`)
  }

  const foundCli = findFileInTree(extractDir, cliName)
  if (!foundCli) {
    throw new Error(
      `[corex] 归档内未找到 ${cliName}：请发布含完整 CLI 的 corex 包（publish-release.yml）`
    )
  }

  const foundMcp = findFileInTree(extractDir, mcpName)
  if (!foundMcp) {
    // 旧 ZIP 只有 daemon+cli：清版本记号，避免「半成品」被当成命中
    clearVendorVersion(vendorDir)
    throw new Error(
      `[corex] 归档内未找到 ${mcpName}。` +
        '发版 ZIP 必须含 corex-mcp（见 corex `.github/workflows/publish-release.yml`）；' +
        '更新 tools.lock 的 url/sha256 到完整包后重跑 `pnpm command sidecar bootstrap`。'
    )
  }

  const binDir = findCorexBinDir(key)
  rmSync(binDir, { recursive: true, force: true })
  mkdirSync(binDir, { recursive: true })

  cpSync(foundDaemon, path.join(binDir, daemonName))
  cpSync(foundCli, path.join(binDir, cliName))
  cpSync(foundMcp, path.join(binDir, mcpName))

  const daemonSrcDir = path.dirname(foundDaemon)
  for (const entry of readdirSync(daemonSrcDir)) {
    const lower = entry.toLowerCase()
    if (
      lower.endsWith('.dll') ||
      lower.endsWith('.so') ||
      lower.endsWith('.dylib') ||
      lower === 'pdfium.dll'
    ) {
      cpSync(path.join(daemonSrcDir, entry), path.join(binDir, entry))
    }
  }

  // 归档根目录也可能直接放 pdfium.dll（与 exe 同级）；没有则由 pdfium 工具单独落盘
  const foundPdfium = findFileInTree(extractDir, 'pdfium.dll')
  if (foundPdfium && !existsSync(path.join(binDir, 'pdfium.dll'))) {
    cpSync(foundPdfium, path.join(binDir, 'pdfium.dll'))
  }

  if (process.platform !== 'win32') {
    chmodSync(path.join(binDir, daemonName), 0o755)
    for (const name of [cliName, mcpName]) {
      const filePath = path.join(binDir, name)
      if (existsSync(filePath)) {
        chmodSync(filePath, 0o755)
      }
    }
  }

  // 二次确认：写版本记号前再扫一遍，防止半成品被当成命中
  for (const binary of findRequiredVendorBinaries(key)) {
    if (!existsSync(binary)) {
      clearVendorVersion(vendorDir)
      throw new Error(`[corex] 解压后仍缺少必需文件: ${binary}`)
    }
  }

  rmSync(extractDir, { recursive: true, force: true })
  writeVendorVersion(vendorDir, pin.version)
  console.log(`[corex] 已落盘 ${pin.version} → ${binDir}`)
  return daemonPath
}

function findCorexRuntimeFiles(key = findPlatformKey()): string[] {
  const binDir = findCorexBinDir(key)
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

const CorexTool: ToolStrategy = {
  key: 'corex',
  async ensure(platformKey) {
    await ensureCorexVendor(platformKey)
  },
  findRuntimeFiles(platformKey) {
    return findCorexRuntimeFiles(platformKey)
  }
}

export {
  CorexTool,
  ensureCorexVendor,
  findCorexBinDir,
  findCorexVendorDir,
  findDaemonBinary,
  findMcpBinary,
  findCorexRuntimeFiles,
  findRequiredVendorBinaries
}
