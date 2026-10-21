# Studio 开发指南

## 1. 环境

- Node.js（与仓库约定一致）
- pnpm（workspace）
- Windows 上原生模块需能编译（`better-sqlite3` / `electron-rebuild`）
- Sidecar 解压用系统 `tar` / Expand-Archive（**无需** 7-Zip，也无额外解压 npm 包）

在 **monorepo 根**安装依赖：

```bash
pnpm install
```

`apps/studio` 的 `postinstall` 会执行：`electron-rebuild`（`better-sqlite3` 是原生模块）。

## 2. 常用脚本

在 `apps/studio` 或使用 filter：

| 脚本                                         | 作用                                             |
| -------------------------------------------- | ------------------------------------------------ |
| `pnpm --filter @i-thinking/studio dev`       | Electron Forge 开发（Main + Preload + Renderer） |
| `pnpm --filter @i-thinking/studio dev:core`  | 仅 Vite 网页模式（**无** `window.itc`）          |
| `pnpm --filter @i-thinking/studio test:unit` | Vitest（单测，不含集成测试）                     |
| `pnpm --filter @i-thinking/studio test:db`   | 数据库集成测试（在 Electron 运行时里跑，见 §8）  |
| `pnpm --filter @i-thinking/studio lint`      | ESLint                                           |
| `pnpm command sidecar bootstrap studio`      | tools.lock → downloads → studio staging（**全量落盘**，含按需工具） |
| `pnpm command sidecar manifest`              | 打印当前平台的在线包（`sidecar/manifest.json`）；`--verify` 下载并核 sha256 |
| `pnpm command sidecar opencode`              | 仅下载 opencode（按 tools.lock 的 pin 校验版本） |
| `pnpm command sidecar corex`                 | 仅下载 corex 到 `.cache/sidecar`                 |
| `pnpm command sidecar ffmpeg`                | 仅下载 FFmpeg（包较大，受网络影响）              |
| `pnpm command sidecar pandoc`                | 仅下载 pandoc                                    |
| `pnpm command sidecar stage studio`          | stage → studio staging                           |
| `pnpm command sidecar verify studio`         | 校验 staging checksums                           |
| `pnpm --filter @i-thinking/studio package`   | 打出可运行目录到 `out/`（需先 bootstrap）        |
| `pnpm --filter @i-thinking/studio package:full` | 同上，但带上按需工具（staging 里已经都在） |
| `pnpm --filter @i-thinking/studio build`     | 同 `package`（供 turbo / PR CI）                 |
| `pnpm --filter @i-thinking/studio make`      | `electron-forge make` → `out/studio/make`（精简版；Win 默认 NSIS+ZIP） |
| `pnpm --filter @i-thinking/studio make:nsis` | 同 `make:win`，显式打 NSIS Setup.exe                                  |
| `pnpm --filter @i-thinking/studio make:full` | 同上，完整版（内置 pandoc / ffmpeg / opencode）                       |
| `pnpm --filter @i-thinking/studio make:msi`  | 额外打 WiX MSI（需本机 WiX Toolset；见 packaging.md）                 |

### 两档产物：精简版 / 完整版

`apps/studio/scripts/run-forge.ts` 把档位以 `STUDIO_SIDECAR_VARIANT` 传给 forge（Windows 的
cmd/pwsh 没有 `VAR=值 命令` 这种写法，故用一个极小的 runner，不引 cross-env）。

**档位只在这一个地方决定** —— 落盘那一步不管档位（`bootstrap` 一律全量落盘，落在 staging 的
`checksums.json` 里逐文件标 `onDemand`），所以切档不用重跑 bootstrap。

| 档位 | 侧车 | 安装包 |
| ---- | ---- | ------ |
| `lite`（默认） | 只带 corex（引擎，缺了起不来）；pandoc / ffmpeg / opencode 由 Studio 运行时从在线源下载 | 小 ~824 MB |
| `full` | 全部内置，离线可用 | 大 |

- 哪些工具算「按需」由 `tools.lock.json` 的 `onDemand` 决定；打包时按档过滤（完整版反而要求它们都在）。
- **形状只有一份**：`tools.lock.json` / `sidecar/manifest.json` / staging `checksums.json` 三份 JSON
  的字段（`schemaVersion` / `platforms` / `sha256` / `onDemand`）与解析器都在
  [`@i-thinking/sidecar`](../../../packages/sidecar/README.md)，CLI、宿主、forge 共用。
- **在线源**：`apps/studio/sidecar/manifest.json`（宿主构建期内联，CLI 也能读它核对）。
  归档是重打包的（可执行文件平铺），地址 + sha256 都在这份 JSON 里；取用顺序 **已下载 → 随包内置**，
  落点 `<userData>/sidecar/<tool>/<版本>/`，入口在「设置 → 工具」。
- studio 不落盘 `goose`（agent 走 opencode），要它的是 client。

> 改了 `tools.lock.json` 的 pin 要重跑一次 `bootstrap` 才会换版本：缓存命中按
> `<工具>/.version` 记号判定（不是「文件在不在」），对不上就重装；版本没变的工具只会
> 从本地缓存的归档重新解压一次，不走网络。判定逻辑见 `infra/vendor.ts`。

