import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import clsx from 'clsx'
import { AnimatePresence, useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { isMainWindow } from '@/features/magnetic-tile/session'
import { useShowsTileSession } from '@/features/magnetic-tile/session-bar'
import { findWindowLabel } from '@/features/window/kind'
import {
  MOTION,
  NAVS,
  SECTION,
  parseSectionKey,
  type SectionKey
} from '@/views/settings/constant.ts'
import AccountPanel from '@/views/settings/panels/account.tsx'
import AppearancePanel from '@/views/settings/panels/appearance.tsx'
import CapturePanel from '@/views/settings/panels/capture.tsx'
import DictPanel from '@/views/settings/panels/dict.tsx'
import GeneralPanel from '@/views/settings/panels/general.tsx'
import ShortcutsPanel from '@/views/settings/panels/shortcuts.tsx'
import styles from '@/views/settings/shell.module.scss'

function findInitialSection(searchParams: URLSearchParams): SectionKey {
  return parseSectionKey(searchParams.get('section')) ?? SECTION.ACCOUNT
}

function Shell() {
  const navigate = useNavigate()
  const isReducedMotion = useReducedMotion()
  const [searchParams, updateSearchParams] = useSearchParams()
  const [section, onSectionChange] = useState<SectionKey>(function () {
    return findInitialSection(searchParams)
  })
  // 主窗有 TileSessionBar；独立设置磁贴窗关窗即可；其余同窗进入时需要返回
  const showsSession = useShowsTileSession()
  const windowLabel = findWindowLabel()
  const showsBack = !showsSession && !windowLabel.startsWith('settings:')
  // 查询串里的 section 变了就跟随：渲染期按变化调整，不用 effect
  const querySection = searchParams.get('section') ?? ''
  const [seenQuerySection, updateSeenQuerySection] = useState(querySection)
  if (querySection !== seenQuerySection) {
    updateSeenQuerySection(querySection)
    const fromQuery = parseSectionKey(querySection)
    if (fromQuery && fromQuery !== section) onSectionChange(fromQuery)
  }

  function selectSection(key: SectionKey) {
    onSectionChange(key)
    updateSearchParams({ section: key }, { replace: true })
  }

  function goBack() {
    if (isMainWindow()) {
      void navigate('/overview')
      return
    }
    void navigate(-1)
  }

  const viewVariants = MOTION.fadeVariants(!!isReducedMotion)
  const viewTransition = MOTION.transition(!!isReducedMotion)

  return (
    <div className={styles.layout}>
      <aside className={styles.aside}>
        <div className={styles.asideHead}>
          <div className={styles.asideTitle}>
            <div className={styles.logo}>
              <Icon
                icon="ant-design:setting-outlined"
                aria-hidden
              />
            </div>
            <h2 className={styles.asideTitleText}>设置</h2>
          </div>
          {showsBack ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-region="false"
              aria-label="返回"
              className="shrink-0 gap-1 px-2"
              onClick={goBack}>
              <Icon
                icon="lucide:chevron-left"
                className="size-3.5"
                aria-hidden
              />
              返回
            </Button>
          ) : null}
        </div>

        <nav
          className={styles.nav}
          aria-label="设置分类">
          {NAVS.map(function (nav) {
            const isActive = section === nav.key
            return (
              <button
                key={nav.key}
                type="button"
                className={clsx(
                  styles.navItem,
                  isActive && styles.navItemActive,
                  nav.isDisabled && styles.navItemDisabled
                )}
                aria-current={isActive ? 'page' : undefined}
                disabled={nav.isDisabled}
                onClick={function () {
                  selectSection(nav.key)
                }}>
                <Icon
                  icon={nav.icon}
                  aria-hidden
                />
                <span>{nav.label}</span>
              </button>
            )
          })}
        </nav>
      </aside>

      <section className={styles.main}>
        <div className={styles.stage}>
          <AnimatePresence
            mode="wait"
            initial={false}>
            <m.div
              key={section}
              className={styles.panelWrap}
              initial={viewVariants.initial}
              animate={viewVariants.animate}
              exit={viewVariants.exit}
              transition={viewTransition}>
              {section === SECTION.GENERAL && <GeneralPanel />}
              {section === SECTION.CAPTURE && <CapturePanel />}
              {section === SECTION.SHORTCUTS && <ShortcutsPanel />}
              {section === SECTION.APPEARANCE && <AppearancePanel />}
              {section === SECTION.ACCOUNT && <AccountPanel />}
              {section === SECTION.DICT && <DictPanel />}
            </m.div>
          </AnimatePresence>
        </div>
      </section>
    </div>
  )
}

export default Shell
