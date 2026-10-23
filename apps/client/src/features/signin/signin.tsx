import { Dialog, DialogContent, DialogTitle } from '@cogito/design/components/dialog'
import { clsx } from 'clsx'
import { AnimatePresence, useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'
import { useEffect, useMemo, useState } from 'react'

import { Brand } from '@/features/signin/brand'
import { introDurationMs, markIntroPlayed } from '@/features/signin/brand/intro.ts'
import {
  HEAD,
  MODE,
  MOTION,
  PANEL,
  type AuthMode,
  type PanelView
} from '@/features/signin/constants.ts'
import { ForgotForm } from '@/features/signin/forgot-form.tsx'
import { SigninForm } from '@/features/signin/signin-form.tsx'
import styles from '@/features/signin/signin.module.scss'
import { SignupForm } from '@/features/signin/signup-form.tsx'

type SignInProps = {
  visible: boolean
  onClose: () => void
}

function SignIn(props: SignInProps) {
  const { visible, onClose } = props
  const isReducedMotion = useReducedMotion()
  const [panelView, setPanelView] = useState<PanelView>(PANEL.SIGNIN)
  const [signinMode, setSigninMode] = useState<AuthMode>(MODE.USERNAME)
  const [forgotMode, setForgotMode] = useState<AuthMode>(MODE.USERNAME)
  const [panelMotionKey, setPanelMotionKey] = useState(0)

  // 每次打开取一次入场时长：首次 620ms，同会话后续 260ms（见 brand/intro.ts）
  const introMs = useMemo(
    function () {
      return visible ? introDurationMs() : 0
    },
    [visible]
  )

  useEffect(
    function () {
      if (visible) markIntroPlayed()
    },
    [visible]
  )

  const headText = HEAD[panelView]
  const headVariants = MOTION.variants({
    isReducedMotion: !!isReducedMotion,
    offset: MOTION.OFFSET.HEAD
  })
  const viewVariants = MOTION.fadeVariants(!!isReducedMotion)
  const viewTransition = MOTION.transition(!!isReducedMotion)

  function resetPanes() {
    setPanelView(PANEL.SIGNIN)
    setSigninMode(MODE.USERNAME)
    setForgotMode(MODE.USERNAME)
  }

  function onVisibleChange(open: boolean) {
    if (open) return
    resetPanes()
    onClose()
  }

  function bumpPanelMotion() {
    setPanelMotionKey(function (key) {
      return key + 1
    })
  }

  function onForgot() {
    setForgotMode(signinMode)
    setPanelView(PANEL.FORGOT)
    bumpPanelMotion()
  }

  function onSignup() {
    setPanelView(PANEL.SIGNUP)
    bumpPanelMotion()
  }

  function onSignin() {
    setPanelView(PANEL.SIGNIN)
    bumpPanelMotion()
  }

  return (
    <Dialog
      open={visible}
      onOpenChange={onVisibleChange}>
      <DialogContent
        overlayClassName="bg-black/45 supports-backdrop-filter:backdrop-blur-sm"
        className="w-[min(94vw,1000px)] max-h-[min(92vh,720px)] max-w-none gap-0 overflow-hidden rounded-2xl border-border/60 bg-card p-0 shadow-2xl ring-1 ring-black/5 sm:max-w-none dark:ring-white/10 **:data-[slot=dialog-body]:gap-0 **:data-[slot=dialog-body]:overflow-hidden **:data-[slot=dialog-body]:p-0">
        <DialogTitle className="sr-only">登录 cogito</DialogTitle>
        <div className={styles.body}>
          <Brand introMs={introMs} />
          <section className={styles.panel}>
            <m.div
              className={styles.seam}
              aria-hidden
              initial={{ opacity: 0 }}
              animate={{ opacity: isReducedMotion ? 0.14 : [0, 0.62, 0.14] }}
              transition={{
                duration: isReducedMotion ? 0 : (introMs * 1.15) / 1000,
                times: [0, 0.35, 1],
                ease: 'easeOut'
              }}
            />
            <AnimatePresence
              mode="wait"
              initial={false}>
              <m.header
                key={panelView}
                className={styles.head}
                initial={headVariants.initial}
                animate={headVariants.animate}
                exit={headVariants.exit}
                transition={viewTransition}>
                <h4 className="text-base font-medium">{headText.title}</h4>
                <span className="text-sm text-muted-foreground">{headText.subtitle}</span>
              </m.header>
            </AnimatePresence>
            <div className={styles.stage}>
              <AnimatePresence mode="wait">
                <m.div
                  key={panelView}
                  initial={viewVariants.initial}
                  animate={viewVariants.animate}
                  exit={viewVariants.exit}
                  transition={viewTransition}
                  className={clsx(
                    styles.formWrap,
                    panelView === PANEL.FORGOT && styles.formWrapScroll
                  )}>
                  {panelView === PANEL.SIGNIN && (
                    <SigninForm
                      motionKey={panelMotionKey}
                      signinMode={signinMode}
                      onModeChange={setSigninMode}
                      onForgot={onForgot}
                      onSignup={onSignup}
                      onSuccess={onClose}
                    />
                  )}
                  {panelView === PANEL.FORGOT && (
                    <ForgotForm
                      motionKey={panelMotionKey}
                      forgotMode={forgotMode}
                      onModeChange={setForgotMode}
                      onSignin={onSignin}
                    />
                  )}
                  {panelView === PANEL.SIGNUP && (
                    <SignupForm
                      motionKey={panelMotionKey}
                      onSignin={onSignin}
                      onSuccess={onClose}
                    />
                  )}
                </m.div>
              </AnimatePresence>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default SignIn

export type { SignInProps }
