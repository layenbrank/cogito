/**
 * 打包档位准备：`slim`（默认）/ `full`。
 *
 * 目标（对齐 `apps/studio/forge/hooks/sidecar.ts` 的语义，但 client 是 Tauri 构建）：
 * - 档位单一来源 **`CLIENT_SIDECAR_VARIANT`**，一处解析、三处消费
 *   （本脚本挑文件 → 生成的 config 决定 externalBin/resources → 运行期
 *   `capabilities:probe` 与 `diagnostics:capabilities` 给出档位与工具存在性）；
 * - **slim 保 `corex-daemon` / `corex-mcp` / `cogito-mcp` / `goose` / `pdfium.dll`**
 *   （goose 是 agent 运行时，裁掉等于没有对话能力）；
 * - **full 才带 `pandoc` / `ffmpeg` / `ffprobe`**（体积大头，且可运行期降级）。
 *
 * ## 为什么是「生成 conf + --config」而不是改 tauri.conf.json
 *
 * `tauri.conf.json` 的 `version` 在发布流水线的版本门禁里，就地改写会让
 * 「构建产物」和「仓库状态」不一致。所以这里只生成**增量** conf，
 * 由 `tauri build --config` 合并（对象深合并、数组整体替换）：
 *
 * - 基础 `tauri.conf.json` 的 `resources` **只保留永远在包里的**（icons / pdfium），
 *   可选件默认不在里面 —— 于是 slim 不需要做任何「删除」，full 只需要**追加**。
 * - `externalBin` 两个档位相同（4 个必带），生成 conf 里原样写一遍，便于未来按档位裁剪。
 *
 * 校验：读 `binaries/checksums.json`（契约见 `packages/sidecar/src/schema.ts`，
 * `schemaVersion: 2`），逐个比对 sha256。这里**刻意不 import `@cogito/sidecar`**：
 * 该脚本在 `pnpm install` 之前/之后都可能被执行，多一个 workspace 依赖反而更脆。
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type SidecarVariant = 'slim' | 'full'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const CLIENT_DIR = path.resolve(SCRIPT_DIR, '..')
const TAURI_DIR = path.join(CLIENT_DIR, 'src-tauri')
const BINARIES_DIR = path.join(TAURI_DIR, 'binaries')
const CHECKSUMS_FILE = path.join(BINARIES_DIR, 'checksums.json')
const GENERATED_CONF = path.join(TAURI_DIR, 'tauri.generated.conf.json')
const LOG_PREFIX = '[prepare-binaries]'
/** 与 packages/sidecar/src/schema.ts 的 SIDECAR_SCHEMA_VERSION 对齐 */
const SIDECAR_SCHEMA_VERSION = 2

/** 两个档位都必带的侧车（externalBin） */
const ALWAYS_BINARIES = ['corex-daemon', 'corex-mcp', 'cogito-mcp', 'goose'] as const
/** 两个档位都必带的资源 */
const ALWAYS_RESOURCES: Record<string, string> = {
  'icons/': 'icons/',
  'binaries/pdfium.dll': 'pdfium.dll'
}
/** 只有 full 才带的资源（体积大头，可按需在线安装） */
const FULL_ONLY_RESOURCES: Record<string, string> = {
  'binaries/pandoc.exe': 'binaries/pandoc.exe',
  'binaries/ffmpeg.exe': 'binaries/ffmpeg.exe',
  'binaries/ffprobe.exe': 'binaries/ffprobe.exe'
}

interface StagedFileInfo {
  tool: string
  version: string
  sha256: string
  onDemand?: boolean
}

interface Checksums {
  schemaVersion: number
  platform: string
  files: Record<string, StagedFileInfo>
}

function parseVariant(raw: string | undefined): SidecarVariant {
  return raw?.trim().toLowerCase() === 'full' ? 'full' : 'slim'
}

/** 当前构建目标的 Rust triple（Tauri 用它拼 externalBin 文件名）。 */
function hostTriple(): string {
  const override =
    process.env.TAURI_ENV_TARGET_TRIPLE?.trim() || process.env.CARGO_BUILD_TARGET?.trim()
  if (override) return override
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
  if (process.platform === 'win32') return `${arch}-pc-windows-msvc`
  if (process.platform === 'darwin') return `${arch}-apple-darwin`
  return `${arch}-unknown-linux-gnu`
}

/** 落盘文件名：`corex-daemon-x86_64-pc-windows-msvc.exe`。 */
function stagedFileName(base: string, triple: string): string {
  const suffix = process.platform === 'win32' ? '.exe' : ''
  return `${base}-${triple}${suffix}`
}

