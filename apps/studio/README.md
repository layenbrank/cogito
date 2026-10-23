# cogito Studio

Electron 桌面应用（`@cogito/studio`）：Forge + Vite，主进程域模块 + 契约 IPC（`window.itc`），业务 HTTP 走远程 API。

## 文档

完整文档索引：**[docs/README.md](./docs/README.md)**

| 文档                                | 说明                  |
| ----------------------------------- | --------------------- |
| [架构方案](./docs/architecture.md)  | 进程边界、组合根、IPC |
| [开发指南](./docs/development.md)   | 环境、脚本、扩展      |
| [使用示例](./docs/examples.md)      | 可复制调用与新增 IPC  |
| [API 参考](./docs/api-reference.md) | Channel / 错误码      |
| [排障](./docs/troubleshooting.md)   | 启动与 IPC 常见问题   |

## 快速开始

在 monorepo 根目录：

```bash
pnpm install
pnpm command sidecar bootstrap studio   # tools.lock → .cache → staging（无需系统 7-Zip）
pnpm --filter @cogito/studio dev
```

落盘是**全量**（含 pandoc / ffmpeg / opencode）；带不带进安装包由打包档位定（默认精简版：
它们不进包，应用运行时从「设置 → 工具」下载），要内置用 `package:full` / `make:full`。

仅网页预览（无 `window.itc`）：

```bash
pnpm --filter @cogito/studio dev:core
```

单元测试：

```bash
pnpm --filter @cogito/studio test:unit
```

## 源码结构

```text
src/main.ts | src/preload.ts | src/renderer.tsx | src/plugins/ | sidecar/
```

详见 [docs/architecture.md](./docs/architecture.md)。
