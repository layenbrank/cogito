# @cogito/agent-runtime

agentd 协议客户端（**环境无关**）：传输、SSE 事件流、审批回执、ACP 事件映射与审批判定。

被 `apps/client` 与 `apps/extension` 共用。这不是「工具库」，而是**唯一实现**：
两端各写一份「`sync` 帧怎么处理」「只读档该不该拦写工具」，必然有一端写错，而错了的表
现是「界面卡在思考中」「工具在你没同意时执行」这类最难查的问题。

## 子路径

| 导入 | 内容 |
| --- | --- |
| `@cogito/agent-runtime/agentd` | `createAgentdTransport({ findEndpoint })`：Bearer、401 失效、`invokeGoose` |
| `@cogito/agent-runtime/agentd/sse` | `readSse(response, signal)`：按空行切帧 |
| `@cogito/agent-runtime/agentd/runs` | `AGENTD_ROUTES`、`parseRunFrame`、`createRunCursor` |
| `@cogito/agent-runtime/agentd/approvals` | `postApproval` / `postElicitation` / `createApprovalLedger` |
| `@cogito/agent-runtime/acp` | `parseAcpStreamEvent` / `parseAcpApprovalRequest` / `parseAcpElicitation*` / `parseAcpPermissionOutcome` |
| `@cogito/agent-runtime/policy` | `decideApproval`：工具该不该问用户（唯一安全闸门） |

## 硬约束

- 只依赖 React 之外的纯运行时：不得引入 `node:*`、`@tauri-apps/*`、`chrome.*`、Electron。
- **不持状态**：会话表、游标缓存、重试策略都留在宿主 app；本包只给协议原语与纯函数。
- 所有 catch 都要留痕（`console.*` 带 `[agent-runtime/…]` 前缀），不静默吞错。

## 两个宿主怎么接

```ts
// apps/client：地址来自 Tauri 命令
const transport = createAgentdTransport({
  findEndpoint: () => invoke<AgentdEndpoint>(CHANNELS.AGENTD.ENDPOINT)
})

// apps/extension：地址来自本机 client 的桥（令牌由客户端代持，扩展拿不到 agentd 令牌）
const transport = createAgentdTransport({
  findEndpoint: () => fetchBridgeEndpoint()
})
```

地址之外的一切（路径、帧信封、游标规则、审批派生）两端完全一致 —— 这就是这个包存在的理由。

## 测试

```powershell
pnpm --filter @cogito/agent-runtime unit
```
