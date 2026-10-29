import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import clsx from 'clsx'
import { AnimatePresence, useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { useShowsTileSession } from '@/features/magnetic-tile/session-bar'
import { findWindowLabel } from '@/features/window/kind'
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
import DictSurface from '@/views/settings/surfaces/dict.tsx'
import GeneralSurface from '@/views/settings/surfaces/general.tsx'
import ShortcutsSurface from '@/views/settings/surfaces/shortcuts.tsx'
import styles from '@/views/settings/shell.module.scss'

function findInitialSection(searchParams: URLSearchParams): SectionKey {
  return parseSectionKey(searchParams.get('section')) ?? SECTION.ACCOUNT
}

/**
 * 主窗应用页已有 TileSessionBar（回墙）；独立设置磁贴窗关窗即可。
 * 仅「非主窗应用内同窗切入设置」时在侧栏提供返回（history.back）。
 */
function findShowsShellBack(showsSession: boolean, windowLabel: string) {
  if (showsSession) return false
  if (windowLabel.startsWith('settings:')) return false
  return true
}

function Shell() {
  const navigate = useNavigate()
  const isReducedMotion = useReducedMotion()
  const [searchParams, updateSearchParams] = useSearchParams()
  const [section, onSectionChange] = useState<SectionKey>(function () {
    return findInitialSection(searchParams)
  })
  const showsSession = useShowsTileSession()
  const showsBack = findShowsShellBack(showsSession, findWindowLabel())
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
          {showsBack ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-region="false"
              aria-label="返回"
              className="shrink-0 gap-1 px-2"
              onClick={function () {
                void navigate(-1)
              }}>
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
              <Button
                key={nav.key}
                type="button"
                variant="ghost"
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
              </Button>
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
              {section === SECTION.DICT && <DictSurface />}
            </m.div>
          </AnimatePresence>
        </div>
      </section>
    </div>
  )
}

export default Shell
export { findShowsShellBack }
