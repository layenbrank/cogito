## UI 约定

仓库已完成 antd → shadcn/ui + Tailwind v4 迁移（studio / extension / client 不再有 antd 代码）：

- 组件：`@cogito/design/{components,assistant}/*`（shadcn `new-york` + base-ui base + lucide 图标）；目录名即子路径，`hooks/*`、`globals.css` 各自独立
- 设计 token 唯一源：`packages/design/src/styles/globals.css`；app 侧 `@source` 声明自己的源码
- 新增组件走 registry：`pnpm --filter @cogito/design registry:add <items>`
- chat 相关走 assistant-ui（`packages/chat` 提供端口契约与适配器）
- 窗口装饰自绘：窗口一律 `decorations: false`，桌面壳走 `features/window-shell`（`ShellFrame` / `Caption` / `useShellSurface`；见 [client 组件文档](./docs/apps/client/components-api.md)）
- 前端持久化：非密偏好走 Tauri Store（`features/persist`），密钥走 OS Keyring，领域实体仍 SQLite；见 [persist 分层](./docs/apps/client/persist.md)

## 命名

- 缩略语在标识符里**全大写**：`SSEFrame` / `readSSE` / `SSEConnections`、`MCPServers`、`sessionID` /
  `threadID` / `clientID` / `runID` / `requestID` / `toolCallID`（不要写 `SseFrame` / `mcpServers` / `sessionId`）
- 把外部或原始输入**转换**成内部类型/语义的函数用 `toReadXxx`：`toReadThreadID(req)`、`toReadReplayConfig()`、
  `toReadChunk(chunk)`；只读已有状态、不做转换的仍用 `readXxx`：`readSessionID()`、`readThreadStatus()`
- **例外（不许改）**：线格式字段名沿用外部拼写 —— ACP 的 `sessionId` / `mcpServers`、HTTP 的 `thread_id`、
  Rust 命令参数 `acpSessionId`。改名只作用于本地标识符，不作用于 JSON 键与协议参数

## Agent 临时文件

调试脚本、构建日志、验证输出这类**会话级缓存**一律写到 agent 缓存目录，不要在仓库根目录下建
`tmp/` 之类的目录。落点不是约定而是代码（`apps/client/src-tauri/src/utils/agent_cache.rs`）：

- 根目录：`%LOCALAPPDATA%\cogito\agent-cache`（早期文档写的 `~/.cogito/agent-cache` 仍可读，取不到 `LOCALAPPDATA` 才回退它）
- 会话子目录：`<root>\<session>`，session 由终端会话 id 派生（cwd 里非 `[A-Za-z0-9._-]` 的字符换成 `-`）
- 终端已注入环境变量：`$env:COGITO_AGENT_CACHE` / `$env:TMP` / `$env:TEMP` 都指向当前会话目录，
  所以 `Out-File $env:TEMP\x.log`、`mktemp`、Node 的 `os.tmpdir()` 自动落在那里 —— 别写到工作区
- 保留 7 天（启动时清超期会话目录），会话被 kill 时清当前会话目录；设置 → 诊断有
  「Agent 缓存 · N MB / 清空」，只清缓存根，不动 `.cogito/plans` 与日志
- 仓库根不许出现草稿：`pnpm check:agent-junk` 拦 `tmp/`、`scratch-*`、`*.log`、`*.bat`、`*.ps1`
- 需要按任务区分时在会话目录下再建子目录；用完即删，该目录不受版本管理

## 数据库迁移：不升表版本，直接重置

agentd 自有库与 client SQLite 都**不为「新增表 / 新增列」写升级迁移**：里面的东西要么是缓存
（事件日志）、要么能重建（checkpoint / 票据 / 会话绑定），写兼容升级只会留下「旧列还在、新列没写」的半吊子状态。

- agentd：只改 `apps/agentd/src/db.ts` 里那一版建库脚本（`MIGRATIONS` 只有 `version: 1`），
  然后 `pnpm --filter @cogito/agentd migrate:fresh`（`-- --id com.cogito.client.dev` 针对 dev 实例，
  `-- --dry-run` 先看会删哪个库，`-- --db <路径>` 指定库）
- agentd **启动自愈**：`openDb` 打开后会核对建库脚本承诺的表 / 索引（名字从 SQL 里解析），缺了就把
  `agentd.db`(+`-wal`/`-shm`) 改名成 `agentd.db.stale-<时间戳>` 留档并整份重建。改完 v1 脚本不用再让
  别人手工删库；打包版旧库也会自动重置，不会表现成「agentd 启动失败 / no such table」
- client：沿用 `column_patches()` 的「基线不动 + 幂等补列」，同样不新增迁移版本

## 本地调试：正式包与 dev 同时跑

装了打包版之后，裸 `pnpm dev` 会被单实例锁踢掉或和正式包抢同一份数据目录（SQLite /
WebView2 / corex 管道）。两个一起跑用：

```powershell
pnpm dev:client:isolated
```

dev 侧 identifier 变成 `com.cogito.client.dev`：数据目录、goose、WebView2 profile、
corex 管道（`\\.\pipe\corex-dev`）、剪藏端口（`19829`）全部分开，窗口标题带 `(dev)`。
实现与排查见 [docs/apps/client/dev-two-instances.md](./docs/apps/client/dev-two-instances.md)。
