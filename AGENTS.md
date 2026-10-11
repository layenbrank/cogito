## UI 约定

仓库已完成 antd → shadcn/ui + Tailwind v4 迁移（studio / extension / client 不再有 antd 代码）：

- 组件：`@i-thinking/design/{components,assistant}/*`（shadcn `new-york` + base-ui base + lucide 图标）；目录名即子路径，`hooks/*`、`globals.css` 各自独立
- 设计 token 唯一源：`packages/design/src/styles/globals.css`；app 侧 `@source` 声明自己的源码
- 新增组件走 registry：`pnpm --filter @i-thinking/design registry:add <items>`
- chat 相关走 assistant-ui（`packages/chat` 提供端口契约与适配器）
- 窗口装饰自绘：窗口一律 `decorations: false`，桌面壳走 app 的 `Caption` / `Decorations`（见 [client 组件文档](./docs/apps/client/components-api.md)）
