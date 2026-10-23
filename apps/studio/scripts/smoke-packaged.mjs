/**
 * 打包产物冒烟：启动 packager 目录里的 exe，断言没有立刻退出。
 * 不要跑 NSIS Setup.exe（那是安装向导，不是可执行应用目录）。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const STUDIO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MONOREPO_ROOT = path.resolve(STUDIO_ROOT, '..', '..')
const PACKAGED_DIR = path.join(MONOREPO_ROOT, 'out', 'studio', 'cogito-win32-x64')
const EXE = path.join(PACKAGED_DIR, 'cogito.exe')
const WAIT_MS = 8000

function main() {
  if (process.platform !== 'win32') {
    console.warn('[smoke-packaged] skip: not win32')
    return
  }
  if (!existsSync(EXE)) {
    if (process.env.CI) {
      throw new Error(`[smoke-packaged] missing ${EXE}`)
    }
    console.warn('[smoke-packaged] skip: packaged exe not found', EXE)
    return
  }

  const child = spawn(EXE, [], {
    cwd: PACKAGED_DIR,
    stdio: 'ignore',
    windowsHide: true
  })

  let settled = false

  function fail(message) {
    if (settled) return
    settled = true
    try {
      child.kill()
    } catch {
      // ignore
    }
    console.error(message)
    process.exit(1)
  }

  child.on('error', function (error) {
    fail(`[smoke-packaged] spawn failed: ${error.message}`)
  })

  child.on('exit', function (code, signal) {
    if (settled) return
    fail(`[smoke-packaged] exited early code=${code} signal=${signal}`)
  })

  setTimeout(function () {
    if (settled) return
    settled = true
    child.kill()
    console.log('[smoke-packaged] ok', EXE)
    process.exit(0)
  }, WAIT_MS)
}

main()
