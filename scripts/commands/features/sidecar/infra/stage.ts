import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import {
  SIDECAR_SCHEMA_VERSION,
  parseStagingChecksums as parseChecksumsDocument
} from '@cogito/sidecar'

import { TOOLS } from '../tools/catalog.ts'

import { CHECKSUMS_FILE } from './constants.ts'
import { hashFile } from './hash.ts'
import { hasLockPin, isOnDemandTool, readToolsLock, requireLockPin } from './lock.ts'
import { findOnlineTool, stageOnlineTool } from './manifest.ts'
import { findPlatformKey } from './platform.ts'

import type { StagedFile, StagingChecksums } from '@cogito/sidecar'
import type { ToolStrategy } from '../tools/types.ts'

interface StageTarget {
  id: string
  findStagedDir(platformKey: string): string
  /** 拷贝到落盘目录时可选重映射文件名 */
  mapFileName?(fileName: string): string
  /**
   * 这个目标要哪些工具；不写 = 全部要。
   *
   * studio 不要 goose（agent 走 opencode；goose 是 client 的 ACP 侧车），
   * 随包只会白白多 256 MB。
   */
  tools?: string[]
  /**
   * 落盘后**必须**出现在目录里的文件名（已经过 mapFileName）。
   * 缺一则 bootstrap / verify 失败——避免半成品 checksums 静默通过。
   */
  requiredNames?(): string[]
}

/** 这个目标要不要这个工具（没声明 tools 就是都要） */
function hasTool(target: StageTarget, toolKey: string): boolean {
  return !target.tools || target.tools.includes(toolKey)
}

/** 回落到 lock 的 release 归档：先按 lock 下载/解压到缓存，再拿出运行时文件 */
async function ensureVendored(tool: ToolStrategy, platform: string): Promise<string[]> {
  await tool.ensure(platform)
  return tool.findRuntimeFiles(platform)
}

/** 落盘清单：逐文件记「谁（tool@version）+ 校验和 + 是否按需」，不留裸哈希映射 */
function writeChecksums(dir: string, files: Record<string, StagedFile>, platform: string): void {
  const payload: StagingChecksums = { schemaVersion: SIDECAR_SCHEMA_VERSION, platform, files }
  writeFileSync(path.join(dir, CHECKSUMS_FILE), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

function parseStagingChecksums(stagedDir: string): StagingChecksums {
  const filePath = path.join(stagedDir, CHECKSUMS_FILE)
  if (!existsSync(filePath)) {
    throw new Error(`[stage] 缺少 ${filePath}；请先执行 sidecar bootstrap`)
  }
  return parseChecksumsDocument(JSON.parse(readFileSync(filePath, 'utf8')) as unknown, filePath)
}

async function stageVendoredTools(
  target: StageTarget,
  platform = findPlatformKey()
): Promise<void> {
  const lock = readToolsLock()
  const destDir = target.findStagedDir(platform)
  mkdirSync(destDir, { recursive: true })
  const files: Record<string, StagedFile> = {}
  const onDemandFiles: string[] = []

  for (const tool of Object.values(TOOLS)) {
    if (!hasTool(target, tool.key)) {
      console.log(`[stage:${target.id}] 跳过 ${tool.key}（该目标用不到）`)
      continue
    }
    if (!tool.isLocal && !hasLockPin(lock, tool.key, platform)) {
      // corex / pdfium 缺了起不来；client 另需 goose（build.rs / externalBin）
      const required =
        tool.key === 'corex' ||
        tool.key === 'pdfium' ||
        (target.id === 'client' && tool.key === 'goose')
      if (required) {
        throw new Error(`[stage] 当前平台无 ${tool.key} 钉死版本: ${platform}（应用=${target.id}）`)
      }
      continue
    }
    // 取包顺序：**在线包优先**（R2，与运行时下载同一份字节，也不依赖连不上的 GitHub），
    // 没有在线包的（corex / goose / 未发布在线包的平台）回落到 lock 的 release 归档。
    // 本仓自建工具（`isLocal`）没有这两种来源：`ensure` 直接 cargo 构建。
    const online = tool.isLocal ? undefined : findOnlineTool(tool.key, platform)
    const sources = online
      ? await stageOnlineTool(online.key, online.tool, online.package, platform)
      : await ensureVendored(tool, platform)
    // 版本取自「这一趟真正用的那份」：在线包与 lock 在同一条版本线上（宿主测试守着），
    // 只有在线包没发的平台才回落 lock。
    const version = tool.isLocal
      ? 'local'
      : (online?.tool.version ?? requireLockPin(lock, tool.key, platform).version)
    const onDemand = tool.isLocal ? false : isOnDemandTool(lock, tool.key)

    for (const src of sources) {
      const rawName = path.basename(src)
      const fileName = target.mapFileName ? target.mapFileName(rawName) : rawName
      const dest = path.join(destDir, fileName)
      cpSync(src, dest)
      const sha256 = hashFile(dest)
      files[fileName] = onDemand
        ? { tool: tool.key, version, sha256, onDemand: true }
        : { tool: tool.key, version, sha256 }
      if (onDemand) {
        onDemandFiles.push(fileName)
      }
      console.log(`[stage:${target.id}] ${fileName}`)
    }
  }

  assertRequiredStaged(target, destDir, files)

  writeChecksums(destDir, files, platform)
  console.log(
    `[stage:${target.id}] 已写入 ${CHECKSUMS_FILE}（${Object.keys(files).length} 个文件，` +
      `其中按需 ${onDemandFiles.length} 个）→ ${destDir}`
  )
}

/** 必选文件必须进 checksums 且落在磁盘上。 */
function assertRequiredStaged(
  target: StageTarget,
  destDir: string,
  files: Record<string, StagedFile>
): void {
  const required = target.requiredNames?.() ?? []
  if (required.length === 0) {
    return
  }
  const missing: string[] = []
  for (const name of required) {
    const filePath = path.join(destDir, name)
    if (!existsSync(filePath) || !files[name]) {
      missing.push(name)
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `[stage:${target.id}] 缺少必需落盘文件: ${missing.join(', ')}。` +
        '确认 corex 发版 ZIP 含 corex-mcp(+pdfium)，且 tools.lock 已指向该完整包；' +
        '然后重跑 `pnpm command sidecar bootstrap ' +
        target.id +
        '`。'
    )
  }
}

export { assertRequiredStaged, hasTool, parseStagingChecksums, stageVendoredTools, writeChecksums }
export type { StageTarget, StagingChecksums }
