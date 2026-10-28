/**
 * 守卫：cargo 配置里不许出现「机器特定」的东西。
 *
 * 起因：有人把 `rustc-wrapper = "sccache"` / `SCCACHE_SERVER_PORT = 42222` 写进仓库，
 * 换一台设备后该端口未必能绑，cargo 在 `sccache rustc -vV` 探针阶段就失败，
 * `pnpm dev:client` / service dev 直接退出——看起来像代码问题，实际是环境问题。
 *
 * 规则：编译缓存（sccache 等）与工具链包装器属于**个人环境**，由 `~/.cargo/config.toml`
 * 或环境变量决定；仓库只保留与机器无关的构建参数。
 *
 * 用法：`pnpm check:cargo-config`（也可挂进 CI，零依赖、跨平台）。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** 需要检查的 cargo 配置（相对仓库根） */
const FILES = ['apps/client/src-tauri/.cargo/config.toml', 'apps/service/.cargo/config.toml'] as const

/** 禁止出现在仓库配置里的键（大小写不敏感） */
const FORBIDDEN = [
  { pattern: /^\s*rustc-wrapper\s*=/, hint: 'rustc-wrapper 属个人环境，用 ~/.cargo/config.toml 或 RUSTC_WRAPPER' },
  { pattern: /\bSCCACHE_[A-Z_]+\b/, hint: 'SCCACHE_* 端口/路径因机器而异，不写进仓库' },
  { pattern: /^\s*RUSTC_[A-Z_]+\s*=/, hint: 'RUSTC_* 环境变量属个人环境' }
] as const

/** TOML 里以 `#` 开头的注释行不算（允许保留说明文字） */
function isComment(line: string): boolean {
  return line.trimStart().startsWith('#')
}

const failures: string[] = []

for (const file of FILES) {
  const absolute = resolve(ROOT, file)
  let text: string
  try {
    text = readFileSync(absolute, 'utf8')
  } catch (error) {
    // 配置缺失不是错误：仓库允许没有 .cargo/config.toml
    console.debug(`[check:cargo-config] skip ${file}: ${String(error)}`)
    continue
  }
  const lines = text.split(/\r?\n/)
  lines.forEach(function (line, index) {
    if (isComment(line)) return
    for (const rule of FORBIDDEN) {
      if (!rule.pattern.test(line)) continue
      failures.push(`${file}:${index + 1}  ${line.trim()}\n    → ${rule.hint}`)
    }
  })
}

if (failures.length > 0) {
  console.error('[check:cargo-config] 发现机器特定配置：')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exitCode = 1
} else {
  console.log('[check:cargo-config] OK：仓库 cargo 配置未包含 sccache / rustc 包装器设置')
}
