import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { DOWNLOADS_CACHE } from '../../../core/paths.ts'

const FEATURE_DIR = path.dirname(fileURLToPath(import.meta.url))
const SIDECAR_FEATURE_ROOT = path.resolve(FEATURE_DIR, '..')
const TOOLS_LOCK_PATH = path.join(SIDECAR_FEATURE_ROOT, 'tools.lock.json')
/** 共享下载/解压缓存（原各 app 的 vendor/）。 */
const VENDOR_DIR = DOWNLOADS_CACHE
const CHECKSUMS_FILE = 'checksums.json'

const COREX_CLI = 'corex'
const COREX_DAEMON = 'corex-daemon'
/** MCP 侧车（供 opencode 等按名字拉起） */
const COREX_MCP = 'corex-mcp'
/** 本仓 Cargo 构建的 MCP 侧车（Agent 本地工具面，无下载源） */
const COGITO_MCP = 'cogito-mcp'
const GOOSE_BINARY = 'goose'
const PANDOC_BINARY = 'pandoc'
const FFMPEG_BINARY = 'ffmpeg'
const OPENCODE_BINARY = 'opencode'

export {
  CHECKSUMS_FILE,
  COGITO_MCP,
  COREX_CLI,
  COREX_DAEMON,
  COREX_MCP,
  FFMPEG_BINARY,
  GOOSE_BINARY,
  OPENCODE_BINARY,
  PANDOC_BINARY,
  SIDECAR_FEATURE_ROOT,
  TOOLS_LOCK_PATH,
  VENDOR_DIR
}
