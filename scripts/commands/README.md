# i-thinking 命令行（`pnpm command`）

统一 monorepo 工具入口（commander + chalk + figlet + gradient-string + inquirer）。

```bash
pnpm command --help
pnpm command sidecar --help
pnpm command distribution --help

pnpm command sidecar bootstrap studio
pnpm command sidecar bootstrap client
pnpm command sidecar corex
pnpm command distribution deploy
pnpm command distribution check
```

快捷脚本（同义）：

```bash
pnpm sidecar bootstrap client
pnpm distribution deploy
```

| 命令 | 含义 |
|------|------|
| `pnpm command` | 根命令行 |
| `pnpm command sidecar …` / `pnpm sidecar …` | 侧车工具功能域 |
| `pnpm command sidecar corex` | 仅下载 corex（≠ 根入口） |
| `pnpm command distribution …` / `pnpm distribution …` | i-thinking 资源分发端点（Cloudflare Worker） |

| 路径 | 职责 |
|------|------|
| `core/` | 注册表 / 日志 / 横幅 / 路径 / 交互提问 |
| `features/sidecar` | tools.lock + 策略下载；studio/client 落盘目标 |
| `features/distribution` | 驱动 `apps/distribution`（workspace 包 `@i-thinking/distribution`） |

缓存：`.cache/sidecar/<tool>/<platform>/`、`.cache/fuses/`、`.cache/corex/`（`directives` 指令、`captures` 截图、`probes` 文本）。

代理：`HTTPS_PROXY` + 建议 `NODE_USE_ENV_PROXY=1`；下载用 `ky`，失败再 curl `-x`。
