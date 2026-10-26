const COMPONENT_LABELS: Partial<Record<MagneticTile.Component, string>> = {
  bookmark: '书签文件夹',
  calendar: '日历',
  clock: '时钟',
  countdown: '倒计时',
  code: '代码',
  clipchamp: '视频',
  collection: '集合',
  marketplace: '商店',
  knowledge: '知识库',
  morph: '变形',
  settings: '设置',
  agent: '智能',
  developer: '开发者',
  gallery: '图库',
  signboard: '看板',
  capture: '截屏',
  directive: '指令',
  example: '示例',
  navigation: '网址'
}

const TILE_HINTS: Partial<Record<MagneticTile.Component, string>> = {
  bookmark: '导入 Chrome 书签到书签库，可选挂到网址/集合磁贴',
  calendar: '日程安排与宜忌参考',
  clock: '数字与指针时钟样式',
  countdown: '目标日倒数与进度',
  code: '代码片段浏览与编辑',
  clipchamp: '视频剪辑快捷入口',
  collection: '应用集合分组管理',
  marketplace: '发现并添加更多磁贴',
  knowledge: '知识库：文档管理与全文检索，可交给智能体整理生成',
  morph: '形态变换与视觉实验',
  settings: '应用偏好与系统设置',
  agent: 'AI 对话；可口述实现并验证指令',
  developer: '开发者工具与调试',
  gallery: '图库浏览与管理',
  signboard: '看板任务与状态流转',
  capture: '截屏与标注工具',
  directive: '指令编排与自动化；可与智能助手联用',
  example: '示例磁贴与演示',
  navigation: '网址快捷入口'
}

function findComponentLabel(component: MagneticTile.Component) {
  return COMPONENT_LABELS[component] ?? component
}

function findTileHint(component: MagneticTile.Component, fallback: string) {
  return TILE_HINTS[component] ?? fallback
}

export { COMPONENT_LABELS, TILE_HINTS, findComponentLabel, findTileHint }
