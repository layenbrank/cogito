import { GATEWAY_PROVIDER_KIND, supportsTools } from '@cogito/agent/provider'
import type { ChatTarget } from '@cogito/chat/ports'

import { findActiveTenantID } from '@/features/quota/tenant.ts'
import { useAgentStore } from '@/stores/agent.ts'
import { findAuthToken } from '@/utils/auth.ts'

import { isPlatformTarget } from '@/features/chat/platform.ts'
import {
  createModelPort,
  findTargetModel,
  findTargetProvider,
  type ModelSelection
} from './model.ts'

/**
 * 模型端口的**单例**。
 *
 * 放模块作用域而不是组件里：runtime 与工具卡（审批按钮）是两个组件树分支，
 * 审批回执要回到「发起这次审批的那次运行」，各自 new 一份就回不去了（端口里按
 * 工具调用 id 记着回执该投给谁）。
 */

export function findModelSelection(): ModelSelection {
  const { chat } = useAgentStore.getState().settings
  return { providerID: chat.providerID, model: chat.model }
}

/**
 * 选择过期时把**解析出来的有效选择**写回设置（行被删、模型下架，见 `port/model.ts`）。
 *
 * 必须落库：设置是界面与运行共同的源。只在内存里绕过去的话，模型菜单会一直显示那个已经
 * 没了的模型，而实际跑在别的模型上。
 */
function repairModelSelection(selection: ModelSelection): Promise<void> {
  return useAgentStore.getState().update('chat', selection)
}

/**
 * 每次运行现读的宿主扩展：模型能力 / 审批策略 / 沙箱工作区 / 会话 / 平台凭据。
 *
 * 两个「按运行时状态分派」的点都在这里，且都读 `port/model.ts` 按**运行目标**记下的条目
 * —— 键控而非「当前选中的模型」：两个会话并发跑时，「当前」会把先跑的那个读串。
 * - 模型不支持工具调用（显式声明过 `tools: false`）→ 报 `supportsTools: false`，
 *   引擎据此走聊天档（一个工具都不给）；
 * - 平台网关 → 带上登录令牌，主进程拿它当 apiKey（BYOK 的密钥不出主进程）。
 *
 * 那条缓存只用来读「能力」与「租户归属」这类**声明**，判**凭据**时它只是加速：
 * 平台行有固定 id，缓存没命中（热更、新模块图）也认得出，令牌照带。让缓存参与凭据判定的话，
 * 缓存没命中就会静默丢令牌 —— 用户明明登录着，却被告知「登录已过期」。
 *
 * `sessionID` 由调用方按**本线程**给出（runtime hook 是每个线程一份，后台线程收尾时
 * 问「当前会话」拿到的是别人）。这里只报**事实**，不报结论：档位该给哪些工具、该问哪些
 * 审批，全由主进程的 `opencode/permission.ts` 按同一张表裁。
 */
export function findHostOptions(target: ChatTarget, sessionID: string): Record<string, unknown> {
  // 没有会话 id 的运行是**有害的成功**：用量账本记到 null（花了 token 看不到）、
  // 历史写入撞外键被 assistant-ui 吞掉。而且这个空值在 MessagePort 的结构化克隆里会被
  // 直接丢掉，主进程只能看到 null，事后无法追查。宁可当场失败。
  if (!sessionID) throw new Error('[CHAT] 会话身份未就绪，已拒绝发起运行')

  const { chat, workspace } = useAgentStore.getState().settings
  const provider = findTargetProvider(target)
  const model = findTargetModel(target)
  const isPlatform = provider?.kind === GATEWAY_PROVIDER_KIND || isPlatformTarget(target)
  const platformToken = isPlatform ? findAuthToken() : null
  // 租户 id 由 `port/model.ts` 的 `findTarget()` 现查并缓存（那是这条链路上唯一的异步点）
  const tenantID = isPlatform ? findActiveTenantID() : null

  return {
    // 没有能力清单时按「支持工具」处理：模型行往往是手填的，宁可多给工具也别静默降级
    supportsTools: model ? supportsTools(model) : true,
    approval: chat.approval,
    workspaceID: workspace.activeWorkspaceID,
    sessionID,
    ...(platformToken ? { platformToken } : {}),
    ...(tenantID ? { tenantID } : {})
  }
}

export const chatModelPort = createModelPort(findModelSelection, repairModelSelection)
