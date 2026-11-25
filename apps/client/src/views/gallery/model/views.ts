import type { GalleryRow } from '@/views/gallery/model/asset'

/**
 * 视图定义表：一个视图就是一个纯数据规则。
 *
 * 侧栏只渲染这张表 —— 新增视图不改 UI 代码。三条来源：
 * - Bridge：全部 / 照片 / 视频 / 待筛 / 4★ / 拒绝 / 重复项
 * - Lap：已隐藏（PIN 库）
 * - 本仓库：截屏（capture 托管）
 */
type GalleryViewID =
  | 'all'
  | 'recent'
  | 'photos'
  | 'videos'
  | 'screenshots'
  | 'culling'
  | 'rated4'
  | 'rejected'
  | 'duplicates'
  | 'missing'
  | 'hidden'

interface GalleryViewDef {
  id: GalleryViewID
  label: string
  /** iconify 名（lucide） */
  icon: string
  /** 分组：侧栏用它分节 */
  group: 'library' | 'smart' | 'system'
  /** 可作为「基础过滤」。album / smart album 视图另外叠在 `all` 上 */
  match: (row: GalleryRow, ctx: ViewContext) => boolean
  emptyHint: string
}

interface ViewContext {
  /** dupGroup → 组大小；>= 2 才算重复 */
  dupCounts: Map<string, number>
}

const DAY_MS = 24 * 60 * 60 * 1000

const VIEWS: readonly GalleryViewDef[] = [
  {
    id: 'all',
    label: '全部',
    icon: 'lucide:layout-grid',
    group: 'library',
    match: () => true,
    emptyHint: '还没有照片。导入一个文件夹，或直接拖进来。'
  },
  {
    id: 'recent',
    label: '最近',
    icon: 'lucide:history',
    group: 'library',
    match: (row) => Date.now() - row.capturedAt <= 30 * DAY_MS,
    emptyHint: '最近 30 天没有新照片。'
  },
  {
    id: 'photos',
    label: '照片',
    icon: 'lucide:image',
    group: 'library',
    match: (row) => row.kind === 'image',
    emptyHint: '还没有照片。'
  },
  {
    id: 'videos',
    label: '视频',
    icon: 'lucide:video',
    group: 'library',
    match: (row) => row.kind === 'video',
    emptyHint: '还没有视频。'
  },
  {
    id: 'screenshots',
    label: '截屏',
    icon: 'lucide:monitor',
    group: 'library',
    match: (row) => row.source === 'capture' && row.captureKind !== 'recording',
    emptyHint: '还没有截屏。'
  },
  {
    id: 'culling',
    label: '待筛',
    icon: 'lucide:list-checks',
    group: 'smart',
    match: (row) => row.rating === 0 && row.flag !== 'rejected',
    emptyHint: '没有待筛的照片 —— 全部都已经评过级。'
  },
  {
    id: 'rated4',
    label: '4★ 及以上',
    icon: 'lucide:star',
    group: 'smart',
    match: (row) => row.rating >= 4,
    emptyHint: '还没有 4★ 以上的照片。'
  },
  {
    id: 'rejected',
    label: '已拒绝',
    icon: 'lucide:ban',
    group: 'smart',
    match: (row) => row.flag === 'rejected',
    emptyHint: '没有被拒绝的照片。'
  },
  {
    id: 'duplicates',
    label: '重复项',
    icon: 'lucide:copy',
    group: 'smart',
    match: (row, ctx) => (ctx.dupCounts.get(row.id) ?? 0) > 1,
    emptyHint: '没有字节级重复的文件。'
  },
  {
    id: 'missing',
    label: '位置失效',
    icon: 'lucide:unlink',
    group: 'system',
    match: (row) => row.missing,
    emptyHint: '所有照片都还在原地。'
  },
  {
    id: 'hidden',
    label: '已隐藏',
    icon: 'lucide:lock',
    group: 'system',
    match: (row) => row.hidden,
    emptyHint: '隐藏库里没有照片。'
  }
]

const VIEW_BY_ID = new Map<GalleryViewID, GalleryViewDef>(
  VIEWS.map(function (view) {
    return [view.id, view]
  })
)

/** 5★ 不给当天：只有 4★ 且拍摄于 30 天前的才进候选（视图层自己算时间，不进纯数据表）。 */
function findFiveStarCandidates(rows: GalleryRow[]): GalleryRow[] {
  const cutoff = Date.now() - 30 * DAY_MS
  return rows.filter(function (row) {
    return row.rating === 4 && row.capturedAt <= cutoff
  })
}

// ── 三遍筛片 ──────────────────────────────────────────────────────────

interface CullingPass {
  id: 1 | 2 | 3
  title: string
  question: string
  hint: string
}

const CULLING_PASSES: readonly CullingPass[] = [
  {
    id: 1,
    title: '第一遍 · 看全部',
    question: '有没有硬伤？',
    hint: '跑焦、手抖、严重过曝、闭眼、误拍 → X 拒绝；其余给 1★'
  },
  {
    id: 2,
    title: '第二遍 · 只看 1★',
    question: '愿意给别人看吗？',
    hint: '愿意 → 3★；有点意思但不够好 → 2★'
  },
  {
    id: 3,
    title: '第三遍 · 只看 3★',
    question: '哪几张是这次最好的？',
    hint: '这次最好的 → 4★；5★ 不当天给，30 天后再看'
  }
]

/** 星级标准（写进 tooltip / 引导）；每一档只回答一个问题。 */
const RATING_STANDARDS: readonly { value: number; question: string; meaning: string }[] = [
  { value: 0, question: '还没看？', meaning: '未评级' },
  { value: 1, question: '技术过关吗？', meaning: '对焦正确、曝光能救，作为记录留着' },
  { value: 2, question: '有点意思吗？', meaning: '瞬间或内容不错，但光线构图一般；连拍备选' },
  { value: 3, question: '愿意给别人看吗？', meaning: '值得调色、可以发朋友圈' },
  { value: 4, question: '是这次最好的吗？', meaning: '每次拍摄只有几张，进作品集' },
  { value: 5, question: '一年后还会喜欢吗？', meaning: '愿意打印挂墙的代表作，30 天后才给' }
]

export {
  CULLING_PASSES,
  DAY_MS,
  RATING_STANDARDS,
  VIEWS,
  VIEW_BY_ID,
  findFiveStarCandidates
}
export type { CullingPass, GalleryViewDef, GalleryViewID, ViewContext }
