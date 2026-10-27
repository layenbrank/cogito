import { execFileSync } from 'node:child_process'
import path from 'node:path'

import { REPO_ROOT } from '../../../core/paths.ts'

import { COGITO_MCP } from '../infra/constants.ts'
import { findBinaryName } from '../infra/platform.ts'

import type { ToolStrategy } from './types.ts'

const SRC_TAURI_DIR = path.join(REPO_ROOT, 'apps', 'client', 'src-tauri')

/**
 * 本仓自建的 MCP 侧车：没有下载源、没有 lock 钉版，`ensure` 就是 cargo 构建。
 *
 * profile 默认 `release`（随包发的是它）；本地想加快可用
 * `COGITO_MCP_PROFILE=dev` 切到 debug 产物（cargo 的 dev profile 目录叫 `debug`）。
 */
function findProfileName(): string {
  return process.env.COGITO_MCP_PROFILE?.trim() || 'release'
}

/** cargo 的 profile 目录名与 `--profile` 入参不一定同名（dev → debug） */
function findProfileDir(profile: string): string {
  return profile === 'dev' ? 'debug' : profile
}

function findTargetDir(): string {
  const raw = execFileSync(
    'cargo',
    ['metadata', '--format-version', '1', '--no-deps', '--offline'],
    { cwd: SRC_TAURI_DIR, encoding: 'utf8' }
  )
  return (JSON.parse(raw) as { target_directory: string }).target_directory
}

const CogitoTool: ToolStrategy = {
  key: 'cogito',
  isLocal: true,
  async ensure() {
    const profile = findProfileName()
    console.log(`[cogito] cargo build -p ${COGITO_MCP} --profile ${profile}`)
    execFileSync('cargo', ['build', '-p', COGITO_MCP, '--profile', profile], {
      cwd: SRC_TAURI_DIR,
      stdio: 'inherit'
    })
  },
  findRuntimeFiles() {
    const binary = findBinaryName(COGITO_MCP)
    return [path.join(findTargetDir(), findProfileDir(findProfileName()), binary)]
  }
}

export { CogitoTool }
