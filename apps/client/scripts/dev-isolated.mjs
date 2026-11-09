#!/usr/bin/env node
// 隔离 dev 实例：让 `tauri dev` 与已安装的正式包同时运行。
//
// 两件事必须一起做，缺一个就会撞：
//   1. identifier 覆盖成 `com.cogito.client.dev`
//      → `<appLocalData>`（SQLite / knowledge / EBWebView / logs）、`<appData>`（goose / jwt）
//        与 single-instance 互斥量全部与正式包分开；
//   2. `COGITO_DEV_ISOLATED=1`
//      → Tauri 起来之前的代码（panic 现场、goose 的 token helper）也认到 `.dev` 目录。
//
// 剩下写死的名字（corex-daemon 的 Named Pipe、剪藏 HTTP 端口、窗口/托盘标题）由
// `src-tauri/src/utils/instance.rs` 按 identifier 自动切换，不需要额外开关。
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const child = spawn('pnpm', ['exec', 'tauri', 'dev', '--config', 'src-tauri/tauri.dev.conf.json'], {
  cwd: clientRoot,
  stdio: 'inherit',
  // Windows 上 pnpm 是 .cmd，必须走 shell
  shell: process.platform === 'win32',
  env: { ...process.env, COGITO_DEV_ISOLATED: '1' }
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
