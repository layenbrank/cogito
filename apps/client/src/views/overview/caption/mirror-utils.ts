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
  'lucide:zap',
  'lucide:sun',
  'lucide:moon',
  'lucide:cloud',
  'lucide:cloud-sun',
  'lucide:mountain',
  'lucide:trees',
  'lucide:flower-2',
  'lucide:leaf',
  'lucide:flame',
  'lucide:droplet',
  'lucide:snowflake',
  'lucide:umbrella',
  'lucide:lightbulb',
  'lucide:puzzle',
  'lucide:shapes',
  'lucide:pen-tool',
  'lucide:pencil',
  'lucide:brush',
  'lucide:scissors',
  'lucide:image',
  'lucide:aperture',
  'lucide:video',
  'lucide:clapperboard',
  'lucide:headphones',
  'lucide:mic',
  'lucide:radio',
  'lucide:guitar',
  'lucide:library',
  'lucide:graduation-cap',
  'lucide:newspaper',
  'lucide:flask-conical',
  'lucide:atom',
  'lucide:microscope',
  'lucide:telescope',
  'lucide:stethoscope',
  'lucide:activity',
  'lucide:heart-pulse',
  'lucide:hospital',
  'lucide:pill',
  'lucide:building-2',
  'lucide:landmark',
  'lucide:store',
  'lucide:factory',
  'lucide:warehouse',
  'lucide:map',
  'lucide:map-pin',
  'lucide:plane',
  'lucide:car',
  'lucide:ship',
  'lucide:train-front',
  'lucide:bike',
  'lucide:shopping-bag',
  'lucide:gift',
  'lucide:gem',
  'lucide:crown',
  'lucide:award',
  'lucide:trophy',
  'lucide:medal',
  'lucide:flag',
  'lucide:target',
  'lucide:inbox',
  'lucide:mail',
  'lucide:message-circle',
  'lucide:phone',
  'lucide:users',
  'lucide:user-round',
  'lucide:bot',
  'lucide:brain',
  'lucide:cpu',
  'lucide:database',
  'lucide:server',
  'lucide:wifi',
  'lucide:settings',
  'lucide:wrench',
  'lucide:hammer',
  'lucide:key',
  'lucide:lock',
  'lucide:shield',
  'lucide:eye',
  'lucide:glasses',
  'lucide:box',
  'lucide:package',
  'lucide:archive',
  'lucide:files',
  'lucide:file-text',
  'lucide:kanban',
  'lucide:chart-pie',
  'lucide:chart-column',
  'lucide:wallet',
  'lucide:credit-card',
  'lucide:banknote',
  'lucide:cat',
  'lucide:dog',
  'lucide:bird',
  'lucide:fish',
  'lucide:apple',
  'lucide:pizza',
  'lucide:utensils',
  'lucide:cake',
  'lucide:ice-cream-cone',
  'lucide:wine',
  'lucide:cup-soda',
  'lucide:dumbbell',
  'lucide:anchor',
  'lucide:tent',
  'lucide:tree-pine',
  'lucide:sprout',
  'lucide:orbit',
  'lucide:satellite',
  'lucide:hexagon',
  'lucide:wand-sparkles'
] as const

/**
 * 镜像背景色预设（写入 `background.color`）。
 * 仍保持足够浅，深色文字能读；色相拉开，避免一排发灰的淡彩。
 */
const MIRROR_COLOR_PRESETS = [
  { label: '群青', value: '#A8BEF8' },
  { label: '晴空', value: '#8FCBF2' },
  { label: '松绿', value: '#8FD4AE' },
  { label: '杏黄', value: '#E8B56A' },
  { label: '珊瑚', value: '#E89088' },
  { label: '藤紫', value: '#B89AEE' },
  { label: '玫粉', value: '#E090B0' },
  { label: '湖青', value: '#7EC8C4' }
] as const

/** 库里的 background 可能仍是 JSON 字符串；空颜色视为未设置。 */
function findAccent(background: Mirror['background'] | string | null | undefined) {
  let record: Mirror['background'] = null
  if (typeof background === 'string') {
    try {
      record = JSON.parse(background) as Mirror['background']
    } catch {
      record = null
    }
  } else {
    record = background ?? null
  }
  const color = record?.color?.trim() ?? ''
  return color || null
}

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
  findAccent,
  findMirrorIcon,
  findNextTitle,
  isIconMark
}
