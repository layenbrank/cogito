/**
 * 输入区右下角：仅模型（审批已挪到 ComposerStart）。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { useNavigate } from 'react-router-dom'

import { AgentModelPicker } from './model-picker'
import { findModelLabel } from '@/features/agent/model/display'
import { useProviderStore } from '@/stores/provider'

function ComposerEnd() {
  const navigate = useNavigate()

  const providers = useProviderStore(function (state) {
    return state.providers
  })
  const activeProviderID = useProviderStore(function (state) {
    return state.activeProviderID
  })
  const activeProvider = providers.find(function (provider) {
    return provider.id === activeProviderID && provider.enabled
  })
  const label = activeProvider?.model?.trim()
    ? findModelLabel(activeProvider.model, activeProvider)
    : activeProvider
      ? '选择模型'
      : '配置模型'

  return (
    <AgentModelPicker
      onOpenSettings={function () {
        void navigate('/agent/settings?section=model')
      }}>
      <Button
        variant="ghost"
        size="sm"
        title={label}
        className="text-muted-foreground h-7 max-w-[7.5rem] min-w-0 gap-1.5 px-2 @min-[32rem]:max-w-[10rem] @min-[42rem]:max-w-[14rem]">
        <Icon
          icon="lucide:box"
          width={14}
          height={14}
          className="size-3.5 shrink-0"
        />
        <span className="min-w-0 truncate">{label}</span>
      </Button>
    </AgentModelPicker>
  )
}

export { ComposerEnd }
