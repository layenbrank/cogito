import { execSync } from 'node:child_process'
import path from 'node:path'

import { REPO_ROOT } from '../../../core/paths.ts'

import {
  COGITO_MCP,
  COREX_DAEMON,
  COREX_MCP,
  FFMPEG_BINARY,
  GOOSE_BINARY,
  PANDOC_BINARY
} from '../infra/constants.ts'
import { findBinaryName } from '../infra/platform.ts'

import type { StageTarget } from '../infra/stage.ts'

function findHostTriple(): string {
  return execSync('rustc --print host-tuple', { encoding: 'utf8' }).trim()
}

function findExeSuffix(): string {
  return process.platform === 'win32' ? '.exe' : ''
}

/**
 * Tauri externalBin expects corex-daemon / corex-mcp / cogito-mcp / goose with -<host-triple>[.exe].
 * Other tools keep simple names (pandoc.exe, ffmpeg.exe, pdfium.dll).
 */
const ClientTarget: StageTarget = {
  id: 'client',
  findStagedDir() {
    return path.join(REPO_ROOT, 'apps', 'client', 'src-tauri', 'binaries')
  },
  mapFileName(fileName) {
    const triple = findHostTriple()
    const suffix = findExeSuffix()
    const daemon = findBinaryName(COREX_DAEMON)
    if (fileName === daemon) {
      return `corex-daemon-${triple}${suffix}`
    }
    const mcp = findBinaryName(COREX_MCP)
    if (fileName === mcp) {
      return `corex-mcp-${triple}${suffix}`
    }
    const cogitoMcp = findBinaryName(COGITO_MCP)
    if (fileName === cogitoMcp) {
      return `cogito-mcp-${triple}${suffix}`
    }
    const goose = findBinaryName(GOOSE_BINARY)
    if (fileName === goose) {
      return `goose-${triple}${suffix}`
    }
    return fileName
  },
  requiredNames() {
    const triple = findHostTriple()
    const suffix = findExeSuffix()
    const names = [
      `corex-daemon-${triple}${suffix}`,
      `corex-mcp-${triple}${suffix}`,
      `cogito-mcp-${triple}${suffix}`,
      `goose-${triple}${suffix}`
    ]
    if (process.platform === 'win32') {
      names.push('pdfium.dll')
    }
    // full 档位要真的把可选件打进包：只在这里断言，CI 的 `verify client` 就能在
    // 「tools.lock 没有该平台 pin / 归档里没有 ffprobe」时当场失败，而不是等打包脚本报错。
    if ((process.env.CLIENT_SIDECAR_VARIANT ?? '').trim().toLowerCase() === 'full') {
      names.push(
        ...[PANDOC_BINARY, FFMPEG_BINARY, 'ffprobe'].map(function (name) {
          return `${name}${suffix}`
        })
      )
    }
    return names
  }
}

export { ClientTarget }
