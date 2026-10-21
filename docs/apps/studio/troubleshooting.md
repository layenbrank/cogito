# Studio 排障

## 快速对照

| 现象                                                                                                                          | 可能原因                                                                                                           | 处理                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 启动弹窗：`createRequire` / `filename` Received undefined                                                                     | Vite 将 main 打成 CJS 时，`import.meta.url` 可能变成 `undefined`                                                   | 使用 [`src/host/framework/paths.ts`](../../../apps/studio/src/host/framework/paths.ts)（`argv[1]` / `APP_ROOT`）；勿在 Main 顶层 `createRequire(import.meta.url)`                                                                                                                                                                                                                                                                                                                                                                                   |
| `IPC_UNTRUSTED_SENDER`                                                                                                        | webContents 未登记，或 URL 不在 Vite origin / 非 `file:`                                                           | 确认 window 模块已 `trustWebContents`；开发态检查 `MAIN_WINDOW_VITE_DEV_SERVER_URL` origin                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `IPC_INVALID_PAYLOAD`                                                                                                         | zod 校验失败                                                                                                       | 对照 [api-reference.md](./api-reference.md) 入参                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `itc is unavailable` / `window.itc` 缺失                                                                                      | 网页模式或 preload 未注入                                                                                          | Electron 用 `dev`；网页用 try/catch 降级，见 [examples.md](./examples.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `corex-daemon not found` / start failed                                                                                       | 未 bootstrap                                                                                                       | `pnpm command sidecar bootstrap studio`；确认 staging 含 `corex-daemon.exe`                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 文档转换报「未安装 pandoc」                                                                                                   | 精简版不带 pandoc                                                                                                  | 「设置 → 工具」下载（或打包完整版 `make:full`，它内置这三个）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 对话报「未安装 OpenCode」                                                                                                     | 精简版不带 opencode（agent 运行时）                                                                                | 「设置 → 工具」下载；首次进对话时欢迎页也会给入口                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 工具下载失败（R2 不通）                                                                                                       | 在线源不可达（R2 域名被代理/DNS 掐掉），或换了 bucket                                                              | 先确认浏览器能开对应 `pub-*.r2.dev` 直链；声明在 `apps/studio/sidecar/manifest.json`，可用 `pnpm command sidecar manifest --verify` 核对                                                                                                                                                                                                                                                                                                                                                                                                            |
| 误以为本地 Nest 未启动                                                                                                        | 已去除 Nest                                                                                                        | 业务 API 配 `VITE_THINKING` 远程地址                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 模型选择器里「组织模型」置灰 / 不可用                                                                                         | 未配 `VITE_THINKING` 或无登录令牌                                                                                  | 配 `VITE_THINKING`（含 `/api/v1`）并登录；规则见 [architecture.md](./architecture.md#4-对话一条链路两种模型来源)                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 发送前提示「未选择模型」                                                                                                      | 没选模型，或网关目录为空                                                                                           | `GET ${VITE_THINKING}/gateway/models` 应为非空（服务端需启用模型），再到模型选择器里选一个                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 网关对话报服务端 `msg`（如 `300001` / `400001`）                                                                              | 网关失败也是 HTTP 200 信封，不是网络错误                                                                           | `300001` = 未登录/令牌失效（`sub` 必须是 UUID）；`400001` = 模型名不存在；`200003` = 参数无效（如后台建了叫 `auto` 的模型）；`400006` = 当日配额用尽。失败信封由 `opencode/events.ts::describeOpencodeError` 按 `msg` 翻成错误                                                                                                                                                                                                                                                                                                                      |
| 网关对话报 `400006` 配额已用尽                                                                                                | 该租户当日（UTC）令牌额度用完                                                                                      | 看「设置 → 额度」的档位与用量；等服务端调档或加订阅后重试，见 [online-models.md](./online-models.md#74-免费用量--付费用量配额--订阅)                                                                                                                                                                                                                                                                                                                                                                                                                |
| 刚登录却回「未登录或登录已过期，请重新登录后再用组织模型」                                                                    | 这次运行没带上平台令牌：携带判定依赖了易失的解析缓存，或旧的在途响应误清了新令牌                                   | 见下文「[刚登录却提示「登录已过期」](#刚登录却提示登录已过期)」；改代码后要重启 dev 清掉新旧模块图                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 网关对话报 `600005` 上游不可用                                                                                                | 供应商 `baseUrl` 不通，或请求被本机系统代理拦截（返回 502 空 body）                                                | 先在服务端机器上 `curl <baseUrl>/chat/completions`；网关已对供应商请求关掉代理（`ClientBuilder::no_proxy`），若上游确实要走代理则改供应商地址                                                                                                                                                                                                                                                                                                                                                                                                       |
| 错误只显示 `Response stream ended without a finish reason.`                                                                   | 失败信封没被翻成异常（`describeOpencodeError` 未认出这个形状）                                                     | 看 [events.ts](../../../apps/studio/src/host/capabilities/opencode/events.ts) 的 `describeOpencodeError` 是否覆盖该形状；渲染层兜底在 [assistant/protocol.ts](../../../apps/studio/src/host/capabilities/assistant/protocol.ts) 的 `findErrorMessage`                                                                                                                                                                                                                                                                                               |
| 在线对话报 `600005` 上游不可用                                                                                                | 供应商 `baseUrl` 不通，或请求被本机系统代理拦截（返回 502 空 body）                                                | 先在服务端机器上 `curl <baseUrl>/chat/completions`；网关已对供应商请求关掉代理（`ClientBuilder::no_proxy`），若上游确实要走代理则改供应商地址                                                                                                                                                                                                                                                                                                                                                                                                       |
| 设置页看不到「平台」分组                                                                                                      | 令牌 payload 的 `role` 不是精确的 `ADMIN`                                                                          | `isAdmin()` 只认 `role === "ADMIN"`；普通用户看不到入口（服务端也会回 `300006 权限不足`）                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 审批弹窗不出现 / `readonly` 档下命令照跑                                                                                      | 配置里的 permission 没生效（改配置没重启 server / 档位没切过去），或工具的 action 没在规则表里点名而落到兜底规则上 | permission 随 `OPENCODE_CONFIG_CONTENT` 注入、**不能热改**：改了要么重启 server，要么靠 `switchAgent` 换档；action 未点名时按 `mutating` 处理，见 [security.md](./security.md#61-v2-里工具可见性只由-permission-决定)                                                                                                                                                                                                                                                                                                                               |
| 对话报 `Missing key at ["prompt"]` / 变更卡报 `UnsupportedContentType`                                                        | **staging 里的 opencode 是 v1**（`@opencode/client` 是 v2）：v1 server 把 v2 请求体当校验错误吐回来                | 看 `apps\studio\sidecar\staging\<platform>\checksums.json` 里 `opencode.exe` 那条的 `version`（落盘清单逐文件记 `tool` + `version`，应为 **2.0.15**；pin 在 `tools.lock.json`）；不对就 `pnpm command sidecar opencode` → `pnpm command sidecar stage studio` → **重启 studio dev**，见 [online-models.md](./online-models.md#73-agent-运行时--内嵌的-opencode-本体)。铁证在 server 侧日志 `<userData>\opencode\data\opencode\log\opencode.log`：出现 `"schema rejection" kind=Payload reason="Missing key at [\"prompt\"]"` 就是 v1 在拒收 v2 请求体（该字符串只可能由 server 打印，客户端报错只是它的回声） |
| `better_sqlite3.node` ABI 不匹配（`NODE_MODULE_VERSION` 137/147 vs 149）、IPC `handler failed`                                | 二进制被为宿主 Node 构建的版本覆盖（跑了裸 `pnpm rebuild` 这类命令）                                               | `pnpm --filter @i-thinking/studio run rebuild`（= `electron-rebuild -f`），再用 `pnpm --filter @i-thinking/studio test:db` 验证；见 [development.md](./development.md#8-数据库--原生模块)                                                                                                                                                                                                                                                                                                                                                           |
| 整页变成 React Router 默认错误页：`Maximum update depth exceeded`，devtools 先报 `The result of getSnapshot should be cached` | `useAuiState` 选区每次返回**新对象/新数组**（底层是裸 `useSyncExternalStore`，无 equality，比对恒不等）            | 选区只返回原始值或 store 原引用，派生对象放到选区外的 `useMemo`；见下文「`useAuiState` 取值必须稳定」                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 发送后界面一直「生成中」，主进程日志 `rejected port start request`                                                            | 单次请求超端口上限（> 200 条消息 / 单条正文 > 100000 字符 / 整包 > 1MB）                                           | 长会话新开一个；超限的 `start` 现在会回 `error` 事件（不再静默丢弃），文案里写明是哪个上限                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 点开左侧会话看不到历史 / 新会话首条消息丢失                                                                                   | 会话 id 是**落库后**才有的：写路径拿不到 id，消息会连一条日志都不留地丢掉                                          | 见下文「[点开左侧会话看不到历史](#点开左侧会话看不到历史)」与「[新会话首条消息丢失](#新会话首条消息丢失--foreign-key-constraint-failed)」                                                                                                                                                                                                                                                                                                                                                                                                           |
| `make:msi`：`Could not find light.exe or candle.exe`                                                                          | 未装 WiX Toolset **v3**，或 PATH 未含其 `bin`                                                                       | 管理员 PowerShell：`choco install wixtoolset --version=3.14.0 -y`，新开终端后 `candle -?` / `light -?`；`make:msi` 会经 `run-forge.ts` 尝试注入常见 WiX bin；详见 [packaging.md](./packaging.md#安装-wix-toolset-v3打-msi-必装)                                                                                                                                                                                                                                                                                                                  |
| MSI 升级装不上 / 并排多份「i thinking」                                                                                         | `upgradeCode` 未固定（旧配置每次 random）或与现网包不一致；或旧 **per-machine** 与新 **per-user** 互不升级 | 使用钉死的 `WIX_UPGRADE_CODE` 重打；管理员卸载旧「(Machine - MSI)」后再装；日常优先 NSIS                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| MSI 标题是「i thinking (Machine - MSI)」/ 装到 Program Files 报 **1303**                                                         | 上游模板写死 Machine 文案，且 `InstallScope=perUser` 会删掉 `MSIINSTALLPERUSER`，ProgramFiles 不重定向 | 需带 `patchWixCreatorForPerUser`（`forge/makers.ts`）的新 MSI；管理员卸载旧包。见 [packaging.md](./packaging.md#何时用-nsis-vs-msi重要)                                                                                                                                                                                                                                                                                                                                                                                         |
| MSI 安装报错 **2349**（程序包有错 / Copy resumed with different info）                                                             | CAB 损坏、安装中断后换包续装、或与残留 Machine 包冲突；Forge WiX 对大 Electron 包本身也脆 | 1）管理员卸载所有旧 Studio MSI；2）用当前仓库重打的 MSI，或直接装 **NSIS** `out/studio/make/nsis/x64/*Setup*.exe`；3）勿混用中断的缓存安装。日志：`msiexec /i xxx.msi /l*v %TEMP%\studio-msi.log`                                                                                                                                                                                                                                                                                                                                              |
| MSI 装完开始菜单不在「i thinking」/ 要管理员才能装                                                                               | 未走当前 MakerWix 配置                                                                                             | 确认 `STUDIO_MAKE_WIX=1` / `make:msi`；应对齐 Client：`shortcutFolderName` + `defaultInstallMode: perUser` + `patchWixCreatorForPerUser`，见 [packaging.md](./packaging.md)                                                                                                                                                                                                                                                                                                                                                                                                 |
| NSIS 安装覆盖失败（文件被占用）                                                                                                   | `corex-daemon.exe` 仍在跑                                                                                          | 安装器 hooks 会 `taskkill`；若仍失败请先退出 Studio；见 `apps/studio/nsis/installer-hooks.nsh`                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 自动更新查不到 / 不下载                                                                                                           | feed 未配或仍按旧 Squirrel（`RELEASES`）部署                                                                       | 改用 `latest.yml` + Setup.exe；设 `STUDIO_UPDATE_URL` 或 `STUDIO_S3_UPDATE_BASE`；见 [packaging.md](./packaging.md#6-自动更新electron-updater)                                                                                                                                                                                                                                                                                                                                                                                           |
| `make` / `make:msi`：`[sass] JSONError … package.json … trailing comma`                                                       | `apps/studio/package.json` 有尾逗号，sass 严格解析失败                                                             | 去掉尾逗号；`node -e "JSON.parse(require('fs').readFileSync('apps/studio/package.json','utf8'))"` 应无报错；见 [packaging.md](./packaging.md#makemsi-常见失败已踩坑)                                                                                                                                                                                                                                                                                                                                                                                |
| 默认 `make`（精简版）安装包仍 500MB+，含 pandoc/ffmpeg/opencode/goose                                                          | staging 的 `checksums.json` 是旧版（没有逐文件 `onDemand`）或 `tools.lock.json` 里那几个工具的 `onDemand` 丢了                                                            | `pnpm command sidecar stage studio` 后重打；日志应有「未随包：pandoc.exe…」；见 [packaging.md](./packaging.md)                                                                                                                                                                                                                                                                                                                                                                     |

## createRequire / import.meta.url（详解）

`package.json` 为 `"type": "commonjs"`，Forge Vite 默认将 main 打成 **CJS**。源码里的：

```ts
createRequire(import.meta.url)
```

可能被编译成：

```js
createRequire({}.url) // undefined → 崩溃
```

正确做法：`findAppRequire()` / `findBundleDir()`（基于 `process.argv[1]` 与 `APP_ROOT`）。窗口 preload 路径同样用 `findBundleDir()`。

Preload 在 `sandbox: true` 下保持 CJS bundler 产物。

## `useAuiState` 取值必须稳定

`@assistant-ui/store` 的 `useAuiState` 就是**裸**的 `useSyncExternalStore(subscribe, () => selector(state))`——没有 selector 记忆化，也没有 equality 比较。React 会在每次 commit 后重新调用 `getSnapshot()` 用 `Object.is` 比对：

选区返回 `{...}` / `[...]` / `.filter()` / `.map()` 或任何函数新建的对象 → 比对恒为 false → `forceStoreRerender` → 再比对 → 嵌套更新超限，抛 `Maximum update depth exceeded`，整页被 React Router 默认 `ErrorBoundary` 接管。

规则：**选区只返回原始值或 store 里的原引用**，派生对象在选区外用 `useMemo`。

```ts
// ✗ 每次返回新对象：线程里一旦有带 usage 的消息就整页崩溃
const usage = useAuiState((state) => readUsage(state.thread.messages.at(-1)?.metadata))
// ✓ 返回原引用，再派生
const message = useAuiState((state) => findUsageMessage(state.thread.messages))
const usage = useMemo(() => readUsage(message?.metadata), [message])
```

参考实现 [usage.ts](../../../apps/studio/src/features/chat/usage.ts) 的 `findUsageMessage`，回归用例在 [usage.test.ts](../../../apps/studio/src/features/chat/usage.test.ts)（断言「连续两次调用返回同一引用」）。手写 `useSyncExternalStore`（如 [host.tsx](../../../apps/studio/src/components/contextmenu/host.tsx)）同理：`getSnapshot` 必须返回模块级/缓存的原对象。

## 新会话首条消息丢失 / `FOREIGN KEY constraint failed`

现象：新建会话里发第一条消息，界面看着正常，库里没有任何消息；约半分钟后助手那条写入报
`chat:message.toAppend ... FOREIGN KEY constraint failed`，运行以 `Step interrupted` 收尾。

原因：DB 会话 id **落库后**才存在，而写历史时读到的 `threadListItem.getState().remoteId`
可能还是 promotion / reconcile 之前的旧快照（空）。拿空 id 去写就是外键失败，而 assistant-ui
会吞掉历史写入的 rejection（`void historyWrite?.catch(() => {})`）—— 用户消息静默丢失，
助手消息的 `parentID` 于是指向一条从未落库的消息。更隐蔽的一种：`{ threadID: undefined }`
过结构化克隆时字段直接被丢掉，主进程只看到「缺字段」，同样零日志零落库。

规则（`ThreadIdentity`，契约与用例见 [packages/chat/README.md](../../../packages/chat/README.md)
与 [`thread-history.ts`](../../../packages/chat/src/adapters/thread-history.ts)）：

- `ensure()` —— 写路径（`append`、`findHost`）用。需要时建行，并按**线程 id** 缓存结果，
  缓存**永不清除**：promotion 落地后 `remoteId` 可能还没发布到列表项快照，落地即清会让紧随的
  写入再建一条会话行（消息在 1 号会话、用量记在 2 号会话）。
- `resolve()` —— 读路径（`load()`）用。只解析、不建行：给不存在的会话 `initialize()` 会凭空
  造出空会话，点开侧栏任何一项都多一行。
- 两者都拿不到 id 就**明确失败**：`requireThreadID` 先
  `console.error('[CHAT] 会话 id 解析失败，本条历史写入被丢弃')` 再抛。渲染进程 console 已转发到主进程日志
  （`window/factory.ts` 的 `attachConsoleForwarding`，`STUDIO_DEBUG=1` 时连 info/debug 一起收），
  日志里表现为 `renderer: [CHAT] …`。

复现后先看主进程日志里的 `CHAT_MESSAGE_APPEND_FAILED`：它会把 `sessionID` / `parentID` 各自
是否在库一并报出来，据此判断是「会话 id 不对」还是「父消息那步丢了」。
DB 取证（只读，别碰用户的库）：
`Copy-Item "$env:LOCALAPPDATA\com.cogito.client\cogito-client.db*" $env:TEMP\probe\` 后用
python `sqlite3` 查 `chatSession` / `chatMessage`（Node 跑不了 better-sqlite3，ABI 不同）。

## 点开左侧会话看不到历史

现象：点开一个会话，中间的欢迎页 / 空白照样在，历史读不出来。

先分两类，别急着改读取链路：

1. **库里本来就没有消息**（`chatMessage` 计数为 0）。这是上面那类静默失败的存量会话，
   救不回来 —— 旧版映射 `%APPDATA%\i thinking\opencode-sessions.json` 里也查不到它的键
   （该文件按 studio 线程 id 记 `{sessionID, messageCount}`），引擎侧没有可回填的会话。
   现在这种情况不再摆欢迎页，会明说「这个会话没有历史消息」
   （[welcome.tsx](../../../apps/studio/src/views/agent/chat/components/welcome.tsx)）。
2. **库里有消息却没读出来**：核对读取用的 id —— 读历史必须用
   `useSessionID()`（列表项 `remoteId`，[session.ts](../../../apps/studio/src/features/chat/session.ts)），
   `useThreadKey()` 是本地线程 id，只用来区分界面状态（如「这是新会话吗」）。

取证顺序：`chatMessage` 行数 → `opencode-sessions.json` 里有没有这个线程 id 的键 → 该线程最近的
运行请求 `host.sessionID` 与库里 `chatSession.id` 是否一致。

## 刚登录却提示「登录已过期」

现象：刚登录成功（`/auth/profile`、配额、模型目录都 200000），发消息却回
`未登录或登录已过期，请重新登录后再用组织模型`。这句唯一来源是主进程的
[`assistant/model.ts`](../../../apps/studio/src/host/capabilities/assistant/model.ts)
（`resolveConnection`）：平台行要求 `credentials.platformToken`，拿不到就回这句。
所以「报过期」只说明**这次运行没带令牌**，不代表令牌无效。

两条成因（都在客户端，已修）：

1. 渲染侧凭据判定依赖了 [port/model.ts](../../../apps/studio/src/features/chat/port/model.ts)
   按运行目标记下的那份解析缓存（`resolvedTargets`）。缓存只该用来读「模型能力」这类声明；
   一旦缓存没命中（HMR、新旧模块图并存）kind 读不到，`findHostOptions` 就静默丢令牌。
   现在认平台行以固定 id 为准（`isPlatformTarget`），缓存只加速不决定凭据，
   详见 [port/instance.ts](../../../apps/studio/src/features/chat/port/instance.ts)。
2. [account/session.ts](../../../apps/studio/src/features/account/session.ts) 的 `readAuthProfile`
   曾经「一失败就清令牌」：陈旧的在途 300002 响应会清掉刚写入的新令牌。
   现在只清「发起请求时那一枚」（`clearAuthTokenIfCurrent`）。

判定与文案收紧：平台模型缺地址/缺令牌时，发送闸门
（[quota/gate.ts](../../../apps/studio/src/features/quota/gate.ts)）先拦下并给出可执行文案，
不再让用户等到主进程那句「登录已过期」。

取证要点（下次再遇到，按这个顺序）：

- 服务端**业务码在 HTTP 200 的包体里**（300001 未登录 / 300002 凭证无效 / 300003 过期 /
  400006 配额超限），按 HTTP 状态看不出问题，要读 access log 的包体字段。
- 日志里**完全没有 `/gateway/chat/completions`** ⇒ 请求根本没到网关，问题在客户端携带/闸门，
  不用去查网关与上游。
- 用户 UA 区分流量来源：`Mozilla/… Electron/…` 是应用，`node` 是调试探针；探针会污染日志与
  本地存储，分析前先核对文件 mtime 与 UA。
- 令牌存储：`%APPDATA%\i thinking\Local Storage\leveldb\`。确认只有预期 origin 在写
  `auth-token`，就排除了「多窗口/origin 分裂」。
- 直接验令牌仍然有效：用当前令牌打 `GET /auth/profile`，看业务码是否 200000。
- 日志/工具输出里 JWT 会显示成 `******`：那是调试输出层的脱敏，不是磁盘内容，别据此判断令牌坏了。

处理：改完这些代码要**重启 dev**（`pnpm --filter @i-thinking/studio dev`）——旧模块图与残留的
历史错误气泡都只存在内存里，不重启看不出来。

令牌**本地过期**同样处理：`findAuthToken` 会跳过 `exp` 已过的令牌（缺 `exp` / 脏令牌判不了，
按「未过期」处理，交给服务端去否）。否则界面一直显示「已登录」，却每个接口都回「登录已过期」。

## 主进程日志在哪

`%APPDATA%\i thinking\logs\main-YYYY-MM-DD.log`，按天一个文件，单文件到 4MB 后写一行说明即停。

主进程的 `console` 与 logger 输出都落在这里，**包括入站校验失败时 zod 的字段路径** ——
以前这些只进启动 app 的那个终端，用户报障时早滚没了，只能靠服务端日志反推。
实现见 [log-file.ts](../../../apps/studio/src/host/framework/log-file.ts)。

- 目录里没有文件、终端只有一行 warn ⇒ 日志目录建不出来（磁盘/权限），已降级成只走 stdout。
- 想连 `log.debug` 一起收：启动时带 `STUDIO_DEBUG=1`。

## 发消息没有任何反应 / 只回一句「请求被拒绝」

有**三处**会在请求离开 studio 之前把它拦下，留痕位置各不相同：

| 拦截点                                                                                                      | 留痕                                                                                                  |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 渲染侧发送闸门（[quota/gate.ts](../../../apps/studio/src/features/quota/gate.ts) 的 `findSendBlocker`）     | 界面气泡，主进程无日志                                                                                |
| 主进程端口校验（[assistant/protocol.ts](../../../apps/studio/src/host/capabilities/assistant/protocol.ts)） | 日志里 `[assistant-protocol] 入站消息形状不合规：host.sessionID: …`、`rejected port start request: …` |
| 主进程凭据解析（[assistant/model.ts](../../../apps/studio/src/host/capabilities/assistant/model.ts)）       | 回话 `未登录或登录已过期，请重新登录后再用组织模型`                                                   |

所以第一步永远是看**服务端 access log 有没有 `/gateway/chat/completions`**：一条都没有 ⇒
问题在上面三处之一，与网关、上游无关，别去查上游。

被拒文案分成两类，别再混为一谈：

- **内容超限**（条数/正文/整包）：说清三个上限，并给出「请新开会话继续」这条出路。
- **形状不合规**（缺字段、类型不对）：提示客户端与主进程版本可能不一致，**请重启应用**。
  这类以前也说「请新开会话」，纯属误导 —— 换个会话照样发不出去。

## 另一个窗口登录了，agent 窗口还显示「未登录」

令牌存在同一份 `localStorage`（所有窗口同 origin、同默认 session，没有 `partition` 分裂），
但**只有写入的那个窗口会收到自己写入的通知**。别的窗口要跟进，必须监听 `storage` 事件 ——
漏了这一层，登录/登出就只影响当前窗口：agent 窗口的左栏底部一直挂着登录前的假头像。

`subscribeAuthToken`（[utils/auth.ts](../../../apps/studio/src/utils/auth.ts)）现在两头都接：
本窗口写入直接广播，别的窗口写入靠 `window.addEventListener('storage')`。首个订阅者挂监听、
最后一个订阅者摘掉，`storage` 的 `key === null`（整份清空）也按令牌变化处理。

光有令牌还不够：资料、配额、可用模型清单都**按「谁在登录」作答**，而每个窗口一份 query cache。
所以作废缓存也统一挂在根 Provider 上（`useAuthCacheSync`，见 [components/provider/query.tsx](../../../apps/studio/src/components/provider/query.tsx)
与 `features/account/session.ts`），令牌一变就重建这些读数；写在登录按钮的回调里会漏掉两条路径：
组件跳转时立刻卸载（失效被跳过）、以及别的窗口登录（回调根本不在那个窗口跑）。

本条一律以 `TokenStorage` / `useAuthToken()` 为准，别拿 localStorage 的原始值做判断（两者编码方式不同）。

排查顺序：① 界面是否在 `subscribeAuthToken` 覆盖范围内；② 两个窗口的 origin 是否一致
（`window.location.origin`）；③ 有没有代码给窗口传了 `partition` 从而共享不到 localStorage。

## 选中的模型「没了」：界面和运行各说各话

设置里存的是 providerID + 模型 id，两者都可能过期：BYOK 行被删、服务端目录下架或改名。
发送前不校验的话，主进程按名字查目录会直接报错，或静默落到兜底模型上 —— 而菜单里还写着
旧名字。`port/model.ts` 现在两头都收紧：

- `resolveTarget` / `findEffectiveModel`：设置里的模型覆盖只在**该行认得它**时才算数
  （`models` 为空的 BYOK 行无从校验，一律放行），否则退回该行默认模型。
- `findTarget()`：按 `findSelectionRepair` 把结论**写回设置**（行没了 → 切回「自动」；
  模型下架 → 清掉覆盖），并 toast 说明换了什么。不写回去，两边永远对不上。

关键坑：「行还在不在」必须拿**未过滤**的 provider 清单判。平台行在未登录 / 未配
`VITE_THINKING` 时会被 `dropStalePlatformRow` 滤掉，那只是暂时不给用；按已过滤清单自愈会把
用户「我用组织模型」的选择永久改写成自动。

## 平台额度一直是 0 / 用量数字看着不动

先看用的是哪条链路，两个口径只差在「占不占额度」：

| 口径     | 谁在记                                                    | 计不计入平台额度                                 |
| -------- | --------------------------------------------------------- | ------------------------------------------------ |
| 平台额度 | 服务端 `GET /gateway/quota/me`（Redis UTC 日窗）          | 是，且只计 `platform-gateway` 那一行发出的请求   |
| 本机账本 | studio 自己记（`chatUsage`，每轮 `engine.settle` 记一笔） | 否，本机模型、自备密钥（BYOK）的模型都只落在这里 |

所以「发了很多但平台额度是 0」通常是**对的**：查一下 `chatUsage` 的 `providerID` / `source`，
`source = local` 的那几笔来自 BYOK 行（例如 `kind = deepseek` 的 `deepseek-flash`），
平台额度不计它们 —— 模型菜单的分组标题也写着这条差异（组织模型 · 走平台网关，占用平台额度／
我的模型 · 用你的密钥，不占平台额度），额度面板里同样写着「本机模型与自备密钥的模型不占额度」。

同一个模型名（例如 `deepseek-flash`）在两组里**各有一份**，选哪一组决定计不计额度：要占额度就选
「组织模型」那个，只进本机账本就选「我的模型」那个。

dev 态下平台额度问的是**本机 service**（`.env.development` 的 `VITE_THINKING`，通常是
`http://127.0.0.1:3000/api/v1`，provider 行的 `baseUrl` 同样指向它），与线上账号的额度互不相干。

### 数字什么时候刷新

- 对话结束（运行态 true → false）自动拉一次：`features/chat/usage.ts` 的
  `useRefreshOnRunEnd`（它同时清掉发送前拦截的缓存判定）。
- 手动：额度弹层、右栏「用量」「平台额度」卡片、设置 → 额度，各有一颗刷新按钮；
  额度弹层与设置页还会显示「更新于 HH:mm:ss」，数字没动时用它确认到底有没有取到新值。

### 用量与额度存在哪里

| 数据     | 位置                                                                                          |
| -------- | --------------------------------------------------------------------------------------------- |
| 本机账本 | `%LOCALAPPDATA%\com.cogito.client\cogito-client.db` 的 `chatUsage`（与 Tauri 版 client 共用） |
| 平台额度 | 服务端 `services/gateway`，studio 只读镜像（`GET /gateway/quota/me`）                         |

## IPC 信任排查步骤

1. 是否 Electron 窗口（非 `dev:core`）？
2. Main 日志是否有 `rejected untrusted sender`？
3. 开发态：页面 URL 是否与 Vite origin 一致？
4. 生产：是否 `file:` 协议加载本地页面？

## 相关文档

- [开发指南](./development.md)
- [安全](./security.md)
- [打包](./packaging.md)
- [API 参考](./api-reference.md)
