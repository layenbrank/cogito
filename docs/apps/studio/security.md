# Studio 安全模型

## 1. webPreferences 基线

窗口创建（`modules/window`）：

| 项                            | 值                        |
| ----------------------------- | ------------------------- |
| `contextIsolation`            | `true`                    |
| `nodeIntegration`             | `false`                   |
| `sandbox`                     | `true`                    |
| `webSecurity`                 | `true`                    |
| `allowRunningInsecureContent` | `false`                   |
| `devTools`                    | 仅 `!app.isPackaged`      |
| `preload`                     | 打包目录下的 `preload.js` |

## 2. Preload 暴露面

- **仅** `contextBridge.exposeInMainWorld('itc', …)`
- **禁止**暴露裸 `ipcRenderer`
- 静态测试：`src/preload.expose.test.ts`

## 3. IPC 信任

`host/ipc/register.ts` 的 wrapper 对**每个**频道调用 `isTrustedSender`：

1. `event.sender` 必须已通过 `ctx.trustWebContents` 登记（window 创建时登记，close 时取消）
2. URL 必须在允许范围：
   - **开发**：Vite origin（`MAIN_WINDOW_VITE_DEV_SERVER_URL` 的 origin）；未配置时回退 `localhost` / `127.0.0.1`
   - **生产**：仅 `file:`

失败返回 `IPC_UNTRUSTED_SENDER`。

## 4. 导航与开窗

`attachGuards`（域外可别名为 `attachWindowGuards`）：

- `will-navigate`：拒绝非允许 URL
- `setWindowOpenHandler`：一律 `deny`

## 5. CSP 与权限

- `session.defaultSession.webRequest.onHeadersReceived` 注入 CSP（开发放宽 connect/ws；生产收紧 script-src）
- `setPermissionRequestHandler`：默认拒绝（白名单当前为空）

`index.html` 另有 meta CSP，供非 Electron 预览兜底。

## 6. 数据面

| 风险                       | 对策                                                                                                                                                                                                                                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| XSS → 任意 SQL             | 废除 `db:query`；仅 `user:*` 仓储                                                                                                                                                                                                                                                                         |
| XSS 偷模型密钥             | apiKey 只在主进程：`assistant/key.ts` 用 `safeStorage` 落密文，IPC 只有写/问有没有/删，**没有读回接口**；密钥库不可用时拒绝保存而非明文落盘                                                                                                                                                               |
| 被攻破的渲染进程压垮主进程 | agent 运行时（`assistant:connect` → MessagePort）限制单消息 ≤ 1MB、单请求 ≤ 200 条、并发 ≤ 4；入站消息过 zod；端口关/窗口销毁即 abort                                                                                                                                                                     |
| 登录令牌外泄               | 令牌只随该次运行的 `host.platformToken` 进主进程当 apiKey（只对 `kind === 'gateway'` 生效，≤4096 字符），不落钥匙串、不进数据库                                                                                                                                                                           |
| agent 凭据被复制到磁盘     | provider 配置（BYOK 明文密钥 + 登录令牌 + 租户头）经 `OPENCODE_CONFIG_CONTENT` 内联注入子进程，用完随进程消失；不写 opencode 自己的明文 auth store                                                                                                                                                        |
| 本机 opencode 端口被滥用   | server 只绑 `127.0.0.1` + 每次启动新探的空闲端口，并要求 `OPENCODE_SERVER_PASSWORD`（每进程随机 24 字节）做 Basic Auth；spawn 时设 `NO_PROXY` 避开本机系统代理                                                                                                                                            |
| 任意执行本地二进制         | Renderer 无通用 spawn；域模块（doc / screenshot→corex Action）+ `shell: false`                                                                                                                                                                                                                            |
| Agent 工具越出工作区读写   | 工具在 **opencode 子进程**内执行，工作目录就是本次运行的工作区；越界访问被它的 `external_directory` 守卫拦成一次审批（`readonly` 档直接拒绝）。studio 自己的文件 API 仍走 `resolveInside` 三道防线（拒绝绝对路径/`..`、以 realpath 根比前缀、祖先 realpath 再验一次）→ 抛 `WORKSPACE_PATH_ESCAPE`         |
| Agent 静默改文件           | 有副作用的工具默认走审批：opencode 发 `permission.asked`，主进程翻成弹窗等渲染进程回执（档位已编译进 agent 的 permissions，服务端只在真需要拍板时才问），超时与 abort 均按**拒绝**落地；档位由 `chat.approval` 给默认值、随每次运行由引擎 `switchAgent` 应用                                              |
| 工具上下文无限膨胀         | 循环、压缩、子任务深度由 opencode 自己管（studio 不再设步数上限）；studio 自己的文件 API 仍有界：单文件读 2MB、目录列 500 条、检索限深 8 / 目录 2000 / 命中 200                                                                                                                                           |
| Agent 读走 `.env` 里的密钥 | `read` 的权限规则里补三条显式规则（`*.env` / `*.env.*` → `deny`、`*.env.example` → `allow`），排在 `read *` 之后（规则后者胜）。opencode 内建的 `.env` 保护默认只是 `ask`，`auto` 档会被直接放行；显式 `deny` 后连审批都不弹。`.env` 保护不随档位放开                                                     |
| 自定义 / MCP 工具绕过审批  | 兜底规则 `{action:'*',resource:'*'}` 排在最前、取 `mutating` 的效果：没在工具表点名的 action 在 `ask` 档下要逐次确认、`readonly` 档下执行不了，不会因为「表里忘了写」被静默放行。要正式支持得先在 [`shared/agent-tools.ts`](../../../apps/studio/src/shared/agent-tools.ts) 加一行（给标题、给对 action） |
| 侧车/工具被篡改            | `tools.lock.json` 钉版本+SHA256；staging `checksums.json`（逐文件记 `tool` + `version` + `sha256`，落盘目录能自证版本）；Forge afterCopy 校验；运行时下载按同一份 sha256 校验后才落盘                                                                                                                     |
| 不可复现构建               | corex 来自 GitHub Releases 且禁止 floating URL；pandoc / ffmpeg / opencode 的在线包是自建 R2 上的**重打包**归档，地址 + sha256 钉在 `apps/studio/sidecar/manifest.json`（不随版本浮动）                                                                                                                   |
| 在线工具被中途替换         | 下载到 `<版本>.tmp` → 算 sha256 → 对不上就丢，解压后只搬可执行文件，最后 rename 上位；半截文件永远进不了正式目录                                                                                                                                                                                          |

