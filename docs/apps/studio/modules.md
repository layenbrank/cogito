# Studio host 能力说明

组合根：[`src/main.ts`](../../../apps/studio/src/main.ts)。

注册顺序（当前）：

1. security
2. store
3. dialog
4. database
5. window
6. devtools
7. updater
8. doc
9. screenshot
10. sidecar（`corex.start()` 后台启动，失败降级）

## 能力域一览

下表是全部能力域。**只有 6 处导出 `buildPlugin()`**（有生命周期，进 `main.ts` 的插件循环）：
`security`、`database`、`window/index.ts`、`window/tray.ts`、`sidecar`、`capture`；
其余域只有 IPC handler，频道注册由 `host/ipc` 遍历契约统一完成。

| 插件       | 路径                                                                                                                                       | 职责                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| security   | `capabilities/security.ts`                                                                                                                 | session 权限、CSP、导航守卫                                                                                            |
| store      | `capabilities/store.ts`                                                                                                                    | electron-store + IPC                                                                                                   |
| dialog     | `capabilities/dialog.ts`                                                                                                                   | 打开/保存对话框                                                                                                        |
| database   | `capabilities/database.ts`                                                                                                                 | better-sqlite3 + Drizzle 连接、迁移采纳、User 仓储 IPC                                                                 |
| chat       | `capabilities/chat.ts`                                                                                                                     | chat 域仓储 IPC（provider / session / message / 用量账本）                                                             |
| asset      | `capabilities/asset.ts`                                                                                                                    | 资源（贴图 / 文件）落盘与读取                                                                                          |
| magnetic-tile | `capabilities/magnetic-tile.ts`                                                                                                          | 磁贴与镜像（mirror）服务                                                                                               |
| trusted-sender | `capabilities/trusted-sender.ts`                                                                                                         | 「这个 sender 可信吗」：IPC 与 security 共用                                                                           |
| workspace  | `capabilities/workspace/`（`index` / `path` / `git` / `changes` / `skills`）                                                                | 工作区（多文件夹）+ 根内目录/检索/读文件 + 技能扫描 + git 分支 + 变更卡 IPC 转发（变更的实际记录方是 opencode 的 `session.diff`） |
| assistant  | `capabilities/assistant/`（`index` / `protocol` / `key` / `model` / `approval`）                                                            | agent 运行时的宿主侧：MessagePort 帧编解码、safeStorage / 登录令牌凭据分派、工具名与审批档位                           |
| opencode   | `capabilities/opencode/`（`paths` / `server` / `client` / `config` / `permission` / `events` / `session` / `engine` / `changes`）           | **agent 真正跑在这里**：拉起 `opencode serve` 子进程、把 provider 配置注入进去、转发审批、汇总 `session.diff` 出变更卡 |
| window     | `capabilities/window/`（`index` / `factory` / `registry` / `tray`）                                                                        | 建窗（主窗口 / Agent 子窗口 / 浮层）、窗口端口规格表、托盘                                                            |
| capture    | `capabilities/capture/`（`index` / `parse` / `path`）                                                                                      | 截屏服务与结果解析、落盘路径                                                                                           |
| overlay    | `capabilities/overlay/`（`index` / `window-port` / `through`）                                                                             | 浮层窗口 + 点击穿透（through 的 hit-rects）                                                                            |
| sidecar    | `capabilities/sidecar/`（`install` / `index` / `job-progress`）                                                                             | corex-daemon 宿主 + findStatus；**只认自带那份与用户自己装的那份**，落点事实问 framework                              |
| tools      | `capabilities/tools/`（`catalog` / `install` / `download` / `archive` / `service`）+ `apps/studio/sidecar/manifest.json`（形状/解析器来自 `@cogito/sidecar`）              | 在线工具（pandoc / ffmpeg / opencode）：按 manifest 的直链下载 → sha256 校验 → 落 `<userData>/sidecar`                  |
| doc        | `capabilities/doc.ts`                                                                                                                      | pandoc 转换（二进制由 tools 域提供）                                                                                   |
| updater    | `capabilities/updater/`（`index` / `feed`）                                                                                                | `electron-updater`（generic / `latest.yml`）                                                                             |
| devtools   | `capabilities/devtools.ts`                                                                                                                 | 开发态 DevTools                                                                                                        |

