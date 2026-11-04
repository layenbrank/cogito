/**
 * client build 入口：准备打包档位 → 注入空的 TAURI_SIGNING_PRIVATE_KEY_PASSWORD → tauri build。
 * Windows 系统环境变量无法保存空值；私钥仍从已有环境变量读取。
 *
 * 档位由 `CLIENT_SIDECAR_VARIANT`（`slim`|`full`，默认 `slim`）决定：
 * `prepareBinaries()` 校验侧车产物并写出 `src-tauri/tauri.generated.conf.json`，
 * 这里再用 `--config` 合并给它 —— 不改动受版本门禁的 `tauri.conf.json`。
 *
 * 额外参数（如 `-- --target aarch64-pc-windows-msvc`）原样透传给 `tauri build`。
 * `--target` 还会提前补进环境：`prepareBinaries()` 跑在 tauri 注入
 * `TAURI_ENV_TARGET_TRIPLE` 之前，否则交叉编译会按宿主 arch 去找侧车文件名，
 * 校验的是一批根本不会进包的宿主产物。
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
const TARGET_FLAG = '--target'

/** 从透传参数里挑出 `--target <triple>` / `--target=<triple>` */
function findTargetArg(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === TARGET_FLAG) {
      return args[index + 1]?.trim() || undefined
    }
    if (arg.startsWith(`${TARGET_FLAG}=`)) {
      return arg.slice(TARGET_FLAG.length + 1).trim() || undefined
    }
  }
  return undefined
}

function build(): void {
  process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ''
  console.log(`${LOG_PREFIX} TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""`)

  const passthrough = process.argv.slice(2)
  const target = findTargetArg(passthrough)
  if (target && !process.env.TAURI_ENV_TARGET_TRIPLE && !process.env.CARGO_BUILD_TARGET) {
    // 侧车文件名带 triple：先让 prepareBinaries 知道这次编的是哪个目标
    process.env.TAURI_ENV_TARGET_TRIPLE = target
    console.log(`${LOG_PREFIX} TAURI_ENV_TARGET_TRIPLE=${target}（来自 ${TARGET_FLAG}）`)
  }

  const variant = prepareBinaries()
  // Rust 侧 `option_env!("CLIENT_SIDECAR_VARIANT")` 在编译期读这个变量
  process.env.CLIENT_SIDECAR_VARIANT = variant
  console.log(`${LOG_PREFIX} CLIENT_SIDECAR_VARIANT=${variant}`)

  const result = spawnSync(
    'tauri',
    ['build', '--config', GENERATED_CONF, ...passthrough],
    {
      cwd: CLIENT_DIR,
      env: process.env,
      stdio: 'inherit',
      shell: true
    }
  )

  if (result.error) {
    console.error(`${LOG_PREFIX}`, result.error)
    process.exit(1)
  }

  process.exit(result.status ?? 1)
}

build()

export { build }
