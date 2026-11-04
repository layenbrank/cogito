/**
 * client build 入口：准备打包档位 → 注入空的 TAURI_SIGNING_PRIVATE_KEY_PASSWORD → tauri build。
 * Windows 系统环境变量无法保存空值；私钥仍从已有环境变量读取。
 *
 * 档位由 `CLIENT_SIDECAR_VARIANT`（`slim`|`full`，默认 `slim`）决定：
 * `prepareBinaries()` 校验侧车产物并写出 `src-tauri/tauri.generated.conf.json`，
 * 这里再用 `--config` 合并给它 —— 不改动受版本门禁的 `tauri.conf.json`。
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { prepareBinaries } from './prepare-binaries.ts'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const CLIENT_DIR = path.resolve(SCRIPT_DIR, '..')
const LOG_PREFIX = '[build]'
/** 相对 `CLIENT_DIR`：tauri 从应用目录解析 `--config` */
const GENERATED_CONF = 'src-tauri/tauri.generated.conf.json'

function build(): void {
  process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ''
  console.log(`${LOG_PREFIX} TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""`)

  const variant = prepareBinaries()
  // Rust 侧 `option_env!("CLIENT_SIDECAR_VARIANT")` 在编译期读这个变量
  process.env.CLIENT_SIDECAR_VARIANT = variant
  console.log(`${LOG_PREFIX} CLIENT_SIDECAR_VARIANT=${variant}`)

  const result = spawnSync('tauri', ['build', '--config', GENERATED_CONF], {
    cwd: CLIENT_DIR,
    env: process.env,
    stdio: 'inherit',
    shell: true
  })

  if (result.error) {
    console.error(`${LOG_PREFIX}`, result.error)
    process.exit(1)
  }

  process.exit(result.status ?? 1)
}

build()

export { build }
