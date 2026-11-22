import { findNavMeta, type SectionKey } from '@/views/settings/constant.ts'
import { SURFACE_STACK, SettingsSection } from '@/views/settings/surfaces/section.tsx'

function DesktopSurface(props: { section: SectionKey }) {
  const label = findNavMeta(props.section)?.label ?? '这项'
  return (
    <div className={SURFACE_STACK}>
      <SettingsSection title={label}>
        <p className="text-sm text-muted-foreground">{label}跟桌面端同一套，扩展里没有对应的本机能力。</p>
      </SettingsSection>
    </div>
  )
}

export default DesktopSurface
