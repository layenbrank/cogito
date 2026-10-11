/**
 * 标题栏右侧的状态区：把原来两颗「一次性 toast」变成常驻状态芯片 ——
 * 出问题时用户在标题栏就看得到，并且能就地处理（不需要记住 toast 里的说明）。
 *
 * 两个状态：
 * - corex 未就绪：PDF / 截图不可用，点芯片重新检测；
 * - 有可用更新：启动时静默检查发现，点芯片继续安装，点 ✕ 忽略本次提醒。
 */
import { Icon } from '@iconify/react/offline'
import { Tooltip, TooltipContent, TooltipTrigger } from '@i-thinking/design/components/tooltip'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { cn } from 'cn'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

import { CHANNELS, EVENTS } from '@/shared/ipc/channels'
import {
  autoCheckUpdate,
  checkUpdate,
  dismissPendingUpdate,
  findPendingUpdateVersion,
  subscribeUpdateStatus
} from '@/utils/updater'
import styles from '@/views/overview/caption/caption.module.scss'

const COREX_NOT_READY = 'corex 未就绪，PDF / 截图等功能暂不可用。请构建 corex-daemon 后重启应用。'

/** 启动后多久做一次静默更新检查（避开启动高峰） */
const AUTO_CHECK_DELAY_MS = 3000

type CorexState = 'checking' | 'ready' | 'missing'

/** corex 就绪状态：启动查一次，之后听 sidecar 的 not-ready 事件 */
function useCorexState() {
  const [state, updateState] = useState<CorexState>('checking')

  /** 只读一次就绪状态；不同步 setState（effect 里调用也不产生级联渲染） */
  const check = useCallback(function () {
    void invoke<boolean | null>(CHANNELS.IPC.READY)
      .then(function (ready) {
        updateState(ready === false ? 'missing' : 'ready')
      })
      .catch(function (error: unknown) {
        console.warn('[caption-status] corex 状态检查失败', error)
        updateState('missing')
      })
  }, [])

  const recheck = useCallback(
    function () {
      updateState('checking')
      check()
    },
    [check]
  )

  useEffect(
    function () {
      let unlisten: (() => void) | undefined
      let disposed = false

      async function bootstrap() {
        try {
          const off = await listen(EVENTS.COREX_NOT_READY, function () {
            if (!disposed) updateState('missing')
          })
          if (disposed) off()
          else unlisten = off
        } catch (error) {
          console.warn('[caption-status] corex 事件订阅失败', error)
        }
      }

      check()
      void bootstrap()

      return function () {
        disposed = true
        unlisten?.()
      }
    },
    [check]
  )

  return [state, recheck] as const
}

function CaptionStatus() {
  const [corex, recheck] = useCorexState()
  const updateVersion = useSyncExternalStore(subscribeUpdateStatus, findPendingUpdateVersion)

  // 静默检查一次：有更新就让芯片出现，由用户决定什么时候装
  useEffect(function () {
    const timer = window.setTimeout(function () {
      void autoCheckUpdate()
    }, AUTO_CHECK_DELAY_MS)
    return function () {
      window.clearTimeout(timer)
    }
  }, [])

  if (corex !== 'missing' && !updateVersion) return null

  return (
    <div className={styles.status}>
      {updateVersion ? (
        <span className={cn(styles.chip, styles.chipInfo)}>
          <button
            type="button"
            data-region="false"
            className={styles.chipAction}
            onClick={function () {
              void checkUpdate()
            }}>
            <Icon
              icon="lucide:download"
              className={styles.chipIcon}
              aria-hidden
            />
            可更新 {updateVersion}
          </button>
          <button
            type="button"
            data-region="false"
            className={styles.chipDismiss}
            aria-label="忽略本次更新提醒"
            onClick={dismissPendingUpdate}>
            <Icon
              icon="lucide:x"
              aria-hidden
            />
          </button>
        </span>
      ) : null}

      {corex === 'missing' ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                data-region="false"
                className={cn(styles.chip, styles.chipWarn, styles.chipAction)}
                onClick={recheck}
              />
            }>
            <Icon
              icon="lucide:triangle-alert"
              className={styles.chipIcon}
              aria-hidden
            />
            corex 未就绪
          </TooltipTrigger>
          <TooltipContent side="bottom">{COREX_NOT_READY}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
}

export { CaptionStatus }
