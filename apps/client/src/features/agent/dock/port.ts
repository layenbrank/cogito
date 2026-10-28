/**
 * dock 的模型端口：复用聊天页那一条链路，只把「系统提示」和「收尾副作用」换成域自己的。
 *
 * 为什么不另写一套：`createModelPort` 已经把审批/追问/停止/错误/用量的翻译做完了，
 * 复制一份只会让两边行为慢慢跑偏。
 */
import type { ChatModelPort } from '@cogito/chat/ports'

import { createModelPort } from '@/features/agent/port/model'

import type { DockScope } from './types'

/**
 * 本轮要发的组合提示词：一键动作填一次、运行消费一次。
 * 可见消息只放一句短标签（动作名），真正带全文/选区/定义的提示词在这里交接。
 */
let runText: string | null = null

function setDockRunText(text: string): void {
  runText = text
}

function takeDockRunText(): string | null {
  const value = runText
  runText = null
  return value
}

function buildDockPort(scope: () => DockScope): ChatModelPort {
  return createModelPort({
    // 每轮现读：scope 的闭包会随磁贴状态（当前文档/选区）更新
    findSystemText: function () {
      return scope().systemText
    },
    // 一键动作：可见消息是短标签，真正发给模型的组合提示词在这里覆盖
    findUserText: function (_input, visibleText) {
      return takeDockRunText() ?? visibleText
    },
    // dock 不写全局草稿/计划预览：结果就留在对话里，等用户点消息上的按钮
    onFinish: function () {}
  })
}

export { buildDockPort, setDockRunText }
