import { existsSync } from 'node:fs'
import path from 'node:path'

import { CHECKSUMS_FILE } from './constants.ts'
import { hashFile } from './hash.ts'
import { parseStagingChecksums } from './stage.ts'
import { findTarget } from '../targets/catalog.ts'

function verifyStagedDir(stagedDir: string, label: string, platformKey: string): void {
  const expected = parseStagingChecksums(stagedDir)

  // 清单自带平台：落盘目录放错平台时，报「拿错平台的二进制」而不是一串哈希不匹配
  if (expected.platform !== platformKey) {
    throw new Error(
      `[verify:${label}] ${CHECKSUMS_FILE} 是 ${expected.platform} 的落盘清单，` +
        `当前平台是 ${platformKey}（请重跑 sidecar bootstrap）`
    )
  }

  for (const [fileName, entry] of Object.entries(expected.files)) {
    const filePath = path.join(stagedDir, fileName)
    if (!existsSync(filePath)) {
      throw new Error(`[verify] 缺少落盘文件: ${filePath}`)
    }
    const actual = hashFile(filePath)
    if (actual !== entry.sha256) {
      throw new Error(`[verify] 哈希不匹配 ${fileName}: 期望 ${entry.sha256}，实际 ${actual}`)
    }
  }

  // 目标声明的必需文件必须在 checksums 里（防止旧半成品 checksums 漏 mcp/pdfium）
  try {
    const target = findTarget(label)
    const required = target.requiredNames?.() ?? []
    const missing = required.filter(function (name) {
      return !expected.files[name]
    })
    if (missing.length > 0) {
      throw new Error(
        `[verify:${label}] ${CHECKSUMS_FILE} 缺少必需条目: ${missing.join(', ')}。` +
          '请重跑 bootstrap 生成完整清单。'
      )
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`[verify:${label}]`)) {
      throw error
    }
    // label 不是已知 target id 时只做哈希校验
  }

  console.log(
    `[verify:${label}] 通过（${Object.keys(expected.files).length} 个文件，${CHECKSUMS_FILE}）`
  )
}

export { verifyStagedDir }
