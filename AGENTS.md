## UI 约定

仓库已完成 antd → shadcn/ui + Tailwind v4 迁移（studio / extension / client 不再有 antd 代码）：

- 组件：`@cogito/design/{components,assistant}/*`（shadcn `new-york` + base-ui base + lucide 图标）；目录名即子路径，`hooks/*`、`globals.css` 各自独立
- 设计 token 唯一源：`packages/design/src/styles/globals.css`；app 侧 `@source` 声明自己的源码
- 新增组件走 registry：`pnpm --filter @cogito/design registry:add <items>`
- chat 相关走 assistant-ui（`packages/chat` 提供端口契约与适配器）
- 窗口装饰自绘：窗口一律 `decorations: false`，桌面壳走 `features/window-shell`（`ShellFrame` / `Caption` / `useShellSurface`；见 [client 组件文档](./docs/apps/client/components-api.md)）
- 前端持久化：非密偏好走 Tauri Store（`features/persist`），密钥走 OS Keyring，领域实体仍 SQLite；见 [persist 分层](./docs/apps/client/persist.md)

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
