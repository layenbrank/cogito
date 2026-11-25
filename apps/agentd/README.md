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
| `AGENTD_ALLOWED_ROOTS` | | run 的 `cwd` 允许根（`path.delimiter` 分隔）；不配则只校验「绝对且存在」。**默认不配**：client 不注入工作区根表（渲染进程持有 token，静态表换不来安全边界，且会误拒 home / 运行期新增工作区），真正的 cwd 约束在 R5 的沙箱 / Rust 侧代理做；这里是给受控部署的收紧开关 |
| `AGENTD_MCP_ALLOWED_COMMANDS` | | MCP command 白名单（`path.delimiter` 分隔）；非空时优先生效 |
| `AGENTD_MCP_ALLOW_BARE_COMMAND` | | `1` 允许裸命令（默认要求绝对路径） |
| `AGENTD_MCP_ALLOW_ARBITRARY` | | `1` 允许任意绝对路径 MCP（默认只认 `corex-mcp` / `cogito-mcp`） |

## 握手行

启动成功后往 **stdout** 打一行，Tauri 只认这个端口来源（预探空闲端口有 TOCTOU）：

```
AGENTD_READY {"port":52544,"pid":2892,"version":"1.5.0","service":"cogito-agentd","isolated":false,"goose":"ready"}
```

## 端点

**线程与运行**（前端正式路径：先订阅 `/events`，再 `POST /runs`）

| 方法 | 路径 | 说明 |
| `POST` | `/threads` | 建 thread（幂等：`thread_id` 就是客户端会话 id） |
| `GET` | `/threads/:id` · `/threads/:id/state` | 线程元数据 / 图状态（`values` + `next`，需要 checkpointer） |
| `GET` | `/threads/:id/events?after=<seq>&epoch=<epoch>` | **SSE 事件流**：`event: sync`（`{epoch,lastSeq,minSeq,truncated,reset,approvals,elicitations}`）+ 若干 `event: run`（`{epoch,seq,kind,payload}`） |
| `POST` | `/threads/:id/runs` | 起一轮，**202 立即返回**；过程与终态全部走 `/events`。同 thread 的另一个客户端在跑 → **409 `writer_lease_held`**（带 `holder`），需显式 `{"takeover":true}` 才能接管 |
| `POST` | `/threads/:id/runs/stream` | 旧路径：SSE `metadata`/`values`/`updates`/`error`/`end`；客户端断开即中止本轮并取消 goose |
| `POST` | `/threads/:id/cancel` | 取消当前轮（先 ACP `session/cancel` 收住长工具，再 abort 图）；无活跃轮返回 200 `no_active_run` |
| `POST` | `/threads/:id/replay` | **补历史**：`session/load` 把 goose 会话历史重放成一批 `event: run` 的 `kind:'replay'`（形状同 `update`，但客户端要按 `messageId` **替换**正文）。仅在该 thread 无活跃轮时可用（否则 **409 `run_active`**）；无会话 → 200 `{replayed:0,reason:'no_session'}`；失败 502 `replay_failed`（旁路，客户端降级为诊断） |
| `GET` | `/threads/:id/approvals` · `/threads/:id/elicitations` | 待处理票据快照（`/events` 的 `sync` 帧同样带） |
| `POST` | `/threads/:id/approvals/:requestId` | 审批回执：`{optionId}` 或 `{cancelled:true}`；票据必须属于该 thread |
| `POST` | `/threads/:id/elicitations/:requestId` | 追问回执：`{action:'accept'\|'decline'\|'cancel', content?}` |

**goose 面**

| 方法 | 路径 | 说明 |
| `GET` | `/goose/providers` · `/goose/extensions` · `/goose/diagnostics` · `/goose/defaults` · `/goose/sessions` | 查询面透传（未托管 → 503） |
| `POST` | `/goose/sessions` | 建会话（`cwd` + `mcpServers` 走同一套校验） |
| `POST` | `/goose/sessions/:id/config` · `/goose/sessions/:id/mode` · `/goose/sessions/:id/cancel` | 改配置（`configId` 白名单：`mode` / `thinking_effort`）/ 切档 / 取消 |
| `POST` | `/goose/invoke` | 白名单透传（`_goose/unstable/*` 的少数方法）；`session/prompt`、`session/new`、`permissions/set` **不在**表里 |

**运维**

| 方法 | 路径 | 说明 |
| `GET` | `/health` | **免鉴权**；`{service,version,uptimeMs,pid,graphs,goose,restarts}` |
| `GET` | `/metrics` | 计数器快照 `{counters,lastAt,uptimeMs}`（`runs.*` / `approvals.*` / `events.*` / `tools.*`） |
| `POST` | `/admin/shutdown` | 202 后异步退出（Tauri 退出时用） |
| `POST` | `/admin/goose/restart` | 只重启内层 goose |

`/health` 之外的端点一律要 `Authorization: Bearer $AGENTD_TOKEN`。

**写者租约**：客户端可以带 `x-cogito-client: <id>` 标识自己。同 thread 已有别人的活跃轮时，
`/runs` 与 `/runs/stream` 一律 409 `writer_lease_held`（带 `holder.{clientID,runID,revision}`，
`runs.lease_conflicts` 计数）；自己的旧轮仍可 supersede。持有者超过 `RUN_LEASE_STALE_MS`（10 分钟）
未收尾视为已死，后续请求可直接接管 —— 避免一个崩掉的窗口把会话永久锁死。不带该头的旧客户端保持旧行为。

## 开发与构建

```bash
pnpm --filter @cogito/agentd build        # rolldown → dist/main.cjs（CJS）
pnpm --filter @cogito/agentd unit         # vitest
pnpm --filter @cogito/agentd build:sea    # 打单文件 SEA → apps/client/src-tauri/binaries/
```

