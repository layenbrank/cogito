type AttachCategory = 'goal' | 'plan' | 'files' | 'plugins' | 'skills'

interface WorkspaceRoot {
  id: string
  path: string
  label: string
}

interface AttachMenuProps {
  roots: WorkspaceRoot[]
  category: AttachCategory
  onCategoryChange: (category: AttachCategory) => void
  initialQuery?: string
  onAttach: (file: { path: string; name: string }, relative?: string) => void
  onPickFile?: (relative: string) => void
}

export type { AttachCategory, AttachMenuProps, WorkspaceRoot }
