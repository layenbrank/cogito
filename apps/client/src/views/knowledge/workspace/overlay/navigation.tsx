/**
 * Markdown 工作区 · 左侧文件导航：搜索/新建工具条 + 文件树 + 右键新建/重命名/删除。
 */
import { useKnowledgeBaseStore } from '@/stores/knowledge-base'
import { useKnowledgeStore } from '@/stores/knowledge'
import { findFileName, isSamePath } from '@/views/knowledge/lib/path.ts'
import { t } from '@/views/knowledge/locale.ts'
import { DeleteConfirmDialog, NameDialog } from '@/views/knowledge/workspace/overlay/navigation-dialogs.tsx'
import { NavigationEmpty } from '@/views/knowledge/workspace/overlay/navigation-empty.tsx'
import { NavigationPanel } from '@/views/knowledge/workspace/overlay/navigation-panel.tsx'
import { useNavigationMutations } from '@/views/knowledge/workspace/overlay/use-navigation-mutations.tsx'
import { useNavigationTree } from '@/views/knowledge/workspace/overlay/use-navigation-tree.ts'

interface NavigationProps {
  onOpenPath: (path: string) => void
}

function Navigation(props: NavigationProps) {
  const rootDir = useKnowledgeStore(function (state) {
    return state.rootDir
  })
  const activePath = useKnowledgeStore(function (state) {
    return state.activePath
  })
  const treeRevision = useKnowledgeStore(function (state) {
    return state.treeRevision
  })
  const fileQuery = useKnowledgeStore(function (state) {
    return state.fileQuery
  })
  const bases = useKnowledgeBaseStore(function (state) {
    return state.bases
  })
  const activeBaseID = useKnowledgeBaseStore(function (state) {
    return state.activeBaseID
  })

  const activeBase = bases.find(function (base) {
    return base.id === activeBaseID
  })
  const rootTitle =
    rootDir && activeBase && isSamePath(rootDir, activeBase.rootPath)
      ? activeBase.name
      : rootDir
        ? findFileName(rootDir) || t('WORKSPACE')
        : t('WORKSPACE')

  const tree = useNavigationTree({
    rootDir,
    activePath,
    treeRevision,
    rootTitle,
    fileQuery,
    onOpenPath: props.onOpenPath
  })
  const mutations = useNavigationMutations(props.onOpenPath)

  if (!rootDir) {
    return <NavigationEmpty />
  }

  return (
    <>
      <NavigationPanel
        tree={tree}
        mutations={mutations}
      />

      <DeleteConfirmDialog
        target={mutations.pendingDelete}
        onCancel={function () {
          mutations.setPendingDelete(null)
        }}
        onConfirm={function () {
          void mutations.onConfirmDelete(tree.clearAbsolutePathCache)
        }}
      />

      <NameDialog
        title={t('RENAME')}
        name={mutations.renameTarget?.name ?? null}
        onChange={function (name) {
          mutations.setRenameTarget(function (prev) {
            if (!prev) return prev
            return { ...prev, name }
          })
        }}
        onCancel={function () {
          mutations.setRenameTarget(null)
        }}
        onConfirm={function () {
          void mutations.onConfirmRename(tree.clearAbsolutePathCache)
        }}
      />

      <NameDialog
        title={
          mutations.newTarget?.kind === 'folder' ? t('NEW_FOLDER') : t('NEW_FILE')
        }
        name={mutations.newTarget?.name ?? null}
        onChange={function (name) {
          mutations.setNewTarget(function (prev) {
            if (!prev) return prev
            return { ...prev, name }
          })
        }}
        onCancel={function () {
          mutations.setNewTarget(null)
        }}
        onConfirm={function () {
          void mutations.onConfirmCreate()
        }}
      />
    </>
  )
}

export default Navigation
