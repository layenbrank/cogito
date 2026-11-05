## UI 约定

仓库已完成 antd → shadcn/ui + Tailwind v4 迁移（studio / extension / client 不再有 antd 代码）：

- 组件：`@cogito/design/{components,assistant}/*`（shadcn `new-york` + base-ui base + lucide 图标）；目录名即子路径，`hooks/*`、`globals.css` 各自独立
- 设计 token 唯一源：`packages/design/src/styles/globals.css`；app 侧 `@source` 声明自己的源码
- 新增组件走 registry：`pnpm --filter @cogito/design registry:add <items>`
- chat 相关走 assistant-ui（`packages/chat` 提供端口契约与适配器）
- 窗口装饰自绘：窗口一律 `decorations: false`，桌面壳走 `features/window-shell`（`ShellFrame` / `Caption` / `useShellSurface`；见 [client 组件文档](./docs/apps/client/components-api.md)）
- 前端持久化：非密偏好走 Tauri Store（`features/persist`），密钥走 OS Keyring，领域实体仍 SQLite；见 [persist 分层](./docs/apps/client/persist.md)

## Agent 临时文件

调试脚本、构建日志、验证输出这类**会话级缓存**一律写到 `~/.cogito/agent-cache/`
（Windows：`%USERPROFILE%\.cogito\agent-cache`），不要在仓库根目录下建 `tmp/` 之类的目录：

- 仓库根只放产品代码与文档；临时文件落在根目录会脏 `git status`，也容易被误提交
- 需要按任务区分时，在该目录下再建子目录（如 `~/.cogito/agent-cache/build/`），不要回落到工作区
- 用完即删；该目录不受版本管理，不需要写进 `.gitignore`
