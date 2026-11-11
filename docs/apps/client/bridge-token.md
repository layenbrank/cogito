# 桥令牌（bridge token）：为什么落盘、怎么用

- 关联：[安全边界 ADR](../../decisions/security-boundary.md)（边界二）、`apps/client/src-tauri/src/bridge/{http,token,command}.rs`、`apps/client/src-tauri/crates/mcp/src/main.rs`
- 状态：S2 已落地（2026-11-10）

## 它是什么

`cogito-mcp` 是独立进程，它不能直接开 `cogito-client.db`，只能调 app 内的 loopback 桥
（`http://127.0.0.1:<随机端口>`，头 `x-bridge-token`）。这个桥之上挂着**全部**本地工具，
包括 `app_terminal_run`（在用户右栏终端里执行任意命令）、`app_browser_act`、知识库写入。
所以桥令牌等价于「以用户身份操作这台机器」，比 goose serve 令牌（只能驱动一个 agent 会话）更敏感。

## 为什么不再交给渲染进程

旧链路是：Rust 生成 token → `bridge:info` 回 `{url, token}` → 渲染进程塞进 MCP 的
`env.COGITO_BRIDGE_TOKEN`。任何能读前端内存、日志、或注入脚本的东西，都直接拿到执行任意命令的能力。

现在：

```
Rust: uuid v4 → 原子写 <appLocalData>/bridge/token（仅当前用户可读）
      ↓ bridge:info 只回 { url, tokenFile, sessionHeader, mcpPath }
前端: 把 COGITO_BRIDGE_TOKEN_FILE / COGITO_SESSION_ID / COGITO_SESSION_HEADER 注入 MCP env
      ↓
cogito-mcp: 每个请求前读文件取 token（文件消失/为空则报可读错误）
      ↓ x-bridge-token + x-cogito-session
桥: authorize() = Host 回环 + 等长令牌比较 + 会话已在 SessionRegistry 登记
```

## 文件与权限

| 平台 | 路径 | 权限 |
| --- | --- | --- |
| Windows | `%LOCALAPPDATA%\com.cogito.client\bridge\token`（dev 实例在 `com.cogito.client.dev`） | DACL 只留当前用户一条 ACE，且 `SE_DACL_PROTECTED`（不继承父目录） |
| macOS / Linux | `<appLocalData>/bridge/token` | `0600` |

写盘顺序：临时文件 → 收紧权限 → `rename` 覆盖。`rename` 之后 MCP 只会读到完整内容；
令牌随后每次启动轮换（桥随 app 进程一起重建）。

自查：

```powershell
$token = "$env:LOCALAPPDATA\com.cogito.client\bridge\token"
Get-Item $token | Select-Object FullName, Length, LastWriteTime
icacls $token
```

期望：`icacls` 里只有当前用户一条 `(F)`，没有 `BUILTIN\Users` / `Everyone`。

## 会话绑定

- `bridge:info` 调用时带 `sessionID`（前端传 `goose-acp:<thread>`），桥把它记进
  `SessionRegistry`（最多 64 个，超出挤掉最早的）。
- `cogito-mcp` 每个请求带 `x-cogito-session`（头名可由 `COGITO_SESSION_HEADER` 覆盖）。
- `authorize()`：缺会话头 → 401「缺少会话标识」；登记集合非空但会话不在其中 → 401「会话未登记」。
- 目的不是身份认证（令牌仍是唯一凭据），而是**范围收窄**：令牌若从日志/环境泄漏，
  攻击者还需要一个正在运行的会话标识才能调用工具。

## 兼容与回退

- `COGITO_BRIDGE_TOKEN`（明文 env）仍被 `cogito-mcp` 支持，用于旧版 app / 手写配置；
  新链路优先 `COGITO_BRIDGE_TOKEN_FILE`。
- 令牌文件读不到时，MCP 不退出：退化成只提供 `app_ping`，并在 MCP instructions 里写明
  「本地工具面未连接（缺少 …）」，用户能在工具面板直接看到原因。
- 排查顺序：① 看文件是否存在；② 看 app 日志有没有「桥令牌落盘失败」；③ 看 MCP 的
  `tools/list` 是否只剩 `app_ping`。

## 还没收完的

- **serve 令牌**：`goose:connection` 仍返回带 `?token=` 的 `wss://127.0.0.1:<port>/acp`，
  渲染进程需要用整条 url 去连 ACP。要把它也移出进程，必须先有 Rust 侧 ACP 客户端（计划 S9-B），
  本轮只去掉了 `GooseConnection.token` 这个单独的明文字段。
- **渲染进程仍能读令牌文件**：`plugin-fs` 引用面还有 45 个文件、`fs:scope` 含 `$APPLOCALDATA/**`，
  拿到渲染进程的代码理论上能读到 `bridge/token`。这是「1A 收口」要继续清的账（门禁只许缩小基线）；
  在那之前，令牌的收益是「不主动流经前端、不进 MCP env 日志」，而不是「前端绝对拿不到」。
- 门禁第 6 组断言只保证 `apps/client/src` 里**不出现** `COGITO_BRIDGE_TOKEN`（防止有人手滑写回去），
  它不证明令牌链路安全。