`@cogito/client` 的 `build` / `dev` 已前置 `build:agentd`，正常不用手动跑。
调试时也可以让 Tauri 直接跑源码：`AGENTD_ENTRY=<绝对路径>/dist/main.cjs`（`node` 直跑）。

## 库与迁移：开发期不升表版本，直接 `migrate:fresh`

agentd 自有库（`agentd.db`）只放**续跑所需**的东西：`thread_identity`（线程 ↔ ACP 会话）、
`run_events`（事件日志）、`gate_requests`（审批/追问票据）、`lg_checkpoints` / `lg_writes`（LangGraph 快照）。
客户端的 SQLite 同理。**两者都不为「新增表 / 新增列」写升级版本**：这些数据要么是缓存、要么能重建，
写兼容升级只会留下「旧列还在、新列没写」的半吊子状态。

改表结构时直接重置：

```powershell
pnpm --filter @cogito/agentd migrate:fresh            # 正式包那份（%LOCALAPPDATA%\com.cogito.client\agentd\agentd.db）
pnpm --filter @cogito/agentd migrate:fresh -- --id com.cogito.client.dev   # dev 实例（连着 pnpm dev:client 跑时用这份）
pnpm --filter @cogito/agentd migrate:fresh -- --db D:\tmp\agentd.db        # 指定库
pnpm --filter @cogito/agentd migrate:fresh -- --dry-run                    # 只看会删哪个
```

路径优先级 `--db` > `AGENTD_DB` > `<appLocalData>/<identifier>/agentd/agentd.db`；删掉
`agentd.db` / `-wal` / `-shm` 后立刻按 `MIGRATIONS` 重建，并打印迁移版本与表清单。

打包用户没有 `pnpm`，所以**启动自愈**也在这条链上：`openDb` 打开后核对「建库脚本承诺的表 / 索引」
是否都在（对象名直接从 `MIGRATIONS` 的 SQL 里解析，不手抄第二份清单），缺了就关闭、把
`agentd.db` / `-wal` / `-shm` 一起改名成 `agentd.db.stale-<时间戳>` 留档，再按当前脚本重建，日志一行：

```
[agentd] 库与建库脚本不一致（缺 gate_requests），已隔离为 ...\agentd.db.stale-1795485933353 并重建
```

这条自愈是必须的：`_migrations` 里记着 version 1 时，改过的 v1 脚本会被**整份跳过**，
否则旧库会一直缺新表，表现成 `AGENTD_FATAL ... no such table: gate_requests` → agentd 在就绪前退出 →
客户端只看到「agentd 启动失败」。

**agentd 正在跑时文件被占用**（Windows 直接拒绝删除），脚本会明确提示先关应用 —— 不要用
「删了再重试」绕过，那个进程手里的连接仍会写回旧库。

## 真机探针

```bash
# 先起一个 agentd（见上），然后：
AGENTD_BASE=http://127.0.0.1:<port> AGENTD_TOKEN=<token> node scripts/probe-run.ts \
  --prompt "Reply with exactly: hello"

# 触发并自动放行工具审批（会真的执行工具）
node scripts/probe-run.ts --approve --mode smart_approve \
  --prompt "Create a file /tmp/probe.txt containing ok"
```

会话层最难的是时序（prompt 挂起 → 审批 → 继续），单测盖不住「串起来对不对」，这个脚本用真 goose + 真模型跑一遍。

另有一个**不经过 agentd** 的 ACP 探针，用来验证 goose 自身的能力边界（`session/load` 重放）：

```powershell
# 指向一份可用的 goose 配置根（app 用的那份即可），会真跑一轮模型
$env:GOOSE_PATH_ROOT="$env:APPDATA\com.cogito.client\goose"
node --experimental-strip-types scripts/probe-replay.ts          # 纯文本一轮
node --experimental-strip-types scripts/probe-replay.ts --tools  # 额外验证工具调用/结果是否重放
```

它回答的是「事件日志缺段后能不能靠重放重建」：`messageId` 是否稳定、工具结果是否重放、重放粒度
（实测是**按消息聚合**，所以客户端要 `replace` 而不是 append）。结论与实现方案见
`docs/decisions/agent-r5-hardening.md` D3。

## 三个额外的坑（真机才暴露）

1. **`permission.yaml` 的 `user` 段能吞掉所有审批**：`always_allow` 里的工具直接放行、`never_allow` 里的直接拒绝，
   两者都**不发** `request_permission`。排查「审批不弹」先看这个文件，别怀疑 ACP。
   要复现审批链，用不含 `permission.yaml` 的干净 `GOOSE_PATH_ROOT`。
2. **切档用 `session/set_config_option(configId:'mode')`**，不是 `session/set_mode` ——
   后者 goose 宽容返回 `{}` 但**不改状态**（最坑的一种失败：看着成功、行为没变）。
3. **JSON-RPC `id` 允许 string**：只认 number 会把带 string id 的反向请求当通知丢掉，
   表现同样是「审批没发生」。

## 四个必须记住的坑（都实测过）
1. **SEA 只按 CJS 执行入口**：ESM 入口注入后报 `Cannot use import statement outside a module`。
2. **`useCodeCache` 必须 `false`**，否则 `--experimental-sea-config` 报 `Cannot generate V8 code cache`。
3. **`process.isSea` 在 Node 24.18 是 `undefined`**，判 SEA 要用构建期常量。
4. **不要在 SEA 里 `spawn(process.execPath)`**：那会自我递归（曾一次炸出 51 个进程）。
