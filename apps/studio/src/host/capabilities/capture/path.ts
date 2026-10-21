import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { findSharedDataDir } from '@/host/capabilities/database'

const CAPTURE_DIRECTIVE = 'capture-screenshot'

/** 预截图暂存：与 client 同根 `…/com.cogito.client/screenshots` */
function findScreenshotDir(): string {
  return path.join(findSharedDataDir(), 'screenshots')
}

/** 贴图落盘：与 client 同根 `…/textures` */
function findTextureDir(): string {
  return path.join(findSharedDataDir(), 'textures')
}

async function buildPath(): Promise<string> {
  const dir = findScreenshotDir()
  await mkdir(dir, { recursive: true })
  return path.join(dir, `screenshot-${Date.now()}.png`)
}

function isAllowedPath(filePath: string): boolean {
  const resolved = path.resolve(filePath)
  const roots = [findScreenshotDir(), findTextureDir()].map(function (dir) {
    return path.resolve(dir)
  })
  return roots.some(function (root) {
    return resolved === root || resolved.startsWith(root + path.sep)
  })
}

export {
  CAPTURE_DIRECTIVE,
  buildPath,
  findScreenshotDir,
  findTextureDir,
  isAllowedPath
}
