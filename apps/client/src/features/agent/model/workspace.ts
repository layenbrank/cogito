/** 工作区图标 / 副色选项（对齐 Qoder 新建工作区；图标一律 lucide） */

interface WorkspaceIconOption {
  key: string
  icon: string
}

const WORKSPACE_ICONS: WorkspaceIconOption[] = [
  { key: 'folder', icon: 'lucide:folder' },
  { key: 'code', icon: 'lucide:code' },
  { key: 'layout', icon: 'lucide:layout-grid' },
  { key: 'cloud', icon: 'lucide:cloud' },
  { key: 'atom', icon: 'lucide:flask-conical' },
  { key: 'setting', icon: 'lucide:settings' },
  { key: 'database', icon: 'lucide:database' },
  { key: 'bulb', icon: 'lucide:lightbulb' },
  { key: 'rocket', icon: 'lucide:rocket' },
  { key: 'book', icon: 'lucide:book' },
  { key: 'api', icon: 'lucide:plug' },
  { key: 'tool', icon: 'lucide:wrench' },
  { key: 'global', icon: 'lucide:globe' },
  { key: 'desktop', icon: 'lucide:monitor' },
  { key: 'coffee', icon: 'lucide:coffee' }
]

const WORKSPACE_COLORS = [
  '#166534',
  '#14532d',
  '#1e3a8a',
  '#1d4ed8',
  '#0e7490',
  '#0f766e',
  '#854d0e',
  '#9a3412',
  '#9f1239',
  '#86198f',
  '#5b21b6',
  '#3730a3',
  '#334155',
  '#3f3f46',
  '#171717'
]

const WORKSPACE_ICON = 'folder'
const WORKSPACE_COLOR = '#166534'
const UNGROUPED_WORKSPACE = '__ungrouped__'

function findWorkspaceIcon(key: string) {
  const matched = WORKSPACE_ICONS.find(function (item) {
    return item.key === key
  })
  return matched?.icon ?? WORKSPACE_ICONS[0].icon
}

export {
  WORKSPACE_ICONS,
  WORKSPACE_COLORS,
  WORKSPACE_ICON,
  WORKSPACE_COLOR,
  UNGROUPED_WORKSPACE,
  findWorkspaceIcon
}
export type { WorkspaceIconOption }
