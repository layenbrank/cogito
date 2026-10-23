# cogito Client (Tauri)

桌面客户端，Tauri 壳层 + React 前端；重能力经 **corex-daemon** sidecar IPC 提供；Agent 经内置 **goose** ACP sidecar（引擎保留，UI 层对齐 studio）。

## 架构要点

- 样式栈 **Tailwind v4 + `@cogito/design`**：入口 `src/styles/tailwind.css`（`@import '@cogito/design/globals.css'` + `@source '../'`）；无 antd / `--ith-*` / 旧 v3 `@tailwind`。
- 窗口一律 `decorations: false`，桌面壳自绘：`Decorations`（`src/components/decorations/`）是窗口容器（标题栏 + 撑满内容 + 纵向 flex，根透明让 mica / 透明材质透出），`Caption`（`src/components/caption/`）是标题栏（拖拽区带 `data-region`，槽位内交互元素带 `data-region="false"`）。
- **无内置浏览器**：网址与 Web 搜索结果一律 `openUrl`；主窗 Command Omnibar（`features/command-bar`）本地优先检索磁贴 / 日程 / Agent 等，引擎切换为横向展开。
- 磁贴不用 Dialog，双击开独立窗口（`navigation` 磁贴则外跳）；分两层：`views/<tile>/` 是窗口页，`features/magnetic-tiles/<tile>/` 是板上磁贴。
- agent 是布局路由：`views/agent/agent.tsx` 只做出口，两个子页 `views/agent/{chat,settings}/` 对应 `/agent/chat`（默认）与 `/agent/settings`（对齐 studio）。
- 主窗口标题栏：中间 Omnibar（`mod+k`）+ 右侧镜像 / 状态 / 账号（`src/views/overview/caption/`）。

## 开发

侧车二进制由**仓库根**统一准备（不要在 `apps/client` 里再挂 prepare 脚本）：

```bash
# 仓库根
pnpm sidecar bootstrap client
pnpm dev:client
```

或在 `apps/client`：

```bash
pnpm dev          # tauri dev（beforeDevCommand 只起 vite）
```

| 工具             | 落盘（`src-tauri/binaries/`）                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| corex-daemon     | `corex-daemon-<host-triple>[.exe]`（同包的 `corex.exe` / `corex-mcp.exe` 一并落盘）             |
| pdfium           | `pdfium.dll`（`tools.lock.json` 的 `pdfium` pin，版本与 corex 的 `assets/pdfium/VERSION` 对齐） |
| goose            | `goose-<host-triple>[.exe]`（优先本机 `goose` / `GOOSE_BINARY`，否则下 release）                |
| pandoc           | `pandoc[.exe]`                                                                                  |
| ffmpeg / ffprobe | `ffmpeg` / `ffprobe`                                                                            |

版本钉：[`scripts/commands/features/sidecar/tools.lock.json`](../../scripts/commands/features/sidecar/tools.lock.json)  
下载缓存：`.cache/sidecar/<tool>/<platform>/`（仓库根）

单项：`pnpm sidecar corex|pdfium|goose|pandoc|ffmpeg`，再 `pnpm sidecar stage client`。

启动时 Tauri 会拉起 `goose serve --platform desktop --tls`（ACP 传输层）。设置里的供应商来自 **goose inventory**（Ollama、OpenAI 兼容、各类 CLI/ACP 等）；对话经指纹 pinning WSS 接入 goose ACP，并用 `session/set_config_option` 切换 provider+model。

## Rust 检查 / 构建

```bash
# 仓库根先准备 binaries
pnpm sidecar bootstrap client
pnpm --filter @cogito/client check:tauri
```

## 打包

```bash
pnpm sidecar bootstrap client
pnpm build:client
```
