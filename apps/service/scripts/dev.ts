/**
 * 开发热重载：cargo-watch 监听源码，变更后 `cargo run --bin cogito`。
 *
 * 用法:
 *   pnpm dev              变更即杀进程重启
 *   pnpm dev:stable   当前命令跑完再跑下一次（--no-restart）
 *
 * 依赖: cargo install cargo-watch --locked
 * Cursor / Windows 下原生文件通知经常不触发，默认 --poll。
 * DEV_WATCH_WHY=1 打印触发路径。
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import process from 'node:process'

import { stopService } from './utils/dev-service.ts'
import { ROOT } from './utils/env.ts'

const DELAY_SEC = '1'

/** -w 白名单：只盯源码与清单，不扫 cas/logs/target */
const WATCH_PATHS = ['src', 'entity', 'migration', 'Cargo.toml'] as const

const noRestart = process.argv.includes('--no-restart')

function cargoWatchArgs(): string[] {
  const args = [
    'watch',
    '-c',
    '-d',
    DELAY_SEC,
    '--poll',
    '--skip-local-deps',
    ...(noRestart ? ['--no-restart'] : []),
    ...WATCH_PATHS.flatMap((p) => ['-w', p]),
    '-x',
    'run --bin cogito --features openapi'
  ]
  if (process.env.DEV_WATCH_WHY === '1') {
    args.splice(1, 0, '--why')
  }
  return args
}

function ensureCargoWatch(): void {
  const r = spawnSync('cargo', ['watch', '--version'], {
    encoding: 'utf8',
    env: process.env,
    windowsHide: true
  })
  if (r.status === 0) return
  console.error('未找到 cargo-watch。请先执行: cargo install cargo-watch --locked')
  process.exit(1)
}

ensureCargoWatch()
stopService()

console.log(
  `dev — cargo watch -x "run --bin cogito --features openapi"${noRestart ? ' --no-restart' : ''}`
)
console.log(
  `    watch: ${WATCH_PATHS.join(', ')}  (--poll, delay=${DELAY_SEC}s${noRestart ? ', no-restart' : ''})`
)

const child: ChildProcess = spawn('cargo', cargoWatchArgs(), {
  stdio: 'inherit',
  env: process.env,
  cwd: ROOT,
  windowsHide: false
})

child.on('error', (err) => {
  console.error('无法启动 cargo watch:', err.message)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    if (!child.killed) child.kill(sig)
  })
}
