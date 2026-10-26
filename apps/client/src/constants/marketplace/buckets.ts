// —— booth（按 MagneticTile.Component 分桶）——

type BoothBucket =
  | 'all'
  | 'schedule'
  | 'notes'
  | 'media'
  | 'dev'
  | 'apps'
  | 'system'

type BoothBucketOption = {
  label: string
  value: BoothBucket
}

const BOOTH_BUCKETS: BoothBucketOption[] = [
  { label: '全部', value: 'all' },
  { label: '日程', value: 'schedule' },
  { label: '笔记', value: 'notes' },
  { label: '媒体', value: 'media' },
  { label: '开发', value: 'dev' },
  { label: '应用', value: 'apps' },
  { label: '系统', value: 'system' }
]

const COMPONENT_BUCKET: Partial<Record<MagneticTile.Component, Exclude<BoothBucket, 'all'>>> = {
  calendar: 'schedule',
  clock: 'schedule',
  countdown: 'schedule',
  bookmark: 'notes',
  knowledge: 'notes',
  signboard: 'notes',
  clipchamp: 'media',
  gallery: 'media',
  capture: 'media',
  morph: 'media',
  code: 'dev',
  developer: 'dev',
  example: 'dev',
  directive: 'dev',
  collection: 'apps',
  marketplace: 'apps',
  settings: 'system',
  agent: 'system'
}

function findBoothBucket(component: MagneticTile.Component): Exclude<BoothBucket, 'all'> {
  return COMPONENT_BUCKET[component] ?? 'system'
}

function matchBoothBucket(tile: Pick<MagneticTile, 'component'>, bucket: BoothBucket) {
  if (tile.component === 'navigation') return false
  if (bucket === 'all') return true
  return findBoothBucket(tile.component) === bucket
}

function findBoothBucketLabel(bucket: BoothBucket) {
  const option = BOOTH_BUCKETS.find(function (item) {
    return item.value === bucket
  })
  return option?.label ?? '全部'
}

// —— navigate（按站点标题分桶）——

type NavigateBucket =
  | 'all'
  | 'search'
  | 'shopping'
  | 'social'
  | 'video'
  | 'music'
  | 'news'
  | 'life'
  | 'dev'
  | 'office'
  | 'ai'
  | 'learn'
  | 'design'

type NavigateBucketOption = {
  label: string
  value: NavigateBucket
}

const NAVIGATE_BUCKETS: NavigateBucketOption[] = [
  { label: '全部', value: 'all' },
  { label: '搜索', value: 'search' },
  { label: '购物', value: 'shopping' },
  { label: '社交', value: 'social' },
  { label: '视频', value: 'video' },
  { label: '音乐', value: 'music' },
  { label: '资讯', value: 'news' },
  { label: '生活', value: 'life' },
  { label: '开发', value: 'dev' },
  { label: '办公', value: 'office' },
  { label: 'AI', value: 'ai' },
  { label: '学习', value: 'learn' },
  { label: '设计', value: 'design' }
]

const TITLE_BUCKET: Record<string, Exclude<NavigateBucket, 'all'>> = {
  百度: 'search',
  谷歌: 'search',
  必应: 'search',
  搜狗: 'search',

  淘宝: 'shopping',
  天猫: 'shopping',
  京东: 'shopping',
  拼多多: 'shopping',
  唯品会: 'shopping',
  苏宁: 'shopping',
  亚马逊: 'shopping',
  闲鱼: 'shopping',
  什么值得买: 'shopping',

  微博: 'social',
  知乎: 'social',
  豆瓣: 'social',
  小红书: 'social',
  V2EX: 'social',
  少数派: 'social',
  即刻: 'social',
  Reddit: 'social',
  Twitter: 'social',

  抖音: 'video',
  快手: 'video',
  哔哩哔哩: 'video',
  爱奇艺: 'video',
  优酷: 'video',
  腾讯视频: 'video',
  芒果TV: 'video',
  YouTube: 'video',

  网易云音乐: 'music',
  QQ音乐: 'music',
  喜马拉雅: 'music',

  今日头条: 'news',
  澎湃新闻: 'news',
  新浪: 'news',
  网易: 'news',
  搜狐: 'news',
  凤凰网: 'news',
  央视网: 'news',
  人民网: 'news',
  新华网: 'news',
  Wikipedia: 'news',
  'Hacker News': 'news',

  QQ: 'life',
  微信: 'life',
  美团: 'life',
  大众点评: 'life',
  饿了么: 'life',
  携程: 'life',
  去哪儿: 'life',
  飞猪: 'life',
  '12306': 'life',
  高德地图: 'life',
  百度地图: 'life',
  滴滴: 'life',
  支付宝: 'life',
  招商银行: 'life',
  东方财富: 'life',
  雪球: 'life',
  汽车之家: 'life',
  安居客: 'life',
  链家: 'life',

  GitHub: 'dev',
  Gitee: 'dev',
  GitLab: 'dev',
  'Stack Overflow': 'dev',
  MDN: 'dev',
  npm: 'dev',
  Rust: 'dev',
  Vue: 'dev',
  React: 'dev',
  TypeScript: 'dev',
  Vite: 'dev',
  Tailwind: 'dev',
  'Ant Design': 'dev',
  'Element Plus': 'dev',
  Iconify: 'dev',
  'Can I Use': 'dev',
  正则101: 'dev',
  JSON: 'dev',
  CSDN: 'dev',
  掘金: 'dev',
  思否: 'dev',
  开源中国: 'dev',
  'Arch Wiki': 'dev',
  'Docker Hub': 'dev',
  Cloudflare: 'dev',
  Vercel: 'dev',
  Netlify: 'dev',
  'Product Hunt': 'dev',

  Excalidraw: 'office',
  Figma: 'office',
  Notion: 'office',
  语雀: 'office',
  飞书: 'office',
  钉钉: 'office',
  腾讯文档: 'office',
  石墨文档: 'office',

  ChatGPT: 'ai',
  Claude: 'ai',
  Gemini: 'ai',
  DeepSeek: 'ai',
  通义千问: 'ai',
  Kimi: 'ai',
  文心一言: 'ai',
  智谱清言: 'ai',

  LeetCode: 'learn',
  牛客: 'learn',
  Coursera: 'learn',
  B站课堂: 'learn',
  中国大学MOOC: 'learn',
  Boss直聘: 'learn',
  智联招聘: 'learn',
  拉勾: 'learn',
  译学馆: 'learn',

  IconFont: 'design',
  Unsplash: 'design',
  Pexels: 'design',
  Dribbble: 'design'
}

function findNavigateBucket(
  tile: Pick<MagneticTile, 'title'>
): Exclude<NavigateBucket, 'all'> {
  return TITLE_BUCKET[tile.title] ?? 'life'
}

function matchNavigateBucket(
  tile: Pick<MagneticTile, 'title'>,
  bucket: NavigateBucket
) {
  if (bucket === 'all') return true
  return findNavigateBucket(tile) === bucket
}

function findNavigateBucketLabel(bucket: NavigateBucket) {
  const option = NAVIGATE_BUCKETS.find(function (item) {
    return item.value === bucket
  })
  return option?.label ?? '全部'
}

export {
  BOOTH_BUCKETS,
  NAVIGATE_BUCKETS,
  findBoothBucket,
  findBoothBucketLabel,
  findNavigateBucket,
  findNavigateBucketLabel,
  matchBoothBucket,
  matchNavigateBucket
}
export type {
  BoothBucket,
  BoothBucketOption,
  NavigateBucket,
  NavigateBucketOption
}
