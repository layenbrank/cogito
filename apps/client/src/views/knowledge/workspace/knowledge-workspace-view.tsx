import { clsx } from 'clsx'

import { DiscardDialog } from '@/views/knowledge/workspace/discard-dialog.tsx'
import { EmptyState } from '@/views/knowledge/workspace/empty-state.tsx'
import { ExternalDialog } from '@/views/knowledge/workspace/external-dialog.tsx'
import { FocusExit } from '@/views/knowledge/workspace/focus-exit.tsx'
import { Overlay } from '@/views/knowledge/workspace/overlay/index.ts'
import type { useKnowledgeWorkspace } from '@/views/knowledge/workspace/use-knowledge-workspace.ts'
import {
  WorkspaceBootstrapSkeleton,
  WorkspaceSurfaces
} from '@/views/knowledge/workspace/workspace-surfaces.tsx'

import styles from '@/views/knowledge/workspace/markdown.module.scss'

type KnowledgeWorkspaceState = ReturnType<typeof useKnowledgeWorkspace>

function KnowledgeWorkspaceView(props: KnowledgeWorkspaceState) {
  const isShellVisible = !props.isFocusMode
  const isDark = document.documentElement.classList.contains('dark')

  return (
    <div className={clsx([styles.markdown, styles.root, 'relative'])}>
      {props.isFocusMode ? <FocusExit onExit={props.exitFocusMode} /> : null}

      {isShellVisible && props.isSessionReady && props.hasOpened ? (
        <Overlay.Utility
          onToggleFind={function () {
            props.setFindPreferReplace(false)
            props.toggleFindOpen()
          }}
        />
      ) : null}

      {!props.isSessionReady ? (
        <WorkspaceBootstrapSkeleton />
      ) : !props.hasOpened ? (
        <EmptyState
          onOpenFile={function () {
            void props.handleOpenFile()
          }}
          onOpenFolder={function () {
            void props.handleOpenFolder()
          }}
          onNew={props.handleNew}
          onOpenRecent={props.handleOpenPath}
        />
      ) : (
        <WorkspaceSurfaces
          activePath={props.activePath}
          isFindOpen={props.isFindOpen}
          isFocusMode={props.isFocusMode}
          isDocLoading={props.isDocLoading}
          findPreferReplace={props.findPreferReplace}
          viewMode={props.viewMode}
          composer={props.composer}
          markdown={props.markdown}
          fontSize={props.fontSize}
          isDark={isDark}
          onSourceChange={props.onSourceChange}
        />
      )}

      <DiscardDialog
        open={props.discardOpen}
        onOpenChange={props.setDiscardOpen}
        onDiscard={props.onDiscardPending}
        onSave={props.onSavePending}
      />
      <ExternalDialog
        open={props.externalChanged}
        onKeep={props.onExternalKeep}
        onReload={props.onExternalReload}
      />
      <ExternalDialog
        open={props.saveConflict}
        onKeep={props.onSaveConflictKeep}
        onReload={props.onSaveConflictReload}
      />
    </div>
  )
}

export { KnowledgeWorkspaceView }
