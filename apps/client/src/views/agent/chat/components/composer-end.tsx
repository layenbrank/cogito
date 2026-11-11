/**
 * 输入区右下角：思考强度 + 模型（审批已挪到 ComposerStart）。
 *
 * 两者是两个入口，和 VS Code Copilot 一致：模型管「用谁」，思考强度管「想多久」。
 * 常驻在这里而不是折进模型浮层，切档位不用先打开模型列表。
 */
import { Button } from '@cogito/design/components/button'
import { ProviderLogo } from '@cogito/design/assistant/provider-logo'
import { useNavigate } from 'react-router-dom'

import { AgentModelPicker } from './model-picker'
import { ComposerThinking } from './composer-thinking'
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
    <div className="flex min-w-0 items-center gap-1">
      <ComposerThinking />
      <AgentModelPicker
        onOpenSettings={function () {
          void navigate('/agent/settings?section=model')
        }}>
        <Button
          variant="ghost"
          size="sm"
          title={label}
          className="text-muted-foreground h-7 max-w-[7.5rem] min-w-0 gap-1.5 px-2 @min-[32rem]:max-w-[10rem] @min-[42rem]:max-w-[14rem]">
          <ProviderLogo
            kind={activeProvider?.kind || activeProvider?.id || ''}
            size={14}
            className="shrink-0"
          />
          <span className="min-w-0 truncate">{label}</span>
        </Button>
      </AgentModelPicker>
    </div>
  )
}

export { ComposerEnd }
