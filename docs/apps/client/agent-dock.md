# 磁贴内对话坞（agent dock）

磁贴里的 AI 都走**同一个坞**：右侧可折叠面板，点一次就开跑，不跳页、不预填输入框。
聊天页仍是「多会话 + 历史 + 侧栏」的完整面；坞是「当前这块内容旁的助手」。

## 为什么不用「跳聊天页 + 预填提示词」

| 旧做法 | 问题 |
| --- | --- |
| 弹层收一个字段 → 关掉 → 跳 `/agent/chat` → 用户再点发送 → 回磁贴处理产物 | 一次任务 6 步、跨窗两次，上下文还得重新找 |
| 对话框层层叠加（知识库 ≥3 层、自动化 3 层） | 每层只问一两件事，注意力被切碎 |

市场基线（Shape of AI 的 Inline Action / Verification、Copilot / Cursor / Notion / Google Docs）：
**预设动作就地一键、结果先建议后应用、开放式指令放侧栏**。坞把这三条并在一起。

## 结构

| 文件 | 职责 |
| --- | --- |
| `features/agent/dock/store.ts` | 打开状态、当前 scope、待执行动作（`toOpen(id)`）/ 待发一句话（`toAsk(text)`）、`resetKey` |
| `features/agent/dock/port.ts` | 复用共享模型端口，只替换「系统提示」与「收尾副作用」 |
| `features/agent/dock/runtime.tsx` | assistant-ui `useLocalRuntime` + 会话 id `dock:<scopeKey>`；一键动作把**短标签**放进输入框，组合提示词走 `findUserText` 覆盖 |
| `features/agent/dock/dock.tsx` | 容器（标题/动作条/Thread/应用/升级）、`DockApply`、`DockEscalate` |
| `features/agent/dock/handoff.ts` | 显式升级到完整会话（一次性交接，见下） |
| 各域 `*-scope.ts` | 注册动作：知识库 `views/knowledge/workspace/dock-scope.ts`、指令 `views/directive/ai-scope.ts` |

## 关键取舍

1. **会话不落库**：会话 id 是 `dock:<scopeKey>`，不写 `agent_session`，所以不会污染聊天侧栏；
   折叠只是变窄，运行时与消息都还在（不卸载）。重启即丢弃（跨重启恢复未做）。
2. **动作 = 一句话**：`buildPrompt()` 实时读上下文（当前文档/选区/指令 JSON），返回 `null` 表示
   当前不可用（按钮置灰）。组合提示词（带全文/选区/定义）**不进输入框**——用户看到的只有一句
   动作标签，真正发给模型的话由端口覆盖。
3. **先建议后应用**：结果永远留在对话里；`toWrite` 只在用户点「应用到文档」时执行
   （知识库 = 插入/替换选区；指令 = 替换编辑器草稿），都可撤销。
4. **不读全局场景**：聊天页的系统提示按 `findActiveScenario()` 选，坞用 scope 自己的 `systemText`；
   端口因此不写全局草稿/计划预览（`onFinish` 传空实现）。
5. **升级是显式的**：「完整会话」把这一轮的最后一句话通过 `chat-handoff` 单槽交给聊天页
   （新会话消费一次）。这是唯一还带「预填」的路径，且只由用户点出来。

## 加一个新的坞（其它磁贴）

```ts
useDockStore.getState().toBind({
  key: 'drawing',                 // 会话身份的一部分
  title: '画板助手',
  hint: '一句话说明这个坞能干什么',
  systemText: '只做画板相关的事……',
  toWrite: (text) => applyToCanvas(text),   // 可选：没有落点就不传
  actions: [{ id: 'summarize', label: '总结', buildPrompt: () => text || null }]
})
```

## 排查

| 现象 | 先看哪里 |
| --- | --- |
| 点了动作没反应 | `buildPrompt()` 返回了 `null`（上下文不全，按钮本该置灰） |
| 本轮回复没出现 | `findTarget()` 没拿到 provider/model（设置里没启用） |
| 审批点了没反应 | 审批回执走 `chatModelPort` 单例（`port/instance.ts`），坞只负责渲染工具卡 |
| 切磁贴后上下文串了 | scope 没在 `useEffect` 返回里 `toUnbind(key)` |
