import { useShellSurface } from '@/features/window-shell/slots'
import { MorphBegin } from '@/views/morph/workspace/caption.tsx'
import MorphWorkspace from '@/views/morph/workspace/workspace.tsx'

export default function Morph() {
  useShellSurface({
    begin: <MorphBegin />,
    scrollable: false
  })

  return <MorphWorkspace />
}
