import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { findBinaryName, findPlatformKey } from '@i-thinking/sidecar'

import { findAppRoot } from './paths'

/**
 * 二进制「在哪儿」的唯一来源。
 *
 * 外壳（packaged/开发态）、userData、随包目录、运行时下载目录这几件事实，宿主的每个域都要用：
 * corex 侧车、pandoc、ffmpeg、opencode 各问一次。以前各域自己拼一份，落到多份实现迟早对不上
 * —— `findUserDataDir` 的兜底目录就已经分叉过一次（`~/.corex-studio` 与 `~/.i-thinking`）。
 *
 * 这里只回答「目录在哪」与「按优先级取第一份存在的」，**不回答「哪个域该用哪几份」**：
 * 来源的取舍属于各域（corex 还有用户自己装的那份要探，pandoc / opencode 只认自带与下载的那份）。
 */

/**
 * 平台键与二进制文件名（`win32-x64` / `pandoc.exe`）的唯一实现在契约包 `@i-thinking/sidecar`：
 * 侧车那三份 JSON（lock / manifest / checksums）与这里必须用同一套拼法。下面按原名再导出，
 * 宿主其它模块照旧从 `@/host/framework/binaries` 取。
 */

function isPackagedApp(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as { app?: { isPackaged?: boolean } }
    return Boolean(electron.app?.isPackaged)
  } catch (error) {
    console.warn('[binaries] 读 electron.app.isPackaged 失败，按未打包处理', error)
    return false
  }
}

/** electron 的 userData；测试等非 electron 环境退回 `~/.i-thinking`。 */
function findUserDataDir(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as { app?: { getPath?: (name: string) => string } }
    const dir = electron.app?.getPath?.('userData')
    if (dir) {
      return dir
    }
  } catch (error) {
    console.warn('[binaries] 读 electron userData 失败，改用 ~/.i-thinking', error)
  }
  return path.join(os.homedir(), '.i-thinking')
}

/**
 * 随包那份二进制的目录。
 *
 * 打包态：`resources/sidecar`（forge 打进去的）；开发态：`<appRoot>/sidecar/staging/<平台>`
 * （`pnpm command sidecar bootstrap studio` 落盘的地方）。两级布局不同，所以这个差异只在这里说一次。
 */
function findBundledRoot(): string {
  if (isPackagedApp()) {
    return path.join(process.resourcesPath, 'sidecar')
  }
  return path.join(findAppRoot(), 'sidecar', 'staging', findPlatformKey())
}

/** 随包那份的某个二进制 */
function findBundledBinary(name: string): string {
  return path.join(findBundledRoot(), findBinaryName(name))
}

/** 运行时下载的工具根目录：`<userData>/sidecar`（安装包与 staging 都不在这条线上） */
function findRuntimeRoot(): string {
  return path.join(findUserDataDir(), 'sidecar')
}

/** 找二进制的输入：显式指定 + 按优先级排列的目录 + 可能的名字 */
interface BinarySearch {
  /** 显式指定的完整路径（环境变量那类）：说了算；给了但不存在只留一条警告，继续往下找 */
  explicit?: string | undefined
  /** 按优先级排列的目录们，**目录优先于名字**：排前面的目录里任何一份都胜过后面的 */
  dirs: readonly string[]
  /** 不带扩展名的名字；多份时任一存在即命中（如 ffmpeg / ffprobe / ffplay） */
  names: readonly string[]
}

/**
 * 取第一份存在的二进制，没有返回 null（调用方给出可读的报错，而不是启动一个不存在的进程）。
 *
 * 目录优先于名字：某个来源只要有一份可用，就不该混用另一个来源的另一份
 * —— `ffmpeg.exe` 与 `ffprobe.exe` 版本错配会以奇怪的解码错误失败。
 */
function findBinary(search: BinarySearch): { path: string; name: string } | null {
  const explicit = search.explicit?.trim()
  if (explicit) {
    const resolved = path.resolve(explicit)
    if (existsSync(resolved)) {
      return { path: resolved, name: path.basename(resolved) }
    }
    console.warn(`[binaries] 显式指定的文件不存在: ${resolved}`)
  }

  for (const dir of search.dirs) {
    for (const name of search.names) {
      const fileName = findBinaryName(name)
      const candidate = path.join(dir, fileName)
      if (existsSync(candidate)) {
        return { path: candidate, name: fileName }
      }
    }
  }
  return null
}

export {
  findBinary,
  findBinaryName,
  findBundledBinary,
  findBundledRoot,
  findPlatformKey,
  findRuntimeRoot,
  findUserDataDir,
  isPackagedApp
}
export type { BinarySearch }
