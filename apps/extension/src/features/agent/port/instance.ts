/**
 * 端口的进程内单例。
 *
 * 为什么要单例：审批票据与事件流游标是**跨组件**的状态 —— 工具卡在消息树里、
 * 运行在 runtime 里、历史在列表里。每次渲染新建一个端口对象，票据就各存一份，
 * 用户点「允许」时找到的是另一份（表现为「点了审批没反应」）。
 */

import type { ChatHistoryPort, ChatModelPort } from '@cogito/chat/ports'

import { buildCloudModelPort } from './cloud.ts'
import { buildDexieHistoryPort } from './history.ts'
import { buildBridgeModelPort } from './model.ts'
import { buildRoutedModelPort } from './router.ts'

const historyPort: ChatHistoryPort = buildDexieHistoryPort()
/** 双路：桥（全能力）优先，不可用时降级云端（仅对话）——见 `router.ts` */
const chatModelPort: ChatModelPort = buildRoutedModelPort(
  buildBridgeModelPort(),
  buildCloudModelPort()
)

/**
 * 运行要带上的宿主信息。
 *
 * 扩展没有工作区概念，只交会话 id —— 与 client 的 `findHostOptions(target, threadID)` 同形，
 * 少一个 workspace 字段。
 */
function findHostOptions(threadID: string): Record<string, unknown> {
  return { threadID }
}

export { chatModelPort, findHostOptions, historyPort }
