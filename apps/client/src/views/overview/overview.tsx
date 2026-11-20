/**
 * 工作台墙面：磁贴墙（操作栏由 WorkspaceShell / ShellFrame 注入）。
 */
import { clsx } from 'clsx'
import type { ReactNode } from 'react'

import Controller from '@/features/controller/controller.tsx'
import { hasMirrorWallSnapshot } from '@/features/window/preview-snapshot'
import { isEmbeddedShell } from '@/features/window/shell-mode'
import { useMirrorStore } from '@/stores/mirror'
import styles from '@/views/overview/overview.module.scss'

interface OverviewProps {
  /** 登录弹窗等挂在墙面内容区 */
  signIn?: ReactNode
}

export default function Overview(props: OverviewProps) {
  // 订阅磁贴数量：快照可从 dev server 中继异步到达，靠它让兜底提示自动消失
  const tileCount = useMirrorStore((state) => state.magneticTiles.length)
  return (
    <div className={`${styles.overview} flex h-full min-h-0 w-full flex-col overflow-hidden bg-transparent text-foreground`}>
      <div className={clsx(styles.overview, styles.core, 'min-h-0 flex-1')}>
        <Controller.Mirror>
          <Controller.MagneticTile />
        </Controller.Mirror>
      </div>
      {/* 只在 dev：正式包不会有嵌套预览（见 shell-mode 的 EMBEDDED_SUPPORTED） */}
      {import.meta.env.DEV && isEmbeddedShell() && tileCount === 0 && !hasMirrorWallSnapshot() ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 text-center text-xs text-muted-foreground">
          嵌入预览没有拿到磁贴快照：请让同一 dev server 的 cogito 主窗保持运行（或在本实例里用「打开本应用」）
        </div>
      ) : null}
      {props.signIn}
    </div>
  )
}
