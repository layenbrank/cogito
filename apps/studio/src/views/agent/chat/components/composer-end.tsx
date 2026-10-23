import { TooltipProvider } from '@cogito/design/components/tooltip'
import { useNavigate } from 'react-router-dom'

import { ModelPicker } from '@/features/chat/model-picker.tsx'
import { ApprovalSwitch } from './approval-switch.tsx'

/**
 * 输入区右下角：访问权限与模型。
 *
 * 顺序照 Qoder 的说明：「发送前从左到右检查输入框底部的上下文、附件、**访问权限、模型**和语音入口」。
 * 权限在模型左边 —— 先决定「能做多出格的事」，再决定「谁来干」。
 * 顶栏因此只剩任务标题与右栏开关。
 */
export function ComposerEnd() {
  const navigate = useNavigate()

  return (
    <TooltipProvider>
      <ApprovalSwitch />
      <ModelPicker
        onOpenSettings={function () {
          // 模型菜单里的「添加模型 / 模型设置」都落到模型分组，而不是设置页首页
          void navigate('/agent/settings?section=model')
        }}
      />
    </TooltipProvider>
  )
}
