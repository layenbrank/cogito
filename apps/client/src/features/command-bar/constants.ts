/** Command Omnibar UI / 解析常量 */

import type { DomainFilter, HitDomain } from './types'

const RECENT_ID_PREFIX = 'recent:'

const OMNIBAR_UI = {
  PRIVATE_USE_CHARS: /[\uE000-\uF8FF]/g,
  URL_PATTERN:
    /^(?:https?:\/\/)?(?:[^@/\s]+@)?(?:localhost|(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)|\[[0-9a-f:.]+\]|(?:[\w-]+\.)+[a-z]{2,})(?::\d{1,5})?(?:[/?#][^\s]*)?$/i,
  NAVIGATE_THROTTLE_MS: 150,
  NONE: -1,
  DEBOUNCE_MS: 180,
  LOCAL_LIMIT: 8,
  WEB_LIMIT: 8,
  RECENT_LIMIT: 6,
  RAIL_MS: 260
} as const

/** 前缀 → 域过滤 */
const PREFIX_DOMAIN: Record<string, HitDomain> = {
  tile: 'tile',
  col: 'collection',
  collection: 'collection',
  nav: 'navigation',
  navigation: 'navigation',
  agent: 'agent',
  cal: 'calendar',
  calendar: 'calendar',
  rem: 'reminder',
  reminder: 'reminder',
  clock: 'reminder',
  gal: 'gallery',
  gallery: 'gallery',
  capture: 'gallery',
  md: 'markdown',
  markdown: 'markdown',
  memo: 'markdown',
  cmd: 'command',
  command: 'command',
  web: 'web'
}

const DOMAIN_LABEL: Record<HitDomain | 'all', string> = {
  all: '全部',
  tile: '磁贴',
  collection: '集合',
  navigation: '网址',
  agent: 'Agent',
  calendar: '日程',
  reminder: '闹钟',
  gallery: '媒体',
  markdown: '备忘',
  command: '命令',
  web: 'Web'
}

const DOMAIN_ORDER: HitDomain[] = [
  'tile',
  'collection',
  'navigation',
  'agent',
  'calendar',
  'reminder',
  'gallery',
  'markdown',
  'command',
  'web'
]

const FILTER_CHIPS: DomainFilter[] = [
  'all',
  'tile',
  'navigation',
  'agent',
  'calendar',
  'gallery',
  'markdown',
  'command',
  'web'
]

export {
  DOMAIN_LABEL,
  DOMAIN_ORDER,
  FILTER_CHIPS,
  OMNIBAR_UI,
  PREFIX_DOMAIN,
  RECENT_ID_PREFIX
}
