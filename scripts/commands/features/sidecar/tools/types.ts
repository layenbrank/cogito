import type { SidecarToolKey } from '@cogito/sidecar'

interface ToolStrategy {
  /** 工具键（`pandoc` / `ffmpeg` / `opencode` …） */
  key: SidecarToolKey
  /**
   * 本仓自有构建（无下载源、无 lock 钉版）：`ensure` 就是 cargo 构建，
   * 不参与「lock 必须有钉版」的校验。
   */
  isLocal?: boolean
  /** 下载 + 校验 + 解压到缓存 <key>/<platform>/ */
  ensure(platformKey: string): Promise<void>
  /** Absolute paths of files that should be copied into staging */
  findRuntimeFiles(platformKey: string): string[]
}

export type { ToolStrategy }
