/**
 * Overview 壳层：单行地址栏（含登录与窗口键）+ 浏览器骨架。
 * 同时承担主窗口的全局初始化职责（数据加载、corex 就绪检测、全局快捷键）。
 */
import { listen } from '@tauri-apps/api/event'
import { useEffect, useState } from 'react'

import ReSignIn from '@/features/signin/signin.tsx'
import { EVENTS } from '@/shared/ipc/channels'
import { useMirrorStore } from '@/stores/mirror.ts'
import { useSettingsStore } from '@/stores/setting.ts'
import { applyCliMatches } from '@/utils/cli'
import { checkUpdate } from '@/utils/updater'
import { CollectionExpanded } from '@/views/collection/expanded.tsx'
import { BrowserChrome } from '@/views/overview/browser/chrome'
import styles from '@/views/overview/overview.module.scss'

export default function Overview() {
  const [signinOpen, setSigninOpen] = useState(false)

  // 主窗口数据初始化：mirror + settings；overlay 仅在有内容时由 toInitialize 显示
  useEffect(function () {
    async function bootstrap() {
      await useMirrorStore.getState().toInitialize()
      await useSettingsStore.getState().toInitialize()
    }
    void bootstrap()
  }, [])

  // CLI 参数处理
  useEffect(function () {
    void applyCliMatches()
  }, [])

  // 托盘事件监听
  useEffect(function () {
    let unlisten: (() => void) | undefined
    let cancelled = false

    async function bootstrap() {
      try {
        unlisten = await listen<string>(EVENTS.TRAY_ACTION, function (event) {
          if (event.payload === 'check-update') void checkUpdate()
        })
        if (cancelled) unlisten()
      } catch (err) {
        console.warn('[Overview] tray:action listen failed', err)
      }
    }

    void bootstrap()
    return function () {
      cancelled = true
      unlisten?.()
    }
  }, [])

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
