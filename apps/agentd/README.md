# @cogito/agentd

桌面端 agent 循环宿主。由 Tauri 以 **sidecar** 拉起（`utils/agentd.rs`），自己再以
**stdio ACP** 拉起 goose。前端只跟它说 HTTP/SSE。

```
WebView ──HTTP/SSE──> agentd（Node SEA 单文件）
                        ├─ LangGraph 编排图（goose → END）
                        ├─ node:sqlite checkpointer（跨重启续跑）
                        └─ spawn `goose acp`（stdio NDJSON）──> gateway
```

为什么不是 Rust 里直接跑循环：见 [ADR `agent-orchestration-langgraph.md`](../../docs/decisions/agent-orchestration-langgraph.md)。

## 环境契约（全部由 Tauri 注入）

| 变量 | 必填 | 说明 |
| `AGENTD_TOKEN` | ✅ | Bearer 令牌，≥16 字符；缺失/过短**直接退出**（fail-closed） |
| `AGENTD_DB` | ✅ | `agentd.db` 绝对路径（`<appLocalData>/agentd/agentd.db`） |
| `AGENTD_PORT` | | 默认 `0` = 内核分配；实际端口经 stdout 握手行回报 |
| `AGENTD_GOOSE_PATH_ROOT` | | goose 的 config/data/state 根（`<appData>/goose`）；不配则不托管 goose |
| `AGENTD_GOOSE_BINARY` | | goose 可执行文件；空则用 `PATH` 里的 `goose` |
| `AGENTD_VERSION` | | 写进 `/health`，与宿主版本对齐 |
| `AGENTD_ISOLATED` | | `1` 表示双实例隔离的 dev 实例 |

## 握手行

启动成功后往 **stdout** 打一行，Tauri 只认这个端口来源（预探空闲端口有 TOCTOU）：

```
AGENTD_READY {"port":52544,"pid":2892,"version":"1.5.0","service":"cogito-agentd","isolated":false,"goose":"ready"}
```

## 端点

| 方法 | 路径 | 说明 |
| `GET` | `/health` | **免鉴权**；`{service,version,uptimeMs,pid,graphs,goose,restarts}` |
| `POST` | `/threads` | 建 thread |
| `GET` | `/threads/:id` · `/threads/:id/state` | 线程与图状态（需要 checkpointer） |
| `POST` | `/threads/:id/runs/stream` | SSE：`metadata`/`values`/`updates`/`error`/`end`；`command.resume` 用 `new Command()` 包装 |
| `GET` | `/goose/providers` · `/goose/extensions` · `/goose/diagnostics` · `/goose/defaults` · `/goose/sessions` | goose 查询面透传（未托管 → 503） |
| `POST` | `/goose/sessions` · `/goose/sessions/:id/config` · `/goose/sessions/:id/cancel` | 建会话 / 改配置 / 取消 |
| `POST` | `/admin/shutdown` | 202 后异步退出（Tauri 退出时用） |
| `POST` | `/admin/goose/restart` | 只重启内层 goose |

`/health` 之外的端点一律要 `Authorization: Bearer $AGENTD_TOKEN`。

## 开发与构建

```bash
pnpm --filter @cogito/agentd build        # rolldown → dist/main.cjs（CJS）
pnpm --filter @cogito/agentd unit         # vitest
pnpm --filter @cogito/agentd build:sea    # 打单文件 SEA → apps/client/src-tauri/binaries/
```

`@cogito/client` 的 `build` / `dev` 已前置 `build:agentd`，正常不用手动跑。
调试时也可以让 Tauri 直接跑源码：`AGENTD_ENTRY=<绝对路径>/dist/main.cjs`（`node` 直跑）。

## 四个必须记住的坑（都实测过）

1. **SEA 只按 CJS 执行入口**：ESM 入口注入后报 `Cannot use import statement outside a module`。
2. **`useCodeCache` 必须 `false`**，否则 `--experimental-sea-config` 报 `Cannot generate V8 code cache`。
3. **`process.isSea` 在 Node 24.18 是 `undefined`**，判 SEA 要用构建期常量。
4. **不要在 SEA 里 `spawn(process.execPath)`**：那会自我递归（曾一次炸出 51 个进程）。
