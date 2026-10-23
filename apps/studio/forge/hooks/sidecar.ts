import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import {
  findPlatformKey,
  listOnDemandFiles,
  parseStagingChecksums as parseChecksumsDocument,
  ONLINE_TOOL_KEYS
} from '@cogito/sidecar'

import { PACKAGE_ROOT } from '../constants'
import { SIDECAR_VARIANT } from '../env'

import type { StagingChecksums } from '@cogito/sidecar'

const CHECKSUMS_FILE = 'checksums.json'

/**
 * Studio 安装包里永远不带的文件（即便误进了 staging）。
 * goose 是 client ACP 侧车；agent 走 opencode。
 *
 * 只兜「陈旧的 staging 目录」这一种情形：正常落盘的清单里，studio 目标压根不会收 goose。
 */
const NEVER_BUNDLE = new Set(['goose.exe', 'goose'])

function hashFile(filePath: string): string {
  const hash = createHash('sha256')
  hash.update(readFileSync(filePath))
  return hash.digest('hex')
}

function findStagedSidecarDir(key = findPlatformKey()): string {
  return path.join(PACKAGE_ROOT, 'sidecar', 'staging', key)
}

/**
 * 读 + 校验落盘清单：形状（`schemaVersion` / `platform` / 逐文件的 `tool` + `version` + `sha256`）
 * 归契约包 `@cogito/sidecar` 管 —— 旧版（没有逐条 `onDemand`）会在这里响亮失败，
 * 而不是被猜着读（以前按文件名正则兜底，猜漏了就是把 800MB 的按需工具打进精简版）。
 */
function parseStagingChecksums(key: string): StagingChecksums {
  const filePath = path.join(findStagedSidecarDir(key), CHECKSUMS_FILE)
  if (!existsSync(filePath)) {
    throw new Error(`[sidecar] missing ${filePath}. Run: pnpm command sidecar bootstrap studio`)
  }
  const checksums = parseChecksumsDocument(
    JSON.parse(readFileSync(filePath, 'utf8')) as unknown,
    filePath
  )
  if (checksums.platform !== key) {
    throw new Error(
      `[sidecar] ${filePath} 是 ${checksums.platform} 的落盘清单，与 ${key} 不符` +
        '（staging 目录放错了平台，重跑 pnpm command sidecar bootstrap studio）'
    )
  }
  return checksums
}

/** 落盘清单里某个工具的文件名（用来判「完整版要的按需工具在不在」） */
function findStagedFilesOfTool(checksums: StagingChecksums, toolKey: string): string[] {
  return Object.keys(checksums.files).filter(function (fileName) {
    return checksums.files[fileName]?.tool === toolKey
  })
}

/**
 * 将当前平台 staged 侧车复制到 resources/sidecar，并按本地 checksums.json 校验 SHA-256。
 *
 * 档位决定按需工具的去留（见 forge/env.ts 的 SIDECAR_VARIANT）：
 * - lite：pandoc / ffmpeg / opencode 不复制 —— 它们由 Studio 运行时从在线源下载，
 *   安装包里带上去只是无谓地大 800 多 MB；
 * - full：要求它们都在，缺了直接报错（staging 不全，重跑一次 bootstrap）。
 */
function copyAndVerifySidecars(
  buildPath: string,
  _electronVersion: string,
  platform: string,
  arch: string,
  done: (err?: Error) => void
): void {
  try {
    const key = findPlatformKey(platform, arch)
    const srcDir = findStagedSidecarDir(key)
    if (!existsSync(srcDir) || readdirSync(srcDir).length === 0) {
      done(
        new Error(
          `[sidecar] no staged binaries at ${srcDir}. Run: pnpm command sidecar bootstrap studio`
        )
      )
      return
    }

    const expected = parseStagingChecksums(key)
    const onDemand = new Set(listOnDemandFiles(expected))
    const destDir = path.join(buildPath, '..', 'sidecar')
    mkdirSync(destDir, { recursive: true })

    const files = Object.entries(expected.files)
    if (SIDECAR_VARIANT === 'full') {
      const missing = ONLINE_TOOL_KEYS.filter(function (toolKey) {
        return findStagedFilesOfTool(expected, toolKey).length === 0
      })
      if (missing.length > 0) {
        done(
          new Error(
            `[sidecar] 完整版缺少按需工具：${missing.join(', ')}。` +
              ' staging 不全：先跑 pnpm command sidecar bootstrap studio'
          )
        )
        return
      }
    }

    const skipped: string[] = []
    for (const [fileName, entry] of files) {
      if (NEVER_BUNDLE.has(fileName) || (SIDECAR_VARIANT === 'lite' && onDemand.has(fileName))) {
        skipped.push(fileName)
        continue
      }
      const src = path.join(srcDir, fileName)
      if (!existsSync(src)) {
        done(new Error(`[sidecar] missing staged file: ${src}`))
        return
      }
      const actual = hashFile(src)
      if (actual !== entry.sha256) {
        done(
          new Error(
            `[sidecar] hash mismatch for ${fileName}: expected ${entry.sha256}, got ${actual}`
          )
        )
        return
      }
      cpSync(src, path.join(destDir, fileName))
    }

    console.log(
      `[forge] 侧车档位 ${SIDECAR_VARIANT}：已复制 ${files.length - skipped.length} 个文件` +
        (skipped.length > 0 ? `，未随包：${skipped.join(', ')}` : '')
    )
    done()
  } catch (error) {
    // 交给 Forge 的 done 之前先出声：构建日志里要留痕
    console.warn('[forge] sidecar 复制/校验失败', error)
    done(error instanceof Error ? error : new Error(String(error)))
  }
}

export { copyAndVerifySidecars, findStagedSidecarDir, parseStagingChecksums }
