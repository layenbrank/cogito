/**
 * 发起一轮生成前的「模型目标」前置检查：供应商还在、已启用、配额放行，
 * 以及平台网关的 provider 幂等注册。
 *
 * 聊天 / 内联改写 / 定时任务三条入口都要过这一关，所以放在这里共用一份，
 * 避免各写一遍后判断口径慢慢漂移。
 */
import { ensureCogitoProvider, isCogitoSoftFailure } from '@/features/agent/acp/cogito-provider'
import { findSendBlocker, isGatewayTarget } from '@/features/quota/gate'
import { useProviderStore } from '@/stores/provider'
import { reportCaught } from '@/utils/exception-report'

/**
 * 校验并准备目标；抛错信息直接给用户看。
 *
 * `tag` 只用于异常上报的归类（如 `agent.inline` / `agent.automation`）。
 */
async function prepareTarget(providerID: string, modelID: string, tag: string): Promise<void> {
  const provider = useProviderStore
    .getState()
    .providers.find(function (item) {
      return item.id === providerID
    })
  if (!provider) throw new Error('选中的模型供应商已不存在，请到设置里重新选择')
  if (!provider.enabled) throw new Error('选中的模型供应商已停用，请到设置里启用')

  const isGateway = isGatewayTarget(provider.kind)
  const blocker = await findSendBlocker({ isGateway, modelID })
  if (blocker) throw new Error(blocker)
  if (!isGateway) return
  // 平台网关走 goose 的自定义 provider：发送前幂等注册，失败就别发（否则报错更难懂）
  try {
    await ensureCogitoProvider()
  } catch (error) {
    if (!isCogitoSoftFailure(error)) throw error
    reportCaught(`${tag}.ensureCogitoProvider`, error, 'warning')
  }
}

export { prepareTarget }
