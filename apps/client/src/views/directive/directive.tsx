import { Decorations } from '@/components/decorations/index.ts'
import { findComponentLabel } from '@/constants/marketplace/tile-hints'
import { useShowsTileSession } from '@/features/magnetic-tile/session-bar'
import { safeDecodeURIComponent } from '@/utils/safe-decode.ts'
import { Suspense, lazy } from 'react'
import { Outlet, useParams } from 'react-router-dom'
import { Spinner } from '@i-thinking/design/components/spinner'

import { useCorexStore } from '@/stores/corex.ts'
import { DirectiveLibrary } from '@/views/directive/library/library.tsx'

const DirectiveWorkspace = lazy(function () {
  return import('@/views/directive/workspace.tsx')
})

function DirectiveCaptionBegin(props: { name?: string }) {
  const editorName = useCorexStore(function (state) {
    return state.editorName
  })
  // 先读 draft / baseline，保证脏态订阅；再算 isDraftDirty
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
    </span>
  )
}

function DirectiveLibraryPage() {
  return (
    <Decorations summary={findComponentLabel('directive')}>
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        <DirectiveLibrary />
      </div>
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
          <div className="flex flex-1 items-center justify-center">
            <Spinner className="size-10 text-muted-foreground" />
          </div>
        }>
        <DirectiveWorkspace />
      </Suspense>
    </Decorations>
  )
}

/** 路由出口：库列表 / 编排工作区 */
function DirectiveShell() {
  return <Outlet />
}

export default DirectiveShell
export { DirectiveLibraryPage, DirectiveWorkspacePage }
