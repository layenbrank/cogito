import manifestJson from '@manifest'

import {
  findOnlinePackage,
  findOnlineTool,
  findPlatformKey,
  parseOnlineManifest
} from '@i-thinking/sidecar'

import { findBinaryName } from '@/host/framework/binaries'
import { TOOL_KEYS, ToolKeySchema } from '@/shared/ipc/specs/tools'

import type { OnlineTool, SidecarPackage } from '@i-thinking/sidecar'
import type { ToolKey } from '@/shared/ipc/specs/tools'

/**
 * 在线工具（pandoc / ffmpeg / opencode）：**数据在 `sidecar/manifest.json`，本文件只做取值**。
 *
 * 表放 JSON 而不是写在这里，是为了让**两个消费方读同一份**：
 * - 宿主（这个文件）：构建期把 JSON 内联进 main bundle，运行时不读文件；
 * - 仓库 CLI（`pnpm command sidecar manifest`）：发新包后照着它核对 R2 上的东西对不对。
 *
 * 形状（`schemaVersion` / `platforms` / 各平台那份包的直链 + `sha256`）由契约包
 * `@i-thinking/sidecar` 定义 —— CLI、宿主、forge 读的是同一份类型与解析器，
 * 以前这里自己写一遍 interface 再校验一次，改一边就容易漏另一边。
 *
 * 与 `tools.lock.json` 的关系：那份钉的是**完整版落盘**用的归档 —— pandoc / opencode 用
 * GitHub 原包，ffmpeg(win32) 与这份**同一条 R2 制品**；这份一律是 R2 上的重打包包
 * （可执行文件平铺在包根）。两条通路来源不同，所以哈希不逐字镜像 —— 但**版本是同一条线**：
 * opencode 必须与 lock 一致（与 `@opencode/client` 强耦合，漂了症状是协议对不上），
 * pandoc / ffmpeg(win32) 同理，`catalog.test.ts` 守着。
 *
 * 加一个平台 / 换一个包：改 `manifest.json` 即可，代码不用动。
 */

/** 静态描述 + 当前平台那份包（当前平台没发包时为 null） */
interface ToolSpec extends OnlineTool {
  key: ToolKey
  package: SidecarPackage | null
}

const MANIFEST = parseOnlineManifest(manifestJson)

function isToolKey(key: string): key is ToolKey {
  return ToolKeySchema.safeParse(key).success
}

/** 全部工具（含当前平台没有在线包的那些：界面要如实说明，而不是让它们从列表里消失） */
function findTools(platformKey = findPlatformKey()): ToolSpec[] {
  return TOOL_KEYS.map(function (key) {
    const info = findOnlineTool(MANIFEST, key)
    if (!info) {
      throw new Error(`[tools] manifest.json 里没有 ${key}`)
    }
    return { key, ...info, package: findOnlinePackage(MANIFEST, key, platformKey) }
  })
}

function findTool(key: string, platformKey = findPlatformKey()): ToolSpec | null {
  if (!isToolKey(key)) {
    return null
  }
  const info = findOnlineTool(MANIFEST, key)
  if (!info) {
    return null
  }
  return { key, ...info, package: findOnlinePackage(MANIFEST, key, platformKey) }
}

/** 这个工具在当前平台要不要 .exe */
function findToolBinaryNames(spec: ToolSpec, platform = process.platform): string[] {
  return spec.binaries.map(function (name) {
    return findBinaryName(name, platform)
  })
}

export { findTool, findToolBinaryNames, findTools, isToolKey }
export type { ToolKey, ToolSpec }
