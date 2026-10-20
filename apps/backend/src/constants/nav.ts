interface NavItem {
  id: string
  label: string
  path: string
  icon: string
  group: string
}

const NAV_ITEMS: readonly NavItem[] = [
  { id: 'overview', label: '概览', path: '/overview', icon: 'lucide:layout-dashboard', group: '总览' },
  { id: 'users', label: '用户', path: '/users', icon: 'lucide:users', group: '身份' },
  { id: 'tenants', label: '租户', path: '/tenants', icon: 'lucide:building-2', group: '身份' },
  {
    id: 'providers',
    label: '供应商',
    path: '/gateway/providers',
    icon: 'lucide:server',
    group: '网关'
  },
  { id: 'models', label: '模型', path: '/gateway/models', icon: 'lucide:boxes', group: '网关' },
  { id: 'usage', label: '用量', path: '/gateway/usage', icon: 'lucide:chart-column', group: '网关' },
  { id: 'audit', label: '审计', path: '/gateway/audit', icon: 'lucide:scroll-text', group: '网关' },
  { id: 'prices', label: '价目', path: '/billing/prices', icon: 'lucide:tags', group: '商业' },
  {
    id: 'reconciliation',
    label: '对账',
    path: '/billing/reconciliation',
    icon: 'lucide:scale',
    group: '商业'
  },
  { id: 'sso', label: 'SSO', path: '/sso', icon: 'lucide:key-round', group: '接入' },
  { id: 'agent', label: 'Agent', path: '/agent', icon: 'lucide:bot', group: '运行时' },
  { id: 'rag', label: 'RAG', path: '/rag', icon: 'lucide:database', group: '运行时' }
] as const

const DEFAULT_NAV_ORDER = NAV_ITEMS.map(function (item) {
  return item.id
})

const DEFAULT_DASHBOARD_WIDGETS = ['health', 'usage', 'providers', 'approvals'] as const

export { DEFAULT_DASHBOARD_WIDGETS, DEFAULT_NAV_ORDER, NAV_ITEMS }
export type { NavItem }
