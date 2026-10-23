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
    ? findModelLabel(activeProvider.model)
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
        className="text-muted-foreground gap-1.5">
        <Icon
          icon="lucide:box"
          width={14}
          height={14}
        />
        {label}
      </Button>
    </AgentModelPicker>
  )
}

export { ComposerEnd }