> 全新检出（含 CI）直接 `make` 会失败在 renderer 解析上：`@i-thinking/hooks`、`@i-thinking/utils`
> 的 `exports` 指向 `dist`（见 `vite.renderer.config.mts` 的 `linkedMarker` 与 `optimizeDeps.exclude`
> 注释），本地之所以没暴露，是因为 `dist` 早就构建过、且被 gitignore。先补一步：
> `pnpm turbo run build --filter=@i-thinking/studio... --filter=!@i-thinking/studio`（只构建 studio 的 workspace 依赖）。

### corex 的三份来源（别混）

宿主只用**三类**位置找 corex，优先级按「谁来用」分（见 `host/capabilities/sidecar/install.ts`）：

| 来源                 | 位置                                                                           | 数据目录                                  | 何时优先               |
| -------------------- | ------------------------------------------------------------------------------ | ----------------------------------------- | ---------------------- |
| `COREX_CLI` 显式指定 | 该变量指向的 `corex.exe` 所在目录                                              | 那份 corex 自己算（`corex paths --json`） | 永远第一               |
| 用户自己装的那份     | PATH → `%LOCALAPPDATA%\corex\bin` → `%ProgramFiles%\corex`（macOS/Linux 同理） | 用户的数据目录（如 `~/.corex`）           | 打包态                 |
| Studio 自带的那份    | 打包态 `resources/sidecar`；开发态 `apps/studio/sidecar/staging/<platform>`    | 应用私有目录，**绝不与用户环境共享**      | 开发态（打包态为回退） |

- **`~/.corex` 是数据目录，不是安装目录**：指令库（`directives.db`）、token、历史、审计都在那儿，
  它不在「找二进制」的候选里。二进制装到 `%LOCALAPPDATA%\corex\bin`（`install.ps1` 的默认值）。
- **自带那份的数据目录绝不用 exe 旁边**：corex 的数据目录解析顺序里「可写的 exe 目录」排第二，
  不钉住就会把指令库写进 staging（仓库里）或 `resources/sidecar`（应用目录里）。
  所以自带那份显式用私有数据目录；端点与 corex 平台默认一致（Windows `\\.\pipe\corex`）。
- **开发态想让自带那份读真实数据**（调编辑器时看到自己的指令）：设 `COREX_DATA_DIR` 指向它即可
  （自带那份的 `token` 也跟着数据目录走）。注意 corex 的 `corex.lock` 是**每个数据目录一份**的单例锁
  —— 若你全局那个 daemon 正在跑，先停掉，否则 dev 自起的这个抢不到锁。

## 3. 环境变量

由 Vite / 类型声明使用（见 `src/types/env.d.ts`）：

| 变量                                            | 用途                                                                          |
| ----------------------------------------------- | ----------------------------------------------------------------------------- |
| `VITE_THINKING`                                 | Renderer HTTP `prefix`（远程 Thinking API；平台模型走其下的 `/gateway` 网关） |
| `VITE_APP_TITLE`                                | `index.html` 标题占位                                                         |
| `VITE_HOSTNAME` / `VITE_PORT` / `VITE_PROTOCOL` | 遗留本地服务相关（当前已不启 Nest；可按需清理）                               |

> **业务后端不在这个仓库**：`apps/service`（NestJS）已下线 —— 登录 / 注册 / 租户 / 配额 / 订阅与
> AI 网关（`/gateway/*`）都在独立的 Rust 仓库里维护，本地这样起：
> `cargo watch -x "run --bin cogito --features openapi"`，再把 `VITE_THINKING` 指到它的 `/api/v1`
> （如 `http://127.0.0.1:3000/api/v1`）。studio 只依赖这套 HTTP 契约，不 vendor 后端代码；
> agent 的运行则在 studio 自己的内嵌 opencode 里，与服务端无关。

Main 运行时由 bootstrap 设置：

- `APP_ROOT` ← `app.getAppPath()`
- `VITE_PUBLIC` ← `join(APP_ROOT, 'public')`

Forge 注入（窗口加载）：

- `MAIN_WINDOW_VITE_DEV_SERVER_URL`
- `MAIN_WINDOW_VITE_NAME`

打包 / 签名 / 发布 / 自动更新环境变量见 [packaging.md](./packaging.md)。

## 4. 目录与别名

```text
src/main.ts | src/preload.ts | src/renderer.tsx | src/host/capabilities/ | sidecar/
```

- `@/*` → `src/*`（UI）
- 宿主：相对路径 `./host/…`（无 `@main` / `@shared`）

进程边界由 ESLint `no-restricted-imports` 约束（见 `eslint.config.ts`）。

## 5. 本地调试

- `dev` 启动后，DevTools **仅开发态**可通过 `itc.devtools.toUpdate({ visible: true })` 打开（生产打包默认关闭）。
- 主进程日志：结构化 `buildLogger(module)`；未捕获异常接入 bootstrap。
- IPC 失败：preload 抛出 `Error('[CODE] message')`，见 [api-reference.md](./api-reference.md)。

## 6. 扩展功能

