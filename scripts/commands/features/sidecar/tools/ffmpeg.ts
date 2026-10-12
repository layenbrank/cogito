import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'

import { FFMPEG_BINARY, VENDOR_DIR } from '../infra/constants.ts'
import { fetchVerified } from '../infra/download.ts'
import { extractArchive, findFileInTree, parseArchiveExt } from '../infra/extract.ts'
import { readToolsLock, requireLockPin } from '../infra/lock.ts'
import { findBinaryName, findPlatformKey } from '../infra/platform.ts'
import { isVendorReady, writeVendorVersion } from '../infra/vendor.ts'

import type { ToolStrategy } from './types.ts'

function findFfmpegVendorDir(key = findPlatformKey()): string {
  return path.join(VENDOR_DIR, 'ffmpeg', key)
}

/** 归档里要留下的可执行文件（不带扩展名）；findFileNames 与 ensure 共用同一份 */
const FFMPEG_BINARIES = ['ffmpeg', 'ffprobe', 'ffplay']

function findFfmpegBinDir(key = findPlatformKey()): string {
  return path.join(findFfmpegVendorDir(key), 'bin')
}

function findFfmpegBinary(key = findPlatformKey()): string {
  return path.join(findFfmpegBinDir(key), findBinaryName(FFMPEG_BINARY))
}

/**
 * 按 tools.lock 下载归档到缓存 ffmpeg/<platform>/bin：win32 是自建 R2 的重打包包
 * （与在线包同一条制品，可执行文件平铺在包根），linux-x64 是 BtbN/FFmpeg-Builds release。
 * 落盘 ffmpeg(.exe)；归档内若有 ffprobe/ffplay 一并拷贝。
 *
 * 缓存命中不是「有文件就算」，而是「有 lock 里那个版本」：见 infra/vendor.ts
 */
async function ensureFfmpegVendor(key = findPlatformKey()): Promise<string> {
  const lock = readToolsLock()
  const pin = requireLockPin(lock, 'ffmpeg', key)
  const vendorDir = findFfmpegVendorDir(key)
  const binary = findFfmpegBinary(key)
  if (isVendorReady(vendorDir, pin.version, binary)) {
    console.log(`[ffmpeg] 缓存命中 ${pin.version} → ${binary}`)
    return binary
  }

  mkdirSync(vendorDir, { recursive: true })

  const ext = parseArchiveExt(pin.url)
  const archivePath = path.join(vendorDir, `ffmpeg-${pin.version}${ext}`)
  const extractDir = path.join(vendorDir, 'extract')

  await fetchVerified(pin.url, archivePath, pin.sha256)

  rmSync(extractDir, { recursive: true, force: true })
  extractArchive(archivePath, extractDir)

  const ffmpegName = findBinaryName(FFMPEG_BINARY)
  const found = findFileInTree(extractDir, ffmpegName)
  if (!found) {
    throw new Error(`[ffmpeg] 归档内未找到 ${ffmpegName}`)
  }

  const binDir = findFfmpegBinDir(key)
  rmSync(binDir, { recursive: true, force: true })
  mkdirSync(binDir, { recursive: true })
  cpSync(found, path.join(binDir, ffmpegName))

  const srcDir = path.dirname(found)
  for (const name of FFMPEG_BINARIES) {
    const fileName = findBinaryName(name)
    if (fileName === ffmpegName) {
      continue
    }
    const candidate = path.join(srcDir, fileName)
    if (existsSync(candidate)) {
      cpSync(candidate, path.join(binDir, fileName))
    } else {
      const nested = findFileInTree(extractDir, fileName)
      if (nested) {
        cpSync(nested, path.join(binDir, fileName))
      }
    }
  }

  if (process.platform !== 'win32') {
    for (const entry of readdirSync(binDir)) {
      chmodSync(path.join(binDir, entry), 0o755)
    }
  }

  rmSync(extractDir, { recursive: true, force: true })
  writeVendorVersion(vendorDir, pin.version)
  console.log(`[ffmpeg] 已落盘 ${pin.version} → ${binDir}`)
  return binary
}

function listFfmpegRuntimeFiles(key = findPlatformKey()): string[] {
  const binDir = findFfmpegBinDir(key)
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

const FfmpegTool: ToolStrategy = {
  key: 'ffmpeg',
  async ensure(platformKey) {
    await ensureFfmpegVendor(platformKey)
  },
  findRuntimeFiles(platformKey) {
    return listFfmpegRuntimeFiles(platformKey)
  }
}

export {
  ensureFfmpegVendor,
  FfmpegTool,
  findFfmpegBinary,
  findFfmpegBinDir,
  findFfmpegVendorDir,
  listFfmpegRuntimeFiles
}
