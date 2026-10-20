/**
 * 工作台窗口：磁贴墙 + 集合展开 + 登录弹窗 + 顶栏搜索（外跳系统浏览器）。
 */
import { clsx } from 'clsx'
import { useState } from 'react'

import { BrowserBar } from '@/features/browser-bar/bar'
import { CommandOmnibar } from '@/features/command-bar/omnibar'
import Controller from '@/features/controller/controller.tsx'
import ReSignIn from '@/features/signin/signin.tsx'
import { CollectionExpanded } from '@/views/collection/expanded.tsx'
import { CaptionAccount } from '@/views/overview/caption/account'
import { MirrorSwitcher } from '@/views/overview/caption/mirror'
import { CaptionStatus } from '@/views/overview/caption/status'
import styles from '@/views/overview/overview.module.scss'

export default function Overview() {
  const [signinOpen, setSigninOpen] = useState(false)

  return (
    <div className={`${styles.overview} flex h-screen w-screen flex-col overflow-hidden bg-transparent text-foreground`}>
      <BrowserBar
        onBind={function () {}}
        trailing={
          <>
            <MirrorSwitcher
              isCompact
              menuSide="bottom"
            />
            <CaptionStatus />
            <CaptionAccount
              isIcon
              onSignIn={function () {
                setSigninOpen(true)
              }}
            />
          </>
        }>
        <CommandOmnibar />
      </BrowserBar>
      <div className={clsx(styles.overview, styles.core, 'min-h-0 flex-1')}>
        <Controller.Mirror>
          <Controller.MagneticTile />
        </Controller.Mirror>
      </div>
      <CollectionExpanded />
      <ReSignIn
        visible={signinOpen}
        onClose={function () {
          setSigninOpen(false)
        }}
      />
    </div>
  )
}
