/**
 * 在 Electron 运行时里跑数据库集成测试。
 *
 * 为什么要绕一层：`better-sqlite3` 是按 Electron ABI 编译的原生模块
 * （postinstall 的 electron-rebuild 负责），普通 Node 加载会报 ABI 不匹配。
 * Electron 自带 `ELECTRON_RUN_AS_NODE=1`，可把它当 Node 用，且加载的原生模块就是
 * Electron ABI —— 与打包后应用里的运行环境一致。
 *
 *   pnpm --filter @cogito/studio test:db
 *   pnpm --filter @cogito/studio test:db -- --watch     # 额外参数原样透传
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = resolve(HERE, '..')
const require = createRequire(import.meta.url)

/** electron 包被 hoist 到 workspace 根，用解析结果取二进制路径 */
const electronBin = require('electron')
if (typeof electronBin !== 'string' || !existsSync(electronBin)) {
  console.error(
    '未找到 Electron 二进制。请先执行：\n' +
      '  node node_modules/electron/install.js\n' +
      '（网络受限时加 ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/）'
  )
  process.exit(1)
}

const vitestDir = dirname(require.resolve('vitest/package.json'))
const vitestEntry = join(vitestDir, 'vitest.mjs')

const result = spawnSync(electronBin, [vitestEntry, 'run', ...process.argv.slice(2)], {
  cwd: PACKAGE_ROOT,
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', STUDIO_DB_TESTS: '1' }
})

process.exit(result.status ?? 1)
