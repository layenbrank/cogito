type SectionKey = 'general' | 'appearance' | 'account' | 'capture' | 'shortcuts'

type HeadText = {
  title: string
  subtitle: string
}

type NavMeta = {
  key: SectionKey
  icon: string
  label: string
  isDisabled?: boolean
}

type SlideMotionOptions = {
  isReducedMotion: boolean
  offset?: number
  axis?: 'x' | 'y'
}

const SECTION = {
  GENERAL: 'general',
  APPEARANCE: 'appearance',
  ACCOUNT: 'account',
  CAPTURE: 'capture',
  SHORTCUTS: 'shortcuts'
} as const satisfies Record<string, SectionKey>

const NAVS: NavMeta[] = [
  { key: SECTION.ACCOUNT, icon: 'lucide:user-round', label: '账号' },
  { key: SECTION.GENERAL, icon: 'ant-design:setting-outlined', label: '通用' },
  { key: SECTION.CAPTURE, icon: 'lucide:camera', label: '截屏' },
  { key: SECTION.SHORTCUTS, icon: 'lucide:keyboard', label: '快捷键' },
  { key: SECTION.APPEARANCE, icon: 'ant-design:bg-colors-outlined', label: '外观' }
]

const HEAD: Record<SectionKey, HeadText> = {
  general: {
    title: '通用',
    subtitle: '应用基础偏好与系统行为'
  },
  appearance: {
    title: '外观',
    subtitle: '定制界面风格、密度与组件样式'
  },
  account: {
    title: '账号',
    subtitle: '个人资料、头像与登录状态'
  },
  capture: {
    title: '截屏',
    subtitle: '窗口检测与自动清理策略'
  },
  shortcuts: {
    title: '快捷键',
    subtitle: '系统级与窗口内键位；系统级在任何应用前台都生效'
  }
}

const SECTION_KEYS: readonly SectionKey[] = [
  SECTION.ACCOUNT,
  SECTION.GENERAL,
  SECTION.CAPTURE,
  SECTION.SHORTCUTS,
  SECTION.APPEARANCE
]

function parseSectionKey(value: string | null | undefined): SectionKey | null {
  if (!value) return null
  return SECTION_KEYS.includes(value as SectionKey) ? (value as SectionKey) : null
}

const MOTION = {
  DURATION: 0.22,
  EASE: [0.22, 1, 0.36, 1] as const,
  OFFSET: {
    HEAD: 4,
    VIEW: 8
  },
  transition(isReducedMotion: boolean) {
    return {
      duration: isReducedMotion ? 0 : MOTION.DURATION,
      ease: MOTION.EASE
    }
  },
  variants(options: SlideMotionOptions) {
    const { isReducedMotion, offset = MOTION.OFFSET.VIEW, axis = 'y' } = options
    const slide = axis === 'x' ? 'x' : 'y'
    return {
      initial: {
        opacity: isReducedMotion ? 1 : 0,
        [slide]: isReducedMotion ? 0 : offset
      },
      animate: { opacity: 1, [slide]: 0 },
      exit: {
        opacity: isReducedMotion ? 1 : 0,
        [slide]: isReducedMotion ? 0 : axis === 'x' ? -offset * 0.5 : -offset
      }
    }
  },
  fadeVariants(isReducedMotion: boolean) {
    return {
      initial: { opacity: isReducedMotion ? 1 : 0 },
      animate: { opacity: 1 },
      exit: { opacity: isReducedMotion ? 1 : 0 }
    }
  }
}

function findNavMeta(key: SectionKey): NavMeta | undefined {
  return NAVS.find(function (nav) {
    return nav.key === key
  })
}

export { HEAD, MOTION, NAVS, SECTION, SECTION_KEYS, findNavMeta, parseSectionKey }
export type { HeadText, NavMeta, SectionKey }
