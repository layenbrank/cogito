/**
 * Overview 壳层：单行地址栏（含登录与窗口键）+ 浏览器骨架。
 * 数据加载、托盘和打开网址留在常驻宿主，离开主页后仍然有效。
 */
import { useState } from 'react'

import ReSignIn from '@/features/signin/signin.tsx'
import { CollectionExpanded } from '@/views/collection/expanded.tsx'
import { BrowserChrome } from '@/views/overview/browser/chrome'
import styles from '@/views/overview/overview.module.scss'

export default function Overview() {
  const [signinOpen, setSigninOpen] = useState(false)

  return (
    <div className={`${styles.overview} flex h-screen w-screen flex-col overflow-hidden bg-transparent text-foreground`}>
      <BrowserChrome
        onSignIn={function () {
          setSigninOpen(true)
        }}
      />
      <ReSignIn
        visible={signinOpen}
        onClose={function () {
          setSigninOpen(false)
        }}
      />
      <CollectionExpanded />
    </div>
  )
}
