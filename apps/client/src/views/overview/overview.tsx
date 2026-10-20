/**
 * 工作台窗口：磁贴墙 + 集合展开 + 登录弹窗。
 *
 * **这里没有网页**。网页全部在独立的浏览窗口里（`views/browser/chrome.tsx`），
 * 两个渲染模型不再共处一窗，因此不存在"DOM 盖不住原生子 WebView"、
 * "切回磁贴闪一下"这类结构性问题。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { clsx } from 'clsx'
import { useState } from 'react'

import { BrowserBar } from '@/features/browser-bar/bar'
import Controller from '@/features/controller/controller.tsx'
import ReSignIn from '@/features/signin/signin.tsx'
import { openBrowser } from '@/views/browser/open'
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
            <Button
              variant="ghost"
              size="icon"
              data-region="false"
              aria-label="打开浏览"
              className="size-10 min-w-10 rounded-full [&_svg]:size-4.5"
              onClick={function () {
                void openBrowser()
              }}>
              <Icon
                icon="lucide:globe"
                aria-hidden
              />
            </Button>
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
        <div className="flex-1" />
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
