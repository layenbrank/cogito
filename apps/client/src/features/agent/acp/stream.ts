/**
 * ACP → 共享 chat 事件的映射：**实现已上提到 `@cogito/agent-runtime/acp`**。
 *
 * 保留这个转发文件而不是改二十处 import：映射表从「client 的私货」变成了两端共用的
 * 协议层（浏览器扩展消费的是同一条 agentd 事件流），转发一层能让这次搬家对视图层完全透明，
 * 且只有一个真源。
 */
export * from '@cogito/agent-runtime/acp'
