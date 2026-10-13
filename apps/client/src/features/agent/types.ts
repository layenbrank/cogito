/**
 * Agent 领域类型。
 *
 * 旧 composer 时代的消息部件（File/Compare/Plan/Diff/Tool）与 OpenAI/Ollama 直连协议
 * 类型已随死代码一并删除：模型接入统一走 goose（ACP），消息展示走 assistant-ui 的部件系统，
 * 这里只剩场景这一份跨模块共用的词汇。
 */

/** 输入区的场景模式：决定 prompt 包装与产出部件解析 */
type Scenario = 'compare' | 'plan' | 'code'

export type { Scenario }

