/**
 * 工作台墙面：磁贴墙（操作栏由 WorkspaceShell / ShellFrame 注入）。
 */
import { clsx } from 'clsx'
import type { ReactNode } from 'react'

import Controller from '@/features/controller/controller.tsx'
import styles from '@/views/overview/overview.module.scss'

interface OverviewProps {
  /** 登录弹窗等挂在墙面内容区 */
  signIn?: ReactNode
}

export default function Overview(props: OverviewProps) {
  return (
    <div className={`${styles.overview} flex h-full min-h-0 w-full flex-col overflow-hidden bg-transparent text-foreground`}>
      <div className={clsx(styles.overview, styles.core, 'min-h-0 flex-1')}>
        <Controller.Mirror>
          <Controller.MagneticTile />
        </Controller.Mirror>
      </div>
      {props.signIn}
    </div>
  )
}
