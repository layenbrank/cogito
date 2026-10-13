/**
 * 输入区右下角的模型入口（`Thread` 的 `ComposerEnd` 槽位）。
 *
 * 只放一个触发按钮，弹层复用 `AgentModelPicker` —— 模型切换仍走 `switchGooseProviderModel`
 * （写 goose defaults + 对已打开会话就地 setConfigOption），与新端口读的是同一份存储。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { useNavigate } from 'react-router-dom'

import { AgentModelPicker } from '@/views/agent/chat/components/model-picker'
import { useProviderStore } from '@/stores/provider'

function ComposerModelEnd() {
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
  const label = activeProvider?.model?.trim() || (activeProvider ? '选择模型' : '配置模型')

  return (
    <AgentModelPicker
      onOpenSettings={function () {
        void navigate('/agent/settings')
      }}>
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground gap-1.5">
        <Icon
          icon="mdi:cube-outline"
          width={14}
          height={14}
        />
        {label}
      </Button>
    </AgentModelPicker>
  )
}

export { ComposerModelEnd }
