import { Icon } from '@iconify/react/offline'
import clsx from 'clsx'
import { AnimatePresence, useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import {
  MOTION,
  NAVS,
  SECTION,
  parseSectionKey,
  type SectionKey
} from '@/views/settings/constant.ts'
import AccountSurface from '@/views/settings/surfaces/account.tsx'
import AppearanceSurface from '@/views/settings/surfaces/appearance.tsx'
import CaptureSurface from '@/views/settings/surfaces/capture.tsx'
import DiagnosticSurface from '@/views/settings/surfaces/diagnostics.tsx'
import GeneralSurface from '@/views/settings/surfaces/general.tsx'
import ShortcutsSurface from '@/views/settings/surfaces/shortcuts.tsx'
import styles from '@/views/settings/shell.module.scss'

function findInitialSection(searchParams: URLSearchParams): SectionKey {
  return parseSectionKey(searchParams.get('section')) ?? SECTION.ACCOUNT
}

function Shell() {
  const isReducedMotion = useReducedMotion()
  const [searchParams, updateSearchParams] = useSearchParams()
  const [section, onSectionChange] = useState<SectionKey>(function () {
    return findInitialSection(searchParams)
  })
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
                disabled={nav.isDisabled}
                aria-current={isActive ? 'page' : undefined}
                className={clsx(
                  styles.navItem,
                  isActive && styles.navItemActive,
                  nav.isDisabled && styles.navItemDisabled
                )}
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
              className={styles.surfaceWrap}
              initial={viewVariants.initial}
              animate={viewVariants.animate}
              exit={viewVariants.exit}
              transition={viewTransition}>
              {section === SECTION.GENERAL && <GeneralSurface />}
              {section === SECTION.CAPTURE && <CaptureSurface />}
              {section === SECTION.SHORTCUTS && <ShortcutsSurface />}
              {section === SECTION.APPEARANCE && <AppearanceSurface />}
              {section === SECTION.ACCOUNT && <AccountSurface />}
              {section === SECTION.DIAGNOSTICS && <DiagnosticSurface />}
            </m.div>
          </AnimatePresence>
        </div>
      </section>
    </div>
  )
}

export default Shell
