import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync
} from 'node:fs'
import path from 'node:path'

import { parseOnlineManifest as parseManifestDocument } from '@i-thinking/sidecar'

import { REPO_ROOT } from '../../../core/paths.ts'
import { VENDOR_DIR } from './constants.ts'
import { fetchVerified } from './download.ts'
import { extractArchive, findFileInTree } from './extract.ts'
import { findBinaryName, findPlatformKey } from './platform.ts'

import type { OnlineManifest, OnlineTool, SidecarPackage } from '@i-thinking/sidecar'

/**
 * Studio 的**在线包清单**：`apps/studio/sidecar/manifest.json`。
 *
 * 这份数据有两个消费方：
 * - 宿主：构建期内联进 main bundle（`apps/studio/src/host/capabilities/tools/catalog.ts`）；
 * - 仓库 CLI：**落盘按需工具时优先用它**，以及发新包后核对 R2 上的东西：
 *
 *   pnpm command sidecar manifest            打印当前平台的声明
 *   pnpm command sidecar manifest --verify   真的下载并核 sha256（几十 ~ 几百 MB）
 *
 * 落盘为什么优先走它：lock 里 pandoc / opencode / ffmpeg(linux-x64) 的归档在 **GitHub Releases**
 * （本仓开发机常年连不上），而 R2 上的重打包包与运行时下载的是**同一份字节**
 * （ffmpeg(win32) 的 lock pin 已经就是这一条）—— 落盘跟着它走，既不依赖 GitHub，
 * 又保证「内置的那份」与「在线下载的那份」不会分叉。
 */

const MANIFEST_PATH = path.join(REPO_ROOT, 'apps', 'studio', 'sidecar', 'manifest.json')

interface OnlineToolEntry {
  /** 工具键（`pandoc` / `ffmpeg` / `opencode`）—— 不是数据库 id */
  key: string
  tool: OnlineTool
  /** 这个工具在当前平台的那份包（直链 + 哈希） */
  package: SidecarPackage
}

/** 读 + 校验 `sidecar/manifest.json`：形状（schemaVersion / tools / platforms）归契约包管 */
function parseOnlineManifest(filePath = MANIFEST_PATH): OnlineManifest {
  if (!existsSync(filePath)) {
    throw new Error(`[manifest] 缺少 ${filePath}`)
  }
  return parseManifestDocument(JSON.parse(readFileSync(filePath, 'utf8')) as unknown, filePath)
}

/** 当前平台声明了哪些在线包；平台没声明的工具不会出现在这里 */
function findOnlineTools(platform = findPlatformKey()): OnlineToolEntry[] {
  const manifest = parseOnlineManifest()
  const found: OnlineToolEntry[] = []
  for (const [key, tool] of Object.entries(manifest.tools)) {
    const entry = tool.platforms[platform]
    if (entry) {
      found.push({ key, tool, package: entry })
    }
  }
  return found
}

/** 某个工具在当前平台的在线包；没有就返回 null（调用方回落到 lock） */
function findOnlineTool(key: string, platform = findPlatformKey()): OnlineToolEntry | null {
  const tool = parseOnlineManifest().tools[key]
  const pkg = tool?.platforms[platform]
  return tool && pkg ? { key, tool, package: pkg } : null
}

/** 在线包的缓存目录：`.cache/sidecar/<tool>/online/<platform>/` */
function findOnlineDir(key: string, platform = findPlatformKey()): string {
  return path.join(VENDOR_DIR, key, 'online', platform)
}

/** 平台键（`win32-x64`）里的平台名：决定补不补 `.exe` */
function findPlatformOf(platform: string): string {
  return platform.split('-')[0] ?? process.platform
}

function findExpectedNames(tool: OnlineTool, platform: string): string[] {
  const os = findPlatformOf(platform)
  return tool.binaries.map(function (name) {
    return findBinaryName(name, os)
  })
}

/** 缓存命中：留下的文件里至少有一个是 manifest 声明的二进制 */
function isOnlineReady(binDir: string, tool: OnlineTool, platform: string): boolean {
  if (!existsSync(binDir)) {
    return false
  }
  const expected = new Set(findExpectedNames(tool, platform))
  return readdirSync(binDir).some(function (entry) {
    return expected.has(entry)
  })
}

/**
 * 落盘一个在线包：下载（核 sha256）→ 解压 → 只留下 manifest 声明的文件。
 * 缓存命中时只做本地解压，不走网络。返回留下的文件路径。
 */
async function stageOnlineTool(
  key: string,
  tool: OnlineTool,
  // 属性名统一叫 package（与宿主侧 ToolSpec 一致）；`package` 是保留字，参数只能换名
  pkg: SidecarPackage,
  platform = findPlatformKey()
): Promise<string[]> {
  const dir = findOnlineDir(key, platform)
  const binDir = path.join(dir, 'bin')

  if (isOnlineReady(binDir, tool, platform)) {
    console.log(`[online:${key}] 缓存命中 → ${binDir}`)
    return findBinaries(binDir)
  }

  mkdirSync(dir, { recursive: true })
  const archivePath = path.join(dir, path.basename(new URL(pkg.url).pathname))
  await fetchVerified(pkg.url, archivePath, pkg.sha256)

  const extractDir = path.join(dir, 'extract')
  rmSync(extractDir, { recursive: true, force: true })
  extractArchive(archivePath, extractDir)

  rmSync(binDir, { recursive: true, force: true })
  mkdirSync(binDir, { recursive: true })
  const kept: string[] = []
  for (const fileName of findExpectedNames(tool, platform)) {
    const found = findFileInTree(extractDir, fileName)
    if (!found) {
      continue
    }
    const dest = path.join(binDir, fileName)
    cpSync(found, dest)
    if (process.platform !== 'win32') {
      chmodSync(dest, 0o755)
    }
    kept.push(dest)
  }
  if (kept.length === 0) {
    throw new Error(`[online:${key}] 归档里没找到 ${tool.binaries.join(' / ')}`)
  }

  rmSync(extractDir, { recursive: true, force: true })
  rmSync(archivePath, { force: true })
  console.log(`[online:${key}] 已落盘 ${kept.length} 个文件 → ${binDir}`)
  return kept
}

function findBinaries(binDir: string): string[] {
  return readdirSync(binDir).map(function (entry) {
    return path.join(binDir, entry)
  })
}

/** 下载并核对哈希；缓存命中时不走网络 */
async function verifyOnlineTool(
  key: string,
  pkg: SidecarPackage,
  platform = findPlatformKey()
): Promise<void> {
  const fileName = path.basename(new URL(pkg.url).pathname)
  const dest = path.join(findOnlineDir(key, platform), fileName)
  await fetchVerified(pkg.url, dest, pkg.sha256)
  console.log(`[manifest] ${key} 校验通过（${fileName}）`)
}

export { findOnlineTool, findOnlineTools, parseOnlineManifest, stageOnlineTool, verifyOnlineTool }
export type { OnlineManifest, OnlineTool, OnlineToolEntry }