### 6.1 v2 里工具可见性只由 permission 决定

v1 有过一个真实的漏洞面：请求体 `tools` 里的 `true` 被 opencode 理解成「本次请求已预先批准」，
既能让 `ask` 档形同虚设，也能越过配置里的 `deny`（`readonly` 档下 bash 照样执行）。
**这条路径随 v1 一起删掉了** —— v2 不再有「按请求关工具」的开关，工具可见性与执行许可**只由 permission 决定**：

| 配置                  | 请求体 `tools`          | 结果（v1，1.18.32）                  |
| --------------------- | ----------------------- | ------------------------------------ |
| `permission.edit=ask` | 无 / `{question:false}` | `permission.asked` ×1，回执后写入    |
| `permission.edit=ask` | `{edit:true}`           | **不审批，直接写入**                 |
| 全 `deny`（readonly） | `{edit:true}`           | **不审批，直接写入（deny 被越过）**  |
| 全 `deny`（readonly） | `{question:false}`      | 工具直接不可用（`unavailable tool`） |

这张表留在文档里的唯一理由是**别再造一个「按请求开工具」的开关**：任何「本次请求已批准」的口子都会
同时打掉审批与 `deny`。v2 的做法是把档位编译成 permission 规则本身 —— effect 为 `deny` 的 action
干脆不进模型工具列表（见 [online-models.md](./online-models.md) §7.3）。

配置侧的纪律（`permission` 是**有序规则数组**，**last match wins**，没命中默认 `ask`）：

- **兜底规则排最前，取 `mutating` 的效果**：`{action:'*',resource:'*'}` 于是把没点名的动作（MCP 工具、
  升级新增的动作）都按「有副作用」对待 —— `ask` 档逐次确认、`readonly` 档拒绝，不会因为「表里忘了写」被放行。
- **`.env` 的三条规则排最后**（`*.env` / `*.env.*` → `deny`、`*.env.example` → `allow`）：
  顺序反了就会被前面的 `read *` 吃掉，`.env` 全文（含密钥）进模型上下文送上上游。
- **`question` 三档一律 deny**：serve 模式下反问没人能回答，模型会一直等；这是产品口径，不是权限问题。
- **四个 studio agent 只写 `permissions`，不写 `system`**：写了会整体替换掉 opencode 内置的编码 agent
  提示词（工具说明、编辑规范一起没），权限没变但行为变得不可预期。档位是权限问题，不该顺手改提示词。

运行期两条 fail-closed 纪律：

- **审批归属找不到就拒绝**：`permission.asked` 可能来自子代理自己起的会话，主进程先按 `sessionID` 找、
  再沿 `parentID` 上溯（≤8 层），找不到（提问的会话已收尾）直接回 `reject`，不让服务端干等；
  超时（5 分钟）与 abort 同样按拒绝落地。
- **回执只用 `once` / `reject`**：`always` 会往项目里持久化一条 allow，而它**永远盖不过**配置里的 `deny`
  （用起来像「有时候有效」），所以不下发。

一条 v1 的补丁在 v2 不需要了：v1 必须把内建工具 `invalid`（参数修正载体）留在允许名单里，否则工具调用
失败会退化成只剩英文名的句子；`invalid` 在 v2 的工具集里根本不存在。

**待实测**：兜底规则对 MCP 工具（action 形状 `<server>_<tool>`）的实际效果。v1 时代实测过「自定义工具在
`ask` 档下不弹审批、直接执行」，那是「审批闸门写在各内建工具内部」的后果；v2 的判定在服务端按 action
统一做，但还没拿真实 MCP 工具端到端复测过。

## 7. Electron Fuses（打包时）

见 `forge/plugins.ts`（由 `forge.config.ts` 组装）：

| Fuse                                    | 当前    | 说明                                   |
| --------------------------------------- | ------- | -------------------------------------- |
| `RunAsNode`                             | `false` | 去 Nest 后无需；降低被当 Node 宿主滥用 |
| `EnableNodeOptionsEnvironmentVariable`  | `false` | 防 NODE_OPTIONS 注入                   |
| `EnableNodeCliInspectArguments`         | `false` | 防调试参数滥用                         |
| `EnableCookieEncryption`                | `true`  |                                        |
| `EnableEmbeddedAsarIntegrityValidation` | `true`  |                                        |
| `OnlyLoadAppFromAsar`                   | `true`  |                                        |

## 8. 与 Electron Security Checklist 对照（摘要）

| 建议                             | Studio                  |
| -------------------------------- | ----------------------- |
| contextIsolation                 | 是                      |
| 禁用 nodeIntegration             | 是                      |
| sandbox                          | 是                      |
| 限制导航 / 新窗口                | 是                      |
| 校验 IPC sender                  | 是（webContents + URL） |
| CSP                              | 是（headers）           |
| 不暴露 Electron API 给不可信内容 | 仅 itc 白名单           |
| 保持 Electron 版本更新           | 依赖 catalog / 团队维护 |

完整清单见 [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)。
