import { useShellSurface } from '@/features/window-shell/slots'
import { ClipchampCaptionBegin } from '@/views/clipchamp/caption/begin.tsx'
import { ClipchampCaptionFinal } from '@/views/clipchamp/caption/final.tsx'
import ClipchampWorkspace from '@/views/clipchamp/workspace/workspace.tsx'

/**
 * Clipchamp：begin / final 填业务控件；窗口壳由 ShellFrame 常驻。
 */
export default function Clipchamp() {
  useShellSurface({
    begin: <ClipchampCaptionBegin />,
    final: <ClipchampCaptionFinal />,
    scrollable: false
  })

  return <ClipchampWorkspace />
}
