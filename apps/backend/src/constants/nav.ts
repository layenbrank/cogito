interface NavItem {
  id: string
  label: string
  path: string
  icon: string
  /** 对应 NavGroup.id */
  group: string
  /** 悬停提示；侧栏折叠时一并展示 */
  hint?: string
}

interface NavGroup {
  id: string
  label: string
  icon: string
}

const NAV_GROUPS: readonly NavGroup[] = [
  { id: '总览', label: '总览', icon: 'lucide:layout-dashboard' },
  { id: '身份', label: '身份', icon: 'lucide:shield' },
  { id: '网关', label: '网关', icon: 'lucide:waypoints' },
  { id: '观测', label: '观测', icon: 'lucide:activity' },
  { id: '商业', label: '商业', icon: 'lucide:wallet' },
  { id: '接入', label: '接入', icon: 'lucide:plug' },
  { id: '运行时', label: '运行时', icon: 'lucide:cpu' },
  { id: '控制台', label: '控制台', icon: 'lucide:settings-2' }
] as const

const NAV_ITEMS: readonly NavItem[] = [
  {
    id: 'overview',
    label: '概览',
    path: '/overview',
    icon: 'lucide:layout-dashboard',
    group: '总览',
    hint: '日活 / 月活与异常信号；小部件可拖拽同步'
  },
  {
    id: 'users',
    label: '用户',
    path: '/users',
    icon: 'lucide:users',
    group: '身份',
    hint: '平台账号；角色与状态可调整'
  },
  {
    id: 'tenants',
    label: '租户',
    path: '/tenants',
    icon: 'lucide:building-2',
    group: '身份',
    hint: '组织与成员'
  },
  {
    id: 'providers',
    label: '供应商',
    path: '/gateway/providers',
    icon: 'lucide:server',
    group: '网关',
    hint: '上游模型供应商；密钥只写不读'
  },
  {
    id: 'models',
    label: '模型',
    path: '/gateway/models',
    icon: 'lucide:boxes',
    group: '网关',
    hint: '按供应商治理能力与配额'
  },
  {
    id: 'usage',
    label: '用量',
    path: '/gateway/usage',
    icon: 'lucide:chart-column',
    group: '网关',
    hint: '跨租户 token 用量'
  },
  {
    id: 'logs',
    label: '日志',
    path: '/logs',
    icon: 'lucide:scroll-text',
    group: '观测',
    hint: '网关操作时间线，可导出'
  },
  {
    id: 'exceptions',
    label: '异常',
    path: '/exceptions',
    icon: 'lucide:triangle-alert',
    group: '观测',
    hint: '客户端运行时异常；问题分组与详情'
  },
  {
    id: 'prices',
    label: '价目',
    path: '/billing/prices',
    icon: 'lucide:tags',
    group: '商业',
    hint: '平台默认价与租户专属价'
  },
  {
    id: 'reconciliation',
    label: '对账',
    path: '/billing/reconciliation',
    icon: 'lucide:scale',
    group: '商业',
    hint: '用量 × 价目运维汇总'
  },
  {
    id: 'sso',
    label: 'SSO',
    path: '/sso',
    icon: 'lucide:key-round',
    group: '接入',
    hint: 'OIDC 连接；客户端密钥只写不读'
  },
  {
    id: 'agent',
    label: 'Agent',
    path: '/agent',
    icon: 'lucide:bot',
    group: '运行时',
    hint: '按任务 ID 查询 durable agent 状态'
  },
  {
    id: 'rag',
    label: 'RAG',
    path: '/rag',
    icon: 'lucide:database',
    group: '运行时',
    hint: '按索引任务 ID 查询进度与结果'
  },
  {
    id: 'preferences',
    label: '偏好',
    path: '/preferences',
    icon: 'lucide:sliders-horizontal',
    group: '控制台',
    hint: '导航序、钉选、看板小部件与书签'
  }
] as const

const DEFAULT_NAV_ORDER = NAV_ITEMS.map(function (item) {
  return item.id
})

const DEFAULT_DASHBOARD_WIDGETS = ['health', 'usage', 'providers', 'approvals'] as const

/** 对齐 antd Layout.Sider `defaultCollapsed`：首次进入是否收起侧栏 */
const RAIL_DEFAULT_COLLAPSED = false

/**
 * 对齐 antd Menu `defaultOpenKeys`：分组默认是否展开。
 * true = 全开（collapsedNavGroups 为空）；false = 全收（首次写入全部 group）。
 */
const NAV_GROUP_DEFAULT_OPEN = true

/** 分类标题是否默认显示图标；偏好页可覆盖并本地持久化 */
const NAV_GROUP_SHOW_ICON = true

function findNavItem(path: string) {
  const exact = NAV_ITEMS.find(function (item) {
    return item.path === path
  })
  if (exact) return exact
  return NAV_ITEMS.find(function (item) {
    return path.startsWith(`${item.path}/`)
  })
}

function findNavById(id: string) {
  return NAV_ITEMS.find(function (item) {
    return item.id === id
  })
}

export {
  DEFAULT_DASHBOARD_WIDGETS,
  DEFAULT_NAV_ORDER,
  NAV_GROUPS,
  NAV_GROUP_DEFAULT_OPEN,
  NAV_GROUP_SHOW_ICON,
  NAV_ITEMS,
  RAIL_DEFAULT_COLLAPSED,
  findNavById,
  findNavItem
}
export type { NavGroup, NavItem }
