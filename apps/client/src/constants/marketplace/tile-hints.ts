const COMPONENT_LABELS: Partial<Record<MagneticTile.Component, string>> = {
  bookmark: '书签',
  calendar: '日历',
  clock: '时钟',
  countdown: '倒计时',
  code: '编辑器',
  clipchamp: '剪辑',
  collection: '集合',
  marketplace: '商店',
  knowledge: '知识库',
  morph: 'PDF',
  settings: '设置',
  agent: 'Agent',
  gallery: '图库',
  signboard: '看板',
  capture: '截录',
  directive: '指令',
  example: '示例',
  navigation: '网址'
}

const TILE_HINTS: Partial<Record<MagneticTile.Component, string>> = {
  bookmark: '导入 Chrome 书签到书签库，可选挂到网址/集合磁贴',
  calendar: '月历与日程、提醒',
  clock: '多种表盘样式与闹钟提醒',
  countdown: '目标日倒数与进度',
  code: '本地工作区：编辑、搜索、Git 与 diff',
  clipchamp: '多轨视频剪辑：时间线、预览与工程',
  collection: '应用集合分组管理',
  marketplace: '发现并添加更多磁贴',
  knowledge: '文档库与全文检索；可交给副驾整理生成',
  morph: 'PDF 标注、合并拆分、转换与提取',
  settings: '应用偏好与系统设置',
  agent: '对标 Cursor / Copilot / Qoder：对话、工具调用、工作区与长任务',
  gallery: '本地媒体库、精选集与灯箱',
  signboard: '看板、甘特与卡片自动化',
  capture: '截屏与录屏历史库',
  directive: '可保存的动作编排与定时运行；可与副驾联用',
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
