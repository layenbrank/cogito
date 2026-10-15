/**
 * Overview 壳层：标题栏（镜像切换 / 状态 / 账号）+ 搜索 + Mirror 舞台 + 登录入口。
 * 同时承担主窗口的全局初始化职责（数据加载、corex 就绪检测、全局快捷键）。
 */
import { listen } from '@tauri-apps/api/event'
import { attachConsole } from '@tauri-apps/plugin-log'
import { clsx } from 'clsx'
import { useEffect, useState } from 'react'

import { Decorations } from '@/components/decorations/index.ts'
import Controller from '@/features/controller/controller.tsx'
import ReSignIn from '@/features/signin/signin.tsx'
import { EVENTS } from '@/shared/ipc/channels'
import { useMirrorStore } from '@/stores/mirror.ts'
import { useSettingsStore } from '@/stores/setting.ts'
import { applyCliMatches } from '@/utils/cli'
import { checkUpdate } from '@/utils/updater'
import { CaptionAccount } from '@/views/overview/caption/account'
import { MirrorSwitcher } from '@/views/overview/caption/mirror'
import { CaptionStatus } from '@/views/overview/caption/status'
import { CollectionExpanded } from '@/views/collection/expanded.tsx'
import { EngineSearch } from '@/views/overview/engine/engine-search'
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

  // DEV 模式控制台日志
  useEffect(function () {
    if (!import.meta.env.DEV) return

    let detach: (() => void) | undefined
    let cancelled = false

    async function attach() {
      try {
        const detachConsole = await attachConsole()
        if (cancelled) detachConsole()
        else detach = detachConsole
      } catch (err) {
        console.warn('[Overview] attachConsole failed', err)
      }
    }

    void attach()
    return function () {
      cancelled = true
      detach?.()
    }
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
    /*
      主窗口走 Decorations 当容器（`decorations: false` 后必须自绘标题栏）；
      外壳透明，mica 透出来，只负责标题栏 + 撑满内容（`.core` 的 `flex: 1`
      依赖这层纵向 flex）。标题栏：左＝品牌 + 镜像切换器，右＝状态区 + 账号。
    */
    <Decorations
      scrollable={false}
      className={styles.overview}
      begin={
        <>
          <span className={styles.brand}>i-thinking</span>
          <span
            className={styles.brandDivider}
            aria-hidden
          />
          <MirrorSwitcher />
        </>
      }
      final={
        <>
          <CaptionStatus />
          <CaptionAccount
            onSignIn={function () {
              setSigninOpen(true)
            }}
          />
        </>
      }>
      <header className={clsx(styles.overview, styles.prefix)}>
        <EngineSearch />
      </header>
      <main className={clsx(styles.overview, styles.core)}>
        <Controller.Mirror>
          <Controller.MagneticTile />
        </Controller.Mirror>
      </main>
      <ReSignIn
        visible={signinOpen}
        onClose={function () {
          setSigninOpen(false)
        }}
      />
      <CollectionExpanded />
    </Decorations>
  )
}
