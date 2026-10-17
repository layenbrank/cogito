/** Overview 搜索引擎 UI 常量 */
const ENGINE_UI = {
  PRIVATE_USE_CHARS: /[\uE000-\uF8FF]/g,
  URL_PATTERN:
    /^(?:https?:\/\/)?(?:[^@/\s]+@)?(?:localhost|(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)|\[[0-9a-f:.]+\]|(?:[\w-]+\.)+[a-z]{2,})(?::\d{1,5})?(?:[/?#][^\s]*)?$/i,
  SCROLL_PAD: 8,
  NAVIGATE_THROTTLE_MS: 150,
  NONE: -1,
  LIST_VARIANTS: {
    hidden: {},
    show: {
      transition: {
        staggerChildren: 0.022,
        delayChildren: 0.03
      }
    }
  },
  ITEM_VARIANTS: {
    hidden: {
      opacity: 0,
      y: 8
    },
    show: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.28,
        ease: [0.22, 1, 0.36, 1] as [number, number, number, number]
      }
    }
  }
} as const

export { ENGINE_UI }
