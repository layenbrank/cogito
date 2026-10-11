import path from 'node:path'

import { REPO_ROOT } from '../../../core/paths.ts'

import { COREX_CLI, COREX_DAEMON, COREX_MCP } from '../infra/constants.ts'
import { findBinaryName } from '../infra/platform.ts'

import type { StageTarget } from '../infra/stage.ts'

const StudioTarget: StageTarget = {
  id: 'studio',
  // studio 的 agent 走 opencode，goose 是 client 的 ACP 侧车：不随 studio 落盘（256 MB）
  // pdfium 与 corex-mcp 必须落盘：PDF 动作 + opencode 拉起 MCP。
  tools: ['corex', 'pdfium', 'ffmpeg', 'opencode', 'pandoc'],
  findStagedDir(platformKey) {
    return path.join(REPO_ROOT, 'apps', 'studio', 'sidecar', 'staging', platformKey)
  },
  requiredNames() {
    // 勿直接 .map(findBinaryName)：Array#map 会把 index 传给第二参，被当成 platform
    const names = [COREX_DAEMON, COREX_MCP, COREX_CLI].map(function (name) {
      return findBinaryName(name)
    })
    if (process.platform === 'win32') {
      names.push('pdfium.dll')
    }
    return names
  }
}

export { StudioTarget }
