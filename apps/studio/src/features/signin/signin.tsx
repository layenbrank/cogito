import { Dialog, DialogContent, DialogTitle } from '@cogito/design/components/dialog'
import { clsx } from 'clsx'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'

import { Brand } from './brand.tsx'
import {
  HEAD,
  MODE,
  MOTION,
  PANEL,
  type AuthMode,
  type PanelView
} from './constants.ts'
import { ForgotForm } from './forgot-form.tsx'
import { SigninForm } from './signin-form.tsx'
import styles from './signin.module.scss'
import { SignupForm } from './signup-form.tsx'

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
    // 关闭（Esc / 遮罩 / 关闭按钮）时把分栏复位，下次打开总是从登录面板开始
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
      <DialogContent className="w-[min(94vw,1080px)] max-w-none gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-none">
        <DialogTitle className="sr-only">登录 cogito</DialogTitle>
        <div className={styles.body}>
          <Brand />
          <section className={styles.panel}>
            <AnimatePresence
              mode="wait"
              initial={false}>
              <motion.header
                key={panelView}
                className={styles.head}
                initial={headVariants.initial}
                animate={headVariants.animate}
                exit={headVariants.exit}
                transition={viewTransition}>
                <h4 className="text-base font-medium">{headText.title}</h4>
                <span className="text-sm text-muted-foreground">{headText.subtitle}</span>
              </motion.header>
            </AnimatePresence>
            <div className={styles.stage}>
              {/* stage 不用 initial={false}：会经 PresenceContext 屏蔽嵌套 FormStagger 进场 */}
              <AnimatePresence mode="wait">
                <motion.div
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
                </motion.div>
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