function sha256Of(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

/** 读 `binaries/checksums.json`；不存在或形状不对都返回 `null`（构建期降级成 warn）。 */
function readChecksums(): Checksums | null {
  if (!existsSync(CHECKSUMS_FILE)) return null
  try {
    const parsed = JSON.parse(readFileSync(CHECKSUMS_FILE, 'utf8')) as Partial<Checksums>
    if (parsed.schemaVersion !== SIDECAR_SCHEMA_VERSION) {
      console.warn(
        `${LOG_PREFIX} checksums.json 的 schemaVersion 是 ${String(parsed.schemaVersion)}，` +
          `期望 ${SIDECAR_SCHEMA_VERSION}（跳过校验）`
      )
      return null
    }
    if (!parsed.files || typeof parsed.files !== 'object') return null
    return {
      schemaVersion: SIDECAR_SCHEMA_VERSION,
      platform: String(parsed.platform ?? ''),
      files: parsed.files as Record<string, StagedFileInfo>
    }
  } catch (error) {
    console.warn(`${LOG_PREFIX} 解析 checksums.json 失败（跳过校验）`, error)
    return null
  }
}

interface VerifyResult {
  missing: string[]
  mismatched: string[]
  verified: string[]
}

/** 逐个文件比对 sha256（清单里有的才比）。 */
function verifyStaged(
  variant: SidecarVariant,
  triple: string,
  checksums: Checksums | null
): VerifyResult {
  const result: VerifyResult = { missing: [], mismatched: [], verified: [] }
  const required: { base: string; file: string }[] = [...ALWAYS_BINARIES].map(function (base) {
    return { base, file: stagedFileName(base, triple) }
  })
  // pdfium.dll 不按 triple 命名
  required.push({ base: 'pdfium', file: 'pdfium.dll' })

  const extras =
    variant === 'full'
      ? Object.keys(FULL_ONLY_RESOURCES).map(function (key) {
          return { base: path.basename(key), file: path.basename(key) }
        })
      : []

  for (const entry of [...required, ...extras]) {
    const absolute = path.join(BINARIES_DIR, entry.file)
    if (!existsSync(absolute)) {
      result.missing.push(entry.file)
      continue
    }
    const expected = checksums?.files?.[entry.file]?.sha256
    if (expected) {
      const actual = sha256Of(absolute)
      if (actual !== expected) {
        result.mismatched.push(`${entry.file}（期望 ${expected.slice(0, 8)}…，实际 ${actual.slice(0, 8)}…）`)
        continue
      }
    }
    result.verified.push(entry.file)
  }
  return result
}

/** 生成 `tauri.generated.conf.json` 的内容（纯函数，便于自检）。 */
function buildGeneratedConf(variant: SidecarVariant): Record<string, unknown> {
  const resources: Record<string, string> = { ...ALWAYS_RESOURCES }
  if (variant === 'full') {
    Object.assign(resources, FULL_ONLY_RESOURCES)
  }
  return {
    $schema: 'https://schema.tauri.app/config/2',
    bundle: {
      externalBin: ALWAYS_BINARIES.map(function (base) {
        // Tauri 自己在后面拼 -<triple><ext>
        return `binaries/${base}`
      }),
      resources
    }
  }
}

/** slim 的自检：生成结果里绝不能出现可选件（防止有人改回注释里那张表）。 */
function assertSlimExcludesOptional(conf: Record<string, unknown>): void {
  const resources = (conf.bundle as { resources?: Record<string, string> } | undefined)?.resources
  if (!resources) throw new Error(`${LOG_PREFIX} 生成 conf 缺少 bundle.resources`)
  for (const key of Object.keys(FULL_ONLY_RESOURCES)) {
    if (key in resources) {
      throw new Error(`${LOG_PREFIX} slim 档位不应包含 ${key}`)
    }
  }
}

/**
 * 主入口：解析档位 → 校验产物 → 写生成 conf。
 * 返回档位，供 `build.ts` 写进子进程环境（Rust 侧 `option_env!` 读它）。
 */
function prepareBinaries(): SidecarVariant {
  const variant = parseVariant(process.env.CLIENT_SIDECAR_VARIANT)
  const triple = hostTriple()
  const checksums = readChecksums()
  const verify = verifyStaged(variant, triple, checksums)

  if (verify.mismatched.length > 0) {
    throw new Error(
      `${LOG_PREFIX} 侧车校验和不匹配：\n  ${verify.mismatched.join('\n  ')}\n` +
        '请重新执行 `pnpm command sidecar bootstrap client`'
    )
  }
  if (verify.missing.length > 0) {
    // 缺件一律失败，不分档位：slim 缺的是 externalBin（corex-daemon / goose …），
    // 装出来是个打不开对话的空壳，静默发出去的代价远高于一次构建失败。
    // 可选件（pandoc / ffmpeg）只在 full 档位才纳入校验，见 verifyStaged。
    throw new Error(
      `${LOG_PREFIX} 缺少侧车产物（${variant}）：\n  ${verify.missing.join('\n  ')}\n` +
        '请先执行 `pnpm command sidecar bootstrap client`'
    )
  }

  const conf = buildGeneratedConf(variant)
  if (variant === 'slim') {
    assertSlimExcludesOptional(conf)
  }
  writeFileSync(GENERATED_CONF, `${JSON.stringify(conf, null, 2)}\n`, 'utf8')

  console.log(`${LOG_PREFIX} 档位=${variant} triple=${triple}`)
  console.log(`${LOG_PREFIX} externalBin=${ALWAYS_BINARIES.length} 项`)
  console.log(
    `${LOG_PREFIX} resources=${Object.keys(
      (conf.bundle as { resources: Record<string, string> }).resources
    ).join(', ')}`
  )
  console.log(
    `${LOG_PREFIX} 已校验 ${verify.verified.length} 个文件` +
      (checksums ? '' : '（无 checksums.json，仅检查存在性）')
  )
  console.log(`${LOG_PREFIX} 已生成 ${path.relative(CLIENT_DIR, GENERATED_CONF)}`)
  return variant
}

export {
  ALWAYS_BINARIES,
  ALWAYS_RESOURCES,
  FULL_ONLY_RESOURCES,
  GENERATED_CONF,
  buildGeneratedConf,
  hostTriple,
  parseVariant,
  prepareBinaries,
  stagedFileName
}
export type { SidecarVariant }
