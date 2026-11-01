import { useShellSurface } from '@/features/window-shell/slots'
import Shell from '@/views/settings/shell.tsx'

/** 设置：侧栏与滚动区自管，槽只申报外壳 */
export default function Settings() {
  useShellSurface({ scrollable: false })
  return <Shell />
}
