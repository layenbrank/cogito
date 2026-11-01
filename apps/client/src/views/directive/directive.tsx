import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Outlet, useParams } from 'react-router-dom'

import { findComponentLabel } from '@/constants/marketplace/tile-hints'
import { useDockStore } from '@/features/agent/dock'
import { useShowsTileSession } from '@/features/magnetic-tile/session-bar'
import { useShellSurface } from '@/features/window-shell/slots'
import { useCorexStore } from '@/stores/corex.ts'
import { safeDecodeURIComponent } from '@/utils/safe-decode.ts'
import { DirectiveFrame } from '@/views/directive/dock/directive-frame.tsx'
import { DirectiveLibrary } from '@/views/directive/library/library.tsx'
import DirectiveWorkspace from '@/views/directive/workspace.tsx'

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
  useShellSurface({
    summary: findComponentLabel('directive'),
    scrollable: false
  })

  return (
    <DirectiveFrame>
      <DirectiveLibrary />
    </DirectiveFrame>
  )
}

function DirectiveWorkspacePage() {
  const params = useParams()
  const name = params.name ? safeDecodeURIComponent(params.name) : undefined

  useShellSurface({
    begin: <DirectiveCaptionBegin name={name} />,
    scrollable: false
  })

  return (
    <DirectiveFrame>
      <DirectiveWorkspace />
    </DirectiveFrame>
  )
}

/** 路由壳：仅透传子页；各子页经 useShellSurface 申报操作栏 */
function DirectiveShell() {
  return <Outlet />
}

export default DirectiveShell
export { DirectiveLibraryPage, DirectiveWorkspacePage }
