import { cn } from 'cn'
import { toast } from 'sonner'

import { useSpacesStore } from '@/stores/spaces'
import { useKnowledgeStore } from '@/stores/knowledge'
import { isSamePath } from '@/views/knowledge/lib/path.ts'
import { t } from '@/views/knowledge/locale.ts'
import {
  SummaryStatsRow,
  SummaryWorkspaceRow
} from '@/views/knowledge/workspace/overlay/summary-parts.tsx'

function findWorkspaceLabel(input: {
  rootDir: string | null
  spaces: ReturnType<typeof useSpacesStore.getState>['spaces']
  activeSpaceID: string | null
}): string {
  const activeSpace = input.spaces.find(function (space) {
    return space.id === input.activeSpaceID
  })
  if (input.rootDir && activeSpace && isSamePath(input.rootDir, activeSpace.rootPath)) {
    return activeSpace.name
  }
  if (input.rootDir) {
    return input.rootDir.split(/[\\/]/).filter(Boolean).pop() ?? t('WORKSPACE')
  }
  return t('WORKSPACE')
}

/** 窗口底栏状态（ShellFrame section 槽） */
function Summary() {
  const activePath = useKnowledgeStore(function (state) {
    return state.activePath
  })
  const isDirty = useKnowledgeStore(function (state) {
    return state.isDirty
  })
  const stats = useKnowledgeStore(function (state) {
    return state.stats
  })
  const viewMode = useKnowledgeStore(function (state) {
    return state.viewMode
  })
  const isFocusMode = useKnowledgeStore(function (state) {
    return state.isFocusMode
  })
  const rootDir = useKnowledgeStore(function (state) {
    return state.rootDir
  })
  const isSessionReady = useKnowledgeStore(function (state) {
    return state.isSessionReady
  })
  const isDocLoading = useKnowledgeStore(function (state) {
    return state.isLoading
  })
  const spaces = useSpacesStore(function (state) {
    return state.spaces
  })
  const activeSpaceID = useSpacesStore(function (state) {
    return state.activeSpaceID
  })

  if (isFocusMode) return null

  const workspaceLabel = findWorkspaceLabel({ rootDir, spaces, activeSpaceID })
  const fileLabel = activePath?.split(/[/\\]/).pop() ?? t('UNTITLED')
  const isBootstrapping = !isSessionReady || isDocLoading

  function onCopyPath() {
    if (!activePath) return
    void navigator.clipboard.writeText(activePath).then(function () {
      toast.success(t('COPY_PATH'))
    })
  }

  return (
    <div
      className={cn(
        'flex h-5.5 w-full min-w-0 items-center justify-between text-xs leading-none text-muted-foreground'
      )}>
      <SummaryWorkspaceRow
        workspaceLabel={workspaceLabel}
        rootDir={rootDir}
        isBootstrapping={isBootstrapping}
        isDirty={isDirty}
        activePath={activePath}
        fileLabel={fileLabel}
        onCopyPath={onCopyPath}
      />
      <div className="flex shrink-0 items-center">
        <SummaryStatsRow
          isBootstrapping={isBootstrapping}
          words={stats.words}
          chars={stats.chars}
          lines={stats.lines}
          viewMode={viewMode}
        />
      </div>
    </div>
  )
}

export default Summary
