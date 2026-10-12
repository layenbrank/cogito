import type { SidecarToolKey } from '@i-thinking/sidecar'

interface ToolStrategy {
  /** 工具键（`pandoc` / `ffmpeg` / `opencode` …） */
  key: SidecarToolKey
  /** 下载 + 校验 + 解压到缓存 <key>/<platform>/ */
  ensure(platformKey: string): Promise<void>
  /** Absolute paths of files that should be copied into staging */
  findRuntimeFiles(platformKey: string): string[]
}

export type { ToolStrategy }
