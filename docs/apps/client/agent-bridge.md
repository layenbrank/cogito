# 本机 Agent 代理（`/api/v1/agent/*`）

浏览器扩展经本机 client 驱动 agentd 的会话面。代码：`apps/client/src-tauri/src/bridge/agent.rs`，
挂在与剪藏同一个 `127.0.0.1:19828` 服务上（隔离 dev 实例是 19829）。

## 为什么是代理

agentd 的 Bearer 令牌能拿到**带写文件、执行命令能力**的 agent。渲染进程拿到它已经是权宜；
再交给扩展就等于把这份凭据塞进另一套进程模型，任何能读到扩展 storage 的东西都能直接驱动 agent。

代理让 agentd 令牌只活在 Rust 进程：扩展带的是**本机 API 令牌**（用户在设置里显式生成），
Rust 再换成 agentd 令牌转发。

## 路由

只有**一条通配路由** `/api/v1/agent/{*path}`，路径去掉前缀后原样转给 agentd。

- 只在 Rust 里逐条复写一遍，等于给协议加第三份真源（前端已有 `AGENTD_ROUTES`）
- 单入口也避开了「静态段 + 通配共存」的配置风险：配错就是整个 19828 起不来，而这条端口还背着剪藏
- `status` 在 handler 内按路径分派，是唯一免令牌端点

## 三道闸

| 闸 | 行为 | 理由 |
| --- | --- | --- |
| `agentEnabled` | 默认 **false**，未开 → 503 | 装完客户端就有一个无鉴权的执行入口不可接受 |
| 令牌 | **永远需要**，未配置令牌 = 拒绝 | 不复用 Wiki API 的 `allow_unauthenticated`；agent 面能写文件 |
| `allowLanAccess` | true → 403 | 只读 API 的便利不该顺带把整机执行权交给同网段 |

`GET /api/v1/agent/status` 免令牌，只回开关 / 是否配置令牌 / 令牌是否被接受 / agentd 是否就绪，
让扩展能分辨四种失败（没装客户端、没开开关、没配令牌、令牌不对）并给出各自的处理动作。

## SSE

`GET .../threads/:id/events` 必须逐帧到浏览器：整包缓冲会让界面在整轮结束前一个字都不出。
实现是 `futures_util::stream::unfold` 驱动 `reqwest::Response::chunk()`，直接喂 `Body::from_stream`，
并带上 `x-accel-buffering: no`。

本机回环请求的 reqwest client 必须 `no_proxy()` —— 它会读 Windows 系统代理，走代理时本机请求回 502。

## 启用

桌面端 设置 → 知识库 → **API / Clip 守护**：

1. 点「生成」得到令牌（24 字节随机 hex）
2. 打开「Agent 代理」（未配令牌时禁用）
3. 把令牌填进扩展设置

Rust 侧开关是**进程内**状态，`apps/client/src/main.tsx` 启动时调 `bootstrapWikiApiConfig()`
把已保存的配置推回去 —— 不推就会「设置页显示开着，重启后扩展连不上」。
