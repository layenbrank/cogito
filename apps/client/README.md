# i-thinking Client (Tauri)

> ⚠️ **DEPRECATED / 已废弃（2026-09）**
>
> 本应用已冻结，不再接收功能改动：桌面端全面转向 `apps/studio`（Electron），
> 扩展端由 `apps/extension`（React 重写）承接。本目录仅作**只读参考**：
>
> - 不参与仓库根聚合任务（`build` / `lint` / `unit` / `e2e` 已排除本包）
> - 共享能力不再从本包抽取实现，需要复用时按“Electron / MV3 环境差异分层”重建到 `packages/*`
> - 样式栈已随仓库对齐到 **Tailwind v4 + `@i-thinking/design`**：入口为 `src/styles/tailwind.css`
>   （`@import '@i-thinking/design/globals.css'` + `@source '../'`），antd 与 `src/themes/**`（`--ith-*` cssVar）
>   已全部移除；旧 v3 `@tailwind` 指令已不存在
> - 窗口一律 `decorations: false`，桌面壳自绘：`Decorations`（`src/components/decorations/`）是所有窗口的
>   容器（标题栏 + 撑满内容 + 纵向 flex，根透明让 mica / 透明材质透出），`Caption`（`src/components/caption/`）
>   是它的标题栏（拖拽区带 `data-region`，槽位里的按钮带 `data-region="false"`）；
>   磁贴不再用 Dialog，双击开独立窗口
> - 主窗口标题栏内容在 `src/views/overview/caption/`：镜像入口（切换 + 新建/重命名/删除）、
>   状态芯片（corex / 可更新）、账号
> - 磁贴分两层：`views/<tile>/` 是窗口页（含 `workspace/**` 等窗口专属实现），
>   `features/magnetic-tiles/<tile>/` 只放板上磁贴（表面 + marker + 尺寸 scss）与两侧共用件
> - agent 窗口是布局路由：`views/agent/agent.tsx` 只做出口，两个子页 `views/agent/{chat,settings}/`
>   对应 `/agent/chat`（默认）与 `/agent/settings`（对齐 studio）
> - 其 `AiSession / AiMessage / AiProvider` 域实现（Rust + TS）已被 studio 的新 chat 域取代

桌面客户端，Tauri 壳层 + React 前端；重能力经 **corex-daemon** sidecar IPC 提供；Agent 可选用内置 **goose** ACP sidecar。

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
pnpm --filter @i-thinking/client check:tauri
```

## 打包

```bash
pnpm sidecar bootstrap client
pnpm build:client
```
