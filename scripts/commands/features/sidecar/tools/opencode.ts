import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'

import { OPENCODE_BINARY, VENDOR_DIR } from '../infra/constants.ts'
import { fetchVerified } from '../infra/download.ts'
import { extractArchive, findFileInTree, parseArchiveExt } from '../infra/extract.ts'
import { readToolsLock, requireLockPin } from '../infra/lock.ts'
import { findBinaryName, findPlatformKey } from '../infra/platform.ts'
import { clearVendorVersion, isVendorReady, writeVendorVersion } from '../infra/vendor.ts'

import type { ToolStrategy } from './types.ts'

/**
 * opencode 既是 CLI 也是 agent server（`opencode serve`），Studio 内嵌它当 agent 运行时。
 *
 * 只认显式 `OPENCODE_BINARY`，**不扫 PATH**：server 与 `@opencode/client` 版本强耦合，
 * 用户自己装的 opencode 可能是任意版本，漂移了症状是协议对不上而不是报错。
 *
 * 2.x 起官方不再发 npm 平台包（`opencode-windows-x64` 等停在 1.18.32），
 * 改为 `https://opencode.ai/files/bin/<version>/opencode-<平台>.<zip|tar.gz>` 直链，
 * 每个平台一份归档，zip 里只有一个可执行文件。
 *
 * **版本漂移在这里是致命的**：server 与 `@opencode/client` 对不上不会报「版本不符」，
 * 而是把 v1 收到 v2 请求体当成校验错误吐回来（实测 `Missing key at ["prompt"]`，
 * 以及 `UnsupportedContentType`）—— 排查方向会跑到协议上去。所以缓存命中、落盘两步都
 * 按「版本记号 + 二进制自述版本」双重核对，见下面两处注释。
 */

function findOpencodeVendorDir(key = findPlatformKey()): string {
  return path.join(VENDOR_DIR, 'opencode', key)
}

function findOpencodeBinDir(key = findPlatformKey()): string {
  return path.join(findOpencodeVendorDir(key), 'bin')
}

function findOpencodeBinary(key = findPlatformKey()): string {
  return path.join(findOpencodeBinDir(key), findBinaryName(OPENCODE_BINARY))
}

/** 落盘目录里这版二进制自称的版本；读不到返回 null（探针失败不该拦住流水线） */
function readOpencodeBinaryVersion(binary: string): string | null {
  const probe = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 30_000 })
  const output = `${probe.stdout ?? ''}${probe.stderr ?? ''}`
  const match = /(\d+\.\d+\.\d+)/.exec(output)
  return match ? match[1] : null
}

/**
 * 二进制自己说的版本才是事实：`.version` 只证明「我们打算装哪个版本」。
 * 不核对的话，装错了版本要到用户点「发送」时才以协议错误暴露出来。
 */
function assertOpencodeVersion(binary: string, expected: string): void {
  const actual = readOpencodeBinaryVersion(binary)
  if (actual === null) {
    console.warn(`[opencode] 无法读取二进制自述版本，跳过核对（期望 ${expected}）`)
    return
  }
  if (actual !== expected) {
    throw new Error(
      `[opencode] 版本不符: tools.lock 期望 ${expected}，落盘的二进制是 ${actual}（${binary}）` +
        `；请核对 tools.lock.json 里的 url/sha256 与 @opencode/client 的版本`
    )
  }
  console.log(`[opencode] 版本核对通过 ${actual}`)
}

function findExplicitOpencodePath(): string | null {
  const fromEnv = process.env.OPENCODE_BINARY?.trim()
  if (!fromEnv) {
    return null
  }
  if (!existsSync(fromEnv)) {
    throw new Error(`[opencode] OPENCODE_BINARY 指向的文件不存在: ${fromEnv}`)
  }
  return path.resolve(fromEnv)
}

function stageOpencodeFiles(sourceBinary: string, key: string): string {
  const binDir = findOpencodeBinDir(key)
  rmSync(binDir, { recursive: true, force: true })
  mkdirSync(binDir, { recursive: true })

  const dest = path.join(binDir, findBinaryName(OPENCODE_BINARY))
  cpSync(sourceBinary, dest)
  if (process.platform !== 'win32') {
    chmodSync(dest, 0o755)
  }
  console.log(`[opencode] 已落盘 → ${dest}`)
  return dest
}

async function ensureOpencodeFromRelease(key: string): Promise<string> {
  const lock = readToolsLock()
  const pin = requireLockPin(lock, 'opencode', key)
  const vendorDir = findOpencodeVendorDir(key)
  mkdirSync(vendorDir, { recursive: true })

  const ext = parseArchiveExt(pin.url)
  const archivePath = path.join(vendorDir, `opencode-${pin.version}${ext}`)
  const extractDir = path.join(vendorDir, 'extract')

  await fetchVerified(pin.url, archivePath, pin.sha256)

  rmSync(extractDir, { recursive: true, force: true })
  extractArchive(archivePath, extractDir)

  const binaryName = findBinaryName(OPENCODE_BINARY)
  const found = findFileInTree(extractDir, binaryName)
  if (!found) {
    throw new Error(`[opencode] 归档内未找到 ${binaryName}: ${key}`)
  }

  const staged = stageOpencodeFiles(found, key)
  rmSync(extractDir, { recursive: true, force: true })
  assertOpencodeVersion(staged, pin.version)
  writeVendorVersion(vendorDir, pin.version)
  console.log(`[opencode] 已从官方发布包安装 ${pin.version}`)
  return staged
}

async function ensureOpencodeVendor(key = findPlatformKey()): Promise<string> {
  // 显式指定优先：它存在的意义就是盖过 lock —— 版本记号在这里反而是假证据，清掉
  const local = findExplicitOpencodePath()
  if (local) {
    const staged = stageOpencodeFiles(local, key)
    clearVendorVersion(findOpencodeVendorDir(key))
    const reported = readOpencodeBinaryVersion(staged)
    console.log(
      `[opencode] 使用 OPENCODE_BINARY 指定的二进制 ${local}（自述版本 ${reported ?? '未知'}，` +
        '需自行与 @opencode/client 对齐）'
    )
    return staged
  }

  const lock = readToolsLock()
  const pin = requireLockPin(lock, 'opencode', key)
  const vendorDir = findOpencodeVendorDir(key)
  const binary = findOpencodeBinary(key)
  if (isVendorReady(vendorDir, pin.version, binary)) {
    console.log(`[opencode] 缓存命中 ${pin.version} → ${binary}`)
    return binary
  }

  if (existsSync(binary)) {
    console.log(`[opencode] 缓存版本不是 ${pin.version}，按 lock 重下`)
  }
  return ensureOpencodeFromRelease(key)
}

function listOpencodeRuntimeFiles(key = findPlatformKey()): string[] {
  const binary = findOpencodeBinary(key)
  return existsSync(binary) ? [binary] : []
}

const OpencodeTool: ToolStrategy = {
  key: 'opencode',
  async ensure(platformKey) {
    await ensureOpencodeVendor(platformKey)
  },
  findRuntimeFiles(platformKey) {
    return listOpencodeRuntimeFiles(platformKey)
  }
}

export {
  ensureOpencodeVendor,
  findOpencodeBinary,
  findOpencodeBinDir,
  findOpencodeVendorDir,
  listOpencodeRuntimeFiles,
  OpencodeTool
}
