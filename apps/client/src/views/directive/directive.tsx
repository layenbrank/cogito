import { Decorations } from '@/components/decorations/index.ts'
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { findComponentLabel } from '@/constants/marketplace/tile-hints'
import { useShowsTileSession } from '@/features/magnetic-tile/session-bar'
import { safeDecodeURIComponent } from '@/utils/safe-decode.ts'
import { Suspense, lazy } from 'react'
import { Outlet, useParams } from 'react-router-dom'
import { Spinner } from '@cogito/design/components/spinner'
import { useCorexStore } from '@/stores/corex.ts'
import { useDockStore } from '@/features/agent/dock'
import { DirectiveFrame } from '@/views/directive/dock/directive-frame.tsx'
import { DirectiveLibrary } from '@/views/directive/library/library.tsx'

const DirectiveWorkspace = lazy(function () {
  return import('@/views/directive/workspace.tsx')
})

function DirectiveCaptionBegin(props: { name?: string }) {
  const editorName = useCorexStore(function (state) {
    return state.editorName
  })
  const isDirty = useCorexStore(function (state) {
    if (!state.draft || !state.baselineJson) return false
    return state.isDraftDirty()
  })
  const showsSession = useShowsTileSession()
  const label = findComponentLabel('directive')
  const name = props.name || editorName

  if (!name) {
    if (showsSession) return null
    return <span className="truncate px-1 text-sm font-medium">{label}</span>
  }

  return (
    <span className="flex min-w-0 items-center gap-1.5 px-1">
      <span className="truncate text-sm font-medium">
        {showsSession ? null : (
          <>
            {label}
            <span className="text-muted-foreground"> · </span>
          </>
        )}
        {name}
      </span>
      {isDirty ? (
        <span
          role="img"
          aria-label="未保存"
          title="未保存"
          className="size-1.5 shrink-0 rounded-full bg-amber-500"
        />
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        className="ml-1 h-6 gap-1 px-1.5 text-[11px] font-normal"
        title="打开 AI 助手（就地改这条指令）"
        onClick={function () {
          useDockStore.getState().toToggle()
        }}>
        <Icon
          icon="lucide:sparkles"
          className="size-3.5"
        />
        AI
      </Button>
    </span>
  )
}

function DirectiveLibraryPage() {
  return (
    <Decorations
      summary={findComponentLabel('directive')}
      scrollable={false}>
      <DirectiveFrame>
        <DirectiveLibrary />
      </DirectiveFrame>
    </Decorations>
  )
}

function DirectiveWorkspacePage() {
  const params = useParams()
  const name = params.name ? safeDecodeURIComponent(params.name) : undefined

  return (
    <Decorations
      begin={<DirectiveCaptionBegin name={name} />}
      scrollable={false}>
      <Suspense
        fallback={
          <div className="flex h-full min-h-0 flex-1 items-center justify-center">
            <Spinner className="size-10 text-muted-foreground" />
          </div>
        }>
        <DirectiveFrame>
          <DirectiveWorkspace />
        </DirectiveFrame>
      </Suspense>
    </Decorations>
  )
}

/** 路由壳：仅透传子页；底栏在各页 Decorations 内容区内拆分高度 */
function DirectiveShell() {
  return <Outlet />
}

export default DirectiveShell
export { DirectiveLibraryPage, DirectiveWorkspacePage }
