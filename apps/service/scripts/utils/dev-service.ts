import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

import { TMP_DIR } from '../utils/env.ts'

const PID_FILE = join(TMP_DIR, 'service.pid')

function readPid(): number | null {
  if (!existsSync(PID_FILE)) return null
  const pid = Number.parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10)
  return Number.isFinite(pid) && pid > 0 ? pid : null
}

function killPid(pid: number): void {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/F', '/T'], {
      stdio: 'ignore',
      windowsHide: true
    })
    return
  }
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // 进程已退出
  }
}

/** 清掉旧 pipeline 留下的 service，避免 exe 被锁导致 cargo run 失败 */
function stopService(): void {
  const pid = readPid()
  if (pid !== null) killPid(pid)
  if (existsSync(PID_FILE)) unlinkSync(PID_FILE)
}

export { stopService }
