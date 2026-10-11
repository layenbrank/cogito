import type { MirrorWrite } from '@/stores/mirror.ts'

/** 描述 Tooltip 延迟，避免划过列表时闪现 */
const DESC_TOOLTIP_DELAY = 600

/** 未设置 mark 时的展示 / 新建默认图标 */
const MIRROR_MARK_FALLBACK = 'lucide:layers'

/** 管理面可选的镜像图标（Iconify 名，写入 `mirror.mark`） */
const MIRROR_MARK_ICONS = [
  'lucide:layers',
  'lucide:layout-grid',
  'lucide:briefcase',
  'lucide:home',
  'lucide:sparkles',
  'lucide:palette',
  'lucide:code-2',
  'lucide:terminal',
  'lucide:music',
  'lucide:film',
  'lucide:book-open',
  'lucide:gamepad-2',
  'lucide:heart',
  'lucide:star',
  'lucide:coffee',
  'lucide:rocket',
  'lucide:globe',
  'lucide:camera',
  'lucide:folder',
  'lucide:bookmark',
  'lucide:calendar',
  'lucide:clock',
  'lucide:compass',
  'lucide:zap'
] as const

/** 镜像背景色预设（写入 `background.color`） */
const MIRROR_COLOR_PRESETS = [
  { label: '雾灰', value: '#F1F5F9' },
  { label: '天青', value: '#DBEAFE' },
  { label: '薄荷', value: '#D1FAE5' },
  { label: '蜜桃', value: '#FFEDD5' },
  { label: '玫瑰', value: '#FCE7F3' },
  { label: '淡紫', value: '#EDE9FE' },
  { label: '暖沙', value: '#FEF3C7' },
  { label: '青瓷', value: '#CCFBF1' }
] as const

function isIconMark(mark: string) {
  return mark.includes(':')
}

/** 解析用于展示的 Iconify 名；空 mark 回落到默认层叠图标 */
function findMirrorIcon(mark: string | null | undefined) {
  const value = mark?.trim() ?? ''
  if (value && isIconMark(value)) return value
  return MIRROR_MARK_FALLBACK
}

/** 新建镜像的默认配置（与迁移里种下的默认镜像同形，补默认图标） */
function buildMirrorWrite(title: string, index: number): MirrorWrite {
  return {
    title,
    index,
    mark: MIRROR_MARK_FALLBACK,
    description: '',
    background: null,
    backdrop: null,
    overlay: ''
  }
}

/** 「镜像-01」这类序号标题；重名顺延，避免建出两个同名 */
function findNextTitle(mirrors: Mirror[]): string {
  for (let n = mirrors.length + 1; n <= mirrors.length + 100; n += 1) {
    const candidate = `镜像-${String(n).padStart(2, '0')}`
    const taken = mirrors.some(function (mirror) {
      return mirror.title === candidate
    })
    if (!taken) return candidate
  }
  return `镜像-${Date.now()}`
}

export {
  DESC_TOOLTIP_DELAY,
  MIRROR_COLOR_PRESETS,
  MIRROR_MARK_FALLBACK,
  MIRROR_MARK_ICONS,
  buildMirrorWrite,
  findMirrorIcon,
  findNextTitle,
  isIconMark
}
