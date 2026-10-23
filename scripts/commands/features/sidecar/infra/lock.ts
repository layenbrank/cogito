import { existsSync, readFileSync } from 'node:fs'

import {
  findLockPin,
  findLockedTool,
  hasLockPin,
  isOnDemandTool,
  listOnDemandTools,
  parseToolsLock,
  requireLockPin
} from '@cogito/sidecar'

import { TOOLS_LOCK_PATH } from './constants.ts'

import type { LockedTool, SidecarPin, ToolsLock } from '@cogito/sidecar'

/**
 * 读 `tools.lock.json`：形状（schemaVersion / tools / platforms / onDemand）由
 * `@cogito/sidecar` 定，这里只负责「文件 → JSON → 校验」，取值的活也交给它。
 *
 * 版本漂移必须响亮失败（缓存命中不是「有文件就算」），所以缺平台一律抛，不给默认值。
 */
function readToolsLock(filePath = TOOLS_LOCK_PATH): ToolsLock {
  if (!existsSync(filePath)) {
    throw new Error(`[tools-lock] 缺少文件 ${filePath}`)
  }
  return parseToolsLock(JSON.parse(readFileSync(filePath, 'utf8')) as unknown, filePath)
}

export {
  findLockPin,
  findLockedTool,
  hasLockPin,
  isOnDemandTool,
  listOnDemandTools,
  readToolsLock,
  requireLockPin
}
export type { LockedTool, SidecarPin, ToolsLock }
