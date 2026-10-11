import { Icon } from '@iconify/react/offline'
import clsx from 'clsx'
import { AnimatePresence, useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'
import { useState } from 'react'

import {
  HEAD,
  MOTION,
  NAVS,
  SECTION,
  type SectionKey
} from '@/views/settings/constant.ts'
import AppearancePanel from '@/views/settings/panels/appearance.tsx'
import GeneralPanel from '@/views/settings/panels/general.tsx'
import styles from '@/views/settings/shell.module.scss'

function Shell() {
  const isReducedMotion = useReducedMotion()
  const [section, onSectionChange] = useState<SectionKey>(SECTION.APPEARANCE)

  const headText = HEAD[section]
  const headVariants = MOTION.variants({
    isReducedMotion: !!isReducedMotion,
    offset: MOTION.OFFSET.HEAD
  })
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
                className={clsx(
                  styles.navItem,
                  isActive && styles.navItemActive,
                  nav.isDisabled && styles.navItemDisabled
                )}
                aria-current={isActive ? 'page' : undefined}
                disabled={nav.isDisabled}
                onClick={function () {
                  onSectionChange(nav.key)
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
        <AnimatePresence
          mode="wait"
          initial={false}>
          <m.header
            key={section}
            className={styles.head}
            initial={headVariants.initial}
            animate={headVariants.animate}
            exit={headVariants.exit}
            transition={viewTransition}>
            <h1 className={styles.headTitle}>{headText.title}</h1>
            <p className={styles.headSubtitle}>{headText.subtitle}</p>
          </m.header>
        </AnimatePresence>

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
              {section === SECTION.APPEARANCE && <AppearancePanel />}
            </m.div>
          </AnimatePresence>
        </div>
      </section>
    </div>
  )
}

export default Shell
