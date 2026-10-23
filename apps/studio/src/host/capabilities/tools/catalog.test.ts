import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { findLockPin, listOnDemandTools, parseToolsLock } from '@cogito/sidecar'

import { TOOL_KEYS } from '@/shared/ipc/specs/tools'
import { findTool, findToolBinaryNames, findTools } from './catalog'

/**
 * `sidecar/manifest.json`（在线包）与 `tools.lock.json`（完整版落盘的归档）是**两条路**：
 * 前者一律是 R2 上的重打包包（可执行文件平铺在包根）；后者 ffmpeg(win32) 已与在线包同源，
 * pandoc / opencode 仍是 GitHub 上的原包 —— lock 还要覆盖在线包没发的平台，所以**不去镜像哈希**。
 * 要盯的只有两件事：
 * 1. 覆盖面对得上：哪些工具算「按需」由 lock 说了算；
 * 2. **版本不漂**：pandoc / opencode / ffmpeg(win32) 必须与 lock 逐字一致（见 VERSION_CHECKED）。
 *
 * 两份 JSON 都交给契约包 `@cogito/sidecar` 解析：这里顺带让它的解析器对着真文件跑一遍。
 */
const LOCK_PATH = fileURLToPath(
  new URL('../../../../../../scripts/commands/features/sidecar/tools.lock.json', import.meta.url)
)

const lock = parseToolsLock(JSON.parse(readFileSync(LOCK_PATH, 'utf8')) as unknown, LOCK_PATH)

/** 本仓的开发平台：在线包必须齐，否则精简版在这台机器上没法用 */
const HOST_KEY = 'win32-x64'

/**
 * 版本必须与 lock 逐字对齐的工具。
 *
 * opencode 是硬约束：server 与 `@opencode/client` 强耦合，漂了不是报错而是协议对不上
 * （症状是 400 `Missing key at ["prompt"]`）。pandoc 同上游线，也对齐。
 * ffmpeg：win32 的 lock pin 与在线包是同一条 R2 制品（上游 master 重打包，n9.0.2），
 * 版号必须一致；其余平台只有 lock 那份（BtbN autobuild），在线包没发。
 */
const VERSION_CHECKED = ['pandoc', 'opencode', 'ffmpeg']

const SHA256 = /^[0-9a-f]{64}$/

describe('online tool manifest', function () {
  it('covers exactly the tools the lock marks onDemand', function () {
    expect(listOnDemandTools(lock).sort()).toEqual([...TOOL_KEYS].sort())
  })

  it('pins a link and a hash for this platform', function () {
    const tools = findTools(HOST_KEY)
    expect(tools).toHaveLength(TOOL_KEYS.length)

    for (const tool of tools) {
      expect(tool.package, `${tool.key} 缺 ${HOST_KEY} 在线包`).not.toBeNull()
      expect(tool.version.length).toBeGreaterThan(0)
      expect(tool.binaries.length).toBeGreaterThan(0)
      expect(tool.package?.url.startsWith('https://')).toBe(true)
      expect(tool.package?.sha256).toMatch(SHA256)
    }
  })

  it('keeps the versions that must not drift', function () {
    for (const key of VERSION_CHECKED) {
      expect(findTool(key, HOST_KEY)?.version).toBe(findLockPin(lock, key, HOST_KEY)?.version)
    }
  })

  it('still lists tools that have no package for a platform', function () {
    // 目前只发了 Windows 包：形状还要在（界面要如实说明），package 为空（不给下载按钮）
    const tools = findTools('darwin-arm64')
    expect(
      tools.map(function (tool) {
        return tool.key
      })
    ).toEqual([...TOOL_KEYS])
    expect(
      tools.every(function (tool) {
        return tool.package === null
      })
    ).toBe(true)

    expect(findTool('nope', HOST_KEY)).toBeNull()
  })

  it('adds the platform binary suffix', function () {
    const ffmpeg = findTool('ffmpeg', HOST_KEY)
    const pandoc = findTool('pandoc', HOST_KEY)
    expect(findToolBinaryNames(ffmpeg!, 'win32')).toEqual([
      'ffmpeg.exe',
      'ffprobe.exe',
      'ffplay.exe'
    ])
    expect(findToolBinaryNames(pandoc!, 'linux')).toEqual(['pandoc'])
  })
})
