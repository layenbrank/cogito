import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { CommandOmnibar } from '@/features/command-bar/omnibar'
import { warmBrandShader } from '@/features/signin/brand'
import ReSignIn from '@/features/signin/signin.tsx'
import { CaptionAccount } from '@/views/overview/caption/account'
import { MirrorSwitcher } from '@/views/overview/caption/mirror'
import { CaptionStatus } from '@/views/overview/caption/status'

interface OverviewTrail {
  center: ReactNode
  final: ReactNode
  /** 登录弹窗挂在墙面内容区，不进操作栏 */
  signIn: ReactNode
}

function OverviewTrailFinal(props: { onSignIn: () => void }) {
  return (
    <>
      <MirrorSwitcher
        isCompact
        menuSide="bottom"
      />
      <CaptionStatus />
      <CaptionAccount
        isIcon
        onSignIn={props.onSignIn}
      />
    </>
  )
}

/**
 * Overview 操作栏槽 + 登录弹窗。
 * 节点引用保持稳定，避免 WorkspaceShell 随路由重渲时拆掉 Omnibar。
 */
function useOverviewTrail(): OverviewTrail {
  const [signinOpen, updateSigninOpen] = useState(false)

  // 墙面空闲时预热登录 shader chunk，打开弹窗时不再卡解析
  useEffect(function () {
    let cancelIdle = function () {}
    const timer = window.setTimeout(function () {
      if (typeof requestIdleCallback === 'function') {
        const id = requestIdleCallback(
          function () {
            warmBrandShader()
          },
          { timeout: 2500 }
        )
        cancelIdle = function () {
          cancelIdleCallback(id)
        }
        return
      }
      warmBrandShader()
    }, 800)
    return function () {
      window.clearTimeout(timer)
      cancelIdle()
    }
  }, [])

  const onSignIn = useCallback(function () {
    updateSigninOpen(true)
  }, [])

  const onCloseSignIn = useCallback(function () {
    updateSigninOpen(false)
  }, [])

  const center = useMemo(function () {
    return <CommandOmnibar />
  }, [])

  const final = useMemo(
    function () {
      return <OverviewTrailFinal onSignIn={onSignIn} />
    },
    [onSignIn]
  )

  const signIn = useMemo(
    function () {
      return (
        <ReSignIn
          visible={signinOpen}
          onClose={onCloseSignIn}
        />
      )
    },
    [signinOpen, onCloseSignIn]
  )

  return useMemo(
    function () {
      return { center, final, signIn }
    },
    [center, final, signIn]
  )
}

export { useOverviewTrail }
export type { OverviewTrail }