1. 读 [modules.md](./modules.md) 了解模块挂载方式
2. 照 [examples.md](./examples.md)「新增 IPC 全链路」改 channels → plugin 单文件 → main.ts → preload
3. 更新 [api-reference.md](./api-reference.md) 中的表格（文档与代码同步）

## 7. 测试

- 配置：`vitest.config.ts`
- 约定：`src/**/*.test.ts`；渲染测试写 `*.test.tsx`，并在文件首行加 `// @vitest-environment jsdom` 切到 DOM 环境（默认环境是 `node`，没有 `document`）
- 现有覆盖示例：
  - `host/capabilities/store.test.ts`
  - `host/capabilities/user.test.ts`（User 仓储，实现落在 `capabilities/database.ts`）
  - `host/capabilities/doc.test.ts`
  - `shared/ipc/contract.test.ts`
  - `host/ipc/register.test.ts`（假 IpcMain，无需启动 Electron）
  - `host/capabilities/trusted-sender.test.ts`
  - `host/framework/paths.test.ts`（`APP_ROOT` / bundle 目录推导）
  - `preload.expose.test.ts`（断言不暴露 `ipcRenderer`）
  - `components/contextmenu/contextmenu.test.tsx`、`views/agent/chat/components/{diff-view,tool-terminal}.test.tsx`（组件渲染，走 `@testing-library/react`）

```bash
pnpm --filter @i-thinking/studio test:unit
```

## 8. 数据库 / 原生模块

```bash
# 在 apps/studio
pnpm exec drizzle-kit generate --name=<name>   # 改 drizzle/schema 后生成迁移
pnpm run rebuild   # = electron-rebuild -f：按 Electron ABI 重建 better-sqlite3 / msgpackr-extract
pnpm test:db       # 真实引擎的数据库集成测试（建表 / 种子 / 迁移幂等）
```

- 必须显式写 `pnpm run rebuild`（等价 `pnpm --filter @i-thinking/studio run rebuild`）：裸 `pnpm rebuild` 是 pnpm 的**内置命令**，不会执行这个 script，而是对全仓包重跑 install 脚本（为**宿主 Node** 构建原生模块，会把 Electron ABI 的 `better-sqlite3` 覆盖成宿主 ABI → `NODE_MODULE_VERSION` 不匹配）。为此 [pnpm-workspace.yaml](../../../pnpm-workspace.yaml) 里 `allowBuilds.better-sqlite3: false` 关掉了 better-sqlite3 自己的 install 脚本，构建统一交给 `@electron/rebuild`。
- 该 script 带 `-f`：`@electron/rebuild` 只读 `build/Release/.forge-meta`（内容 `<arch>--<ABI>`）判断「是否已构建」，**不校验二进制是否存在或正确**；marker 与当前 Electron 一致时会打印 `✔ Rebuild Complete` 却什么都不做，所以修 ABI 问题必须强制重建。

- 集成测试 `src/host/**/*.integration.test.ts` 需要 **Electron ABI** 的 `better-sqlite3`，普通 Node 加载会 ABI 不匹配，所以它们被排除在 `test:unit` 之外；`test:db` 用 `ELECTRON_RUN_AS_NODE=1` 把 Electron 当 Node 跑 vitest（`scripts/run-db-tests.mjs`）。

- schema 按领域分文件放在 `drizzle/schema/`（`index.ts` 汇总），迁移产物在 `drizzle/migrations/`（SQL + `meta/journal`）。
- 访问层用 **Drizzle ORM**，引擎 **better-sqlite3**；新增表应通过 **Repository + 领域 IPC** 暴露，禁止 raw SQL channel。
- **迁移只有一个文件**：`drizzle/migrations/0000_init.sql`（全量建表 + 138 条种子 `INSERT OR IGNORE`）。开发阶段不保留历史版本 —— 改 schema 后直接重新生成，把种子并回去，并删掉本地库让它重建。
- 工作区现为 `workspace` + `workspaceFolder`（会话挂 `workspaceID`）。本地若仍是旧 `workspaceRoot` 结构，**删库重建**即可。
- **studio 自己建表**：启动时跑 Drizzle 官方 `migrate()`（`src/host/capabilities/database.ts`）。库里已有同名表会让 migrator 直接报错 —— **不支持「库是别的版本建的」**这种情况，冲突当场暴露比猜别人的 schema 好。
- 两个 app 的库路径仍指向同一文件（`app_local_data_dir()/cogito-client.db`，identifier `com.cogito.client`），以便日后互读；但建表/迁移互不负责。
- 改 schema 的流程：改 `drizzle/schema/*.ts` → `pnpm --filter @i-thinking/studio exec drizzle-kit generate --name <名字>`；确认没多余产物后重启 app。
- 迁移背景与逐表映射见 [prisma-to-drizzle.md](../../decisions/prisma-to-drizzle.md)。

## 9. 下一步

- 架构总览 → [architecture.md](./architecture.md)
- 复制调用 → [examples.md](./examples.md)
- 打包发版 → [packaging.md](./packaging.md)
- 出问题 → [troubleshooting.md](./troubleshooting.md)