路径省略了 `src/host/` 前缀。**一个域多个文件就建目录**（目录名即域，内部用短名，对外的那个文件叫 `index.ts`）；单文件域直接平铺在 `capabilities/` 下。

上述路径是**域内实现**（Repository / Service）。IPC 契约与装配不在其中：

| 放置    | 路径                                | 内容                                |
| ------- | ----------------------------------- | ----------------------------------- |
| 契约    | `src/shared/ipc/`                   | 频道 + schema + 派生类型 + 错误码   |
| handler | `src/host/ipc/handlers/<domain>.ts` | invoke 入口（切片，装配点统一注册） |
| 插件    | `src/host/capabilities/<domain>.ts` 或 `<domain>/index.ts` | **仅当该域有生命周期需求**才写 |
| 外壳    | `src/host/framework/`               | 与域无关的事实：打包态/路径（`paths`）、二进制在哪儿（`binaries`）、日志（`logger` / `log-file`）、插件契约（`module`） |

几处**看起来放错地方、其实刻意如此**的归置：

- `framework/` 不持有能力域宿主：corex 在 `main.ts` 建好后直接交给 `sidecar` / `capture` 两个域与 `host/ipc`，
  否则 framework 会反向依赖能力域。
- `capabilities/window/tray.ts` 在 `window/` 里 —— 托盘不是窗口，但它要用 `MainWindowPort`（把窗口叫回来）。
- `capabilities/trusted-sender.ts` 平铺不建目录 —— 它是 `host/ipc` 与 `security` 共用的一个小判断。
- `capabilities/overlay/window-port.ts` 归 `overlay/` 而不是 `window/` —— 它描述浮层窗口对外的口子，
  放 `window/` 会和那里的 `index.ts` 撞名。

## 导入路径约定

- **同目录 → `./x`；其它一切跨目录 → `@/...`**（不再数 `../../../`）
- `@/` → `src/`；`src` 之外的构建期产物用专用别名：`@schema`（`drizzle/schema`）、`@manifest`（`sidecar/manifest.json`）、`@generated`
- 三条进程边界由 eslint 机器把关：
  - renderer：`@/` 全可用，但**不得引入 `@/host/**`**，也禁 `@schema` / `@manifest`（主进程的数据源）；
    主进程类型只走 `src/types/itc.d.ts` 与 `@/shared/ipc/api`；
  - **host / main**：只允许 `@/shared/**`、`@/host/**` 与上面三个 `@schema` / `@manifest` / `@generated`；
    禁跨目录相对（`../`），同目录才用 `./x`；
  - preload：只允许 `@/shared/**`，相对路径只给同目录的 `./preload*`。
- `src/shared/` 内部保持层内相对（它是三进程共用的自包含层）；`index` 与 `.ts` 后缀按原样，不强制增删。

> **频道注册不再由各域承担** —— `host/ipc` 遍历契约统一注册。
> 多数域已经不再导出 `buildPlugin()`。

## UI 约定

- **弹层（Popover / Dialog）里的长列表必须自带滚动容器**：用
  `<div className="max-h-64 overflow-y-auto">`，不要用 `ScrollArea`。Radix 的 ScrollArea
  Viewport 是 `size-full`（`height: 100%`），而弹层中的父元素通常只有 `max-height`
  （高度不确定），百分比高度会退化成 `auto` —— 列表直接溢出弹层，看着像「弹层没有滚动条」。
  搜索框之类固定元素要放在滚动容器**外面**，否则会跟着列表一起滚走。

## 新增域检查清单

1. `shared/ipc/channels.ts` 加频道
2. `shared/ipc/specs/<domain>.ts` 加 in/out schema，并入 `specs/index.ts` 聚合
3. `shared/ipc/api.ts` 加 Api 叶子
4. `host/ipc/handlers/<domain>.ts` 实现切片，并入 `host/ipc/index.ts`
5. `preload.ts` 的 api 字面量加一行
6. 类型断言与测试全绿
7. 更新 [api-reference.md](./api-reference.md) / [examples.md](./examples.md)

样例步骤见 [examples.md §9](./examples.md#9-端到端新增一条-ipc示例-settings)。
