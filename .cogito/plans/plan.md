按下面的计划开始执行。
以目标模式推进，最多 12 轮，中途不要停下来问用户。
约束以我前面消息里说的为准（不要/保持/只能/不能 这类），开工前先复述一遍。
执行要求：

1. 严格按计划的阶段顺序推进：一个阶段没做完，不要开始下一个；
2. 计划里点名的每个文件、命令、接口和契约都要真正落地，不要留占位、不要只做示例；
3. 计划里写了「验证」的，全部阶段完成后逐条跑一遍并汇报结果；
4. 「待确认」项按计划里的默认选择执行，不要停下来反问。


===== 计划全文 =====
I'll investigate the codebase in read-only mode to build this plan.
\# cogito 桌面端健壮性优化计划：Embedding 崩溃 / 精简打包 / 日志上报 / 错误边界

\## 概述

本计划针对 cogito 桌面端（Tauri，`apps/client`）四类问题做一轮集中加固，**先让故障可见，再逐项止血**：

1. 知识库 Embedding 开启后卡死、主进程退出、`corex-daemon` / `goose` 变孤儿进程 —— 根因链已基本定位：`lancedb` 调用无隔离 + `[profile.release] panic = "abort"` 让任意 panic 直接 abort 整个进程，而 sidecar 清理只挂在 `RunEvent::Exit`，abort 绕过了它；
2. 精简版 / 完整版打包档位 —— studio（Electron）已有 `SIDECAR_VARIANT`（lite/full），client（Tauri）完全没接，`tauri.conf.json` 把 `goose` / `ffmpeg` / `pandoc` / `pdfium` 写死进包；
3. 日志近乎为空、崩溃零痕迹 —— Rust 侧全仓用 `tracing::*` 但没把 `tracing` 桥到 `log`（tauri-plugin-log 只装 `log` facade），且 release 是 `panic=abort` + `windows_subsystem="windows"`，panic 文本连 stderr 都看不见；`cogito.log` 里自然几乎什么都没有，更谈不上上报；
4. ErrorBoundary 覆盖不到位 —— 根边界在 `App` 内部（App 自己的 hooks 在边界外）、`main.tsx` 的 bootstrap 没有 try/catch、路由无 `errorElement`；overlay 窗口更危险：`PING_TIMEOUT_MS` 是 3 分钟且只在下次 `overlay:ensure` 才判定，截屏态挂掉后 `through/worker.rs` 会持续把 `should_ignore` 钉成 `false`，透明置顶层吃满全屏点击。


做法上：**不引入新框架**。日志用 `tracing` 的 `log` 特性 + 自写 panic hook；上报复用 `apps/service` 既有的 `POST /api/v1/exception`（由前端转发，复用现有鉴权 / 租户 / 代理）；向量库先做「进程内隔离 + 串行 + 超时 + 维度校验」，并把 `lancedb` 收成 Cargo feature（lite 档不带，同时吃掉可观的包体积）；打包档位把 studio 的 lite/full 语义搬到 client 的构建脚本与发布流水线。

影响面：`apps/client/src-tauri`（日志、vectorstore、overlay、capabilities 命令、Cargo.toml）、`apps/client/src`（diagnostics 桥、ErrorBoundary 体系、embedding 交互、设置页诊断分区）、`apps/client/scripts` 与 `tauri.conf.json`（打包档位）、`.github/workflows/client-release.yaml` 与 `apps/distribution`（默认只发 slim）。不触碰 studio、service、mobile 的业务代码。

\## 现状与问题

\### 1) Embedding 卡死 → 主进程退出 → sidecar 成孤儿

| 位置 | 现状 | 为什么不行 |
| --- | --- | --- |
| `apps/client/src/views/knowledge/lib/vector-store.ts:101` `searchVectors` / `:177` `upsertPageEmbeddings` / `:235` `countVectors` | 每个操作直接 `invoke('vector_*')`，无超时、无取消、无串行化；`upsertPageEmbeddings` 用 `config.concurrency`（默认 2）并发 worker | 并发 `vector_upsert` 会同时 delete+add 同一个 Lance 数据集；任何一次 invoke 挂住，前端 Promise 永不 settle（表现为「设置页卡住、转圈不出数」） |
| `apps/client/src-tauri/src/knowledge/vectorstore.rs:24` `db_path` / `:70` `vector_upsert` / `:118` `vector_search` | 每次调用 `connect()` 新建连接，再 `table_names` → `open_table` → `delete`（全表条件删除）→ `add` | 写入放大、连接开销大；**没有维度校验**：换 embedding 模型后 `FixedSizeList(dim)` 与查询向量长度不一致，arrow/lance 侧直接 panic |
| `apps/client/src-tauri/Cargo.toml` `[profile.release] panic = "abort"` | 任意 panic → `std::process::abort()` | 不 unwind → `RunEvent::Exit` 不执行 → `utils/sidecar.rs:191` `shutdown` 与 `utils/goose_serve.rs:349` `shutdown` 全被跳过 → **corex-daemon / goose 留在后台占资源**，正是用户观察到的现象 |
| `apps/client/src/views/knowledge/lib/ingest-queue.ts` → `ingest-runner.ts:162` | `embedOnIngest`（默认 `true`）在 ingest 后立刻批量 upsert | 打开「启用」开关只写 localStorage（`embedding-config.ts`），下一次 ingest 立刻触发全量 embedding，用户没有「先探测端点 / 先小额试」的机会 |
| `apps/client/src/views/knowledge/surface/settings.tsx:188` `SettingsTab` | 进入 embedding 分区就 `countVectors()`；开关 `onCheckedChange` 直接落盘 | 只要库目录存在一个坏掉/半写的 lancedb 目录，进设置页就会触发上面那条脆弱的链路 |

\### 2) 精简版 / 完整版

\- `apps/client/src-tauri/tauri.conf.json` `bundle.externalBin` 固定 `corex-daemon / corex-mcp / cogito-mcp / goose`，`bundle.resources` 固定 `pdfium.dll / pandoc.exe / ffmpeg.exe / ffprobe.exe` —— 没有任何档位概念，一次 `tauri build` 全带。
\- studio 侧已有可复用语义：`apps/studio/forge/env.ts` 的 `SIDECAR_VARIANT`（默认 `lite`）+ `apps/studio/forge/hooks/sidecar.ts` 按 `onDemand` 逐文件裁剪与 SHA-256 校验 + `NEVER_BUNDLE`。client 没有对应实现。
\- 发布链路本身已失修：`.github/workflows/client-release.yaml` 的 env 仍按 `binaries/corex-serve-x86_64-pc-windows-msvc.exe` 与 `binaries/SHA256SUMS` 校验，而 `scripts/commands/features/sidecar/targets/client.ts` 现在产出的是 `corex-daemon-<triple>.exe` 等，且仓库内 `apps/client/src-tauri/binaries/` 只有 `.gitkeep` —— 该步骤无法通过，"默认精简版"也就无从谈起。
\- 运行期缺件语义不友好：`apps/client/src-tauri/src/media/command.rs:68` `find_tool_path` 找不到就返回 `"请确认 sidecar 已 bootstrap（FFmpeg 9.0.2）"`，这是开发者文案，终端用户看不懂。

\### 3) 日志与上报

| 位置 | 现状 | 为什么不行 |
| --- | --- | --- |
| `apps/client/src-tauri/src/app/plugins.rs:11` `configure_log_levels` / `:33` `register_plugins` | 只给 tauri-plugin-log 配 `LevelFilter::Info` + `Stdout` + `LogDir` | 这是 **`log` facade**。全仓 Rust 用的是 `tracing::info!/warn!/error!`（`utils/sidecar.rs`、`utils/goose_serve.rs`、`overlay/command.rs:72`、`through/worker.rs` 等）。workspace 的 `tracing = "0.1.44"` 未启用 `log` 特性 → **这些事件默认被丢弃**，这是 `cogito.log` 稀少的主因（若被依赖树的 feature 统一偶然打开，也属不可控） |
| `apps/client/src-tauri/src/main.rs:10` `main` | 没有 `std::panic::set_hook` | release 下 `panic=abort` + `windows_subsystem="windows"`，panic 文本既不落盘也看不见 |
| `apps/client/src/utils/exception-report.ts:169` `installExceptionReporting` / `:103` `reportException` | 有 window error / unhandledrejection → `POST /api/v1/exception` | 只是**在线**上报：没本地落盘、没有崩溃现场批量补报、`isReporting` 单飞会直接丢事件；Rust 侧崩溃完全没有通道 |
| 无 clean-exit 标记 | 启动时没有任何"上次是否正常退出"的记录 | abort / 被杀 / OOM 三种情况全都无痕，用户只能描述"它自己没了" |
| WebView2 渲染进程 | 主窗没有心跳，overlay 有但阈值 3 分钟（`overlay/state.rs` `PING_TIMEOUT_MS`） | 白屏/挂死要等用户主动再触发一次操作才可能发现 |

`apps/service` 侧能力已够用（`apps/service/src/services/exception/schema.rs` `WriteP`：`eventID` 幂等、`message ≤2000`、`stack ≤20000`、`context` 任意 JSON、`source/level/release/environment`），不需要新增服务端接口。

\### 4) ErrorBoundary

| 位置 | 现状 | 后果 |
| --- | --- | --- |
| `apps/client/src/App.tsx` | `<Fallback.ErrorBoundary>` 包住 `RouterProvider`，但 `useKeyboard/useCaptureCommands/useAutomationRunner` 在 `App` 函数体内 | 这些 hook 抛错时边界不在其外层 → 整树卸载，**白屏**，只剩 `onUncaughtError` 打 console |
| `apps/client/src/main.tsx:51` `bootstrap` | `ensurePersist/ensureSecrets/dict.bootstrap` 无 try/catch，失败就不 render | 纯白屏、无任何 UI 提示 |
| `apps/client/src/components/fallback/ErrorBoundary.tsx:34` `componentDidCatch` | 只有「重试 / 刷新」；重试是 `setState({hasError:false})` | 确定性错误会立刻再抛（闪一下又回去），无次数上限、无 `resetKeys` |
| `apps/client/src/routers/index.tsx` | 路由没有 `errorElement`，磁贴视图都在 `WorkspaceShell` 之下 | 单个视图崩溃会带走整面磁贴墙 |
| `apps/client/src/views/overlay/boundary.tsx:76` | `OverlayBoundary` 渲染在 `OverlayShell` **内部** | `OverlayShell` 自己的 hooks（store selector、`useOverlayHostGuards`）抛错时同样逃逸，overlay 变成僵尸全屏窗 |
| `apps/client/src-tauri/src/overlay/command.rs:134` `overlay_ensure` + `overlay/state.rs` `PING_TIMEOUT_MS = 3min` + `through/worker.rs` | 只有下一次 `overlay:ensure` 才检查心跳；截屏态下 `should_ignore` 被钉成 `false` | 截屏浮层挂掉后，透明置顶窗**持续吃满全屏点击**，用户「点哪都没反应」，只能杀进程 |
| `apps/client/src/features/capture/capture-error-boundary.tsx` | 生产环境 `render` 返回 `null`，只靠 `onError`（→ `toScreenshotExit`） | 若 `onExit` 自身失败（store/IPC 异常），窗口仍在前台吃点击 |

\## 方案

\### 关键取舍

| 议题 | 备选 | 选择 | 理由 |
| --- | --- | --- | --- |
| Embedding 崩溃隔离 | A. 进程内隔离（串行 + 超时 + 维度校验 + `catch_unwind`）<br>B. 把向量库挪到独立 sidecar 进程<br>C. 直接换 SQLite/JSON 余弦检索 | **A 先行，C 作为 lite 档默认**，B 只在上线后压测仍越界时再评估 | A 改动集中在一个文件 + 一处 profile；B 要新增进程、生命周期与 IPC（与本轮"止血"目标不符）；C 在 1e4 量级页面下完全够用，且天然不需要 arrow |
| `panic = "abort"` | 保留 abort（体积优先）<br>改 `unwind` | **改 `unwind`** | 没有 unwind 就没有 `catch_unwind`，任何第三方 panic 都是整个 App；代价是体积/性能小幅回退，可用 `opt-level="s" + lto` 抵消（Step 3 里量化） |
| 日志桥 | A. `tracing` 打开 `log` 特性<br>B. 引 `tracing-subscriber` 直写文件<br>C. 全仓替换成 `log::` 宏 | **A** | 零新依赖、零调用点改动；B 会与 tauri-plugin-log 双写/重复配置；C 改动面过大 |
| 崩溃上报通道 | A. Rust 落盘 → 前端读 → 复用 `POST /api/v1/exception`<br>B. Rust 用 reqwest 直连服务 | **A** | 复用现成 baseURL（`apps/client/.env.production` 的 `VITE_COGITO`）、Bearer、`X-Tenant-ID`、系统代理与信封解析；Rust 只管落盘，职责清晰 |
| 打包档位 | A. 生成 `tauri.generated.conf.json` 由 `--config` 合并<br>B. 构建前就地改写 `tauri.conf.json`<br>C. 维护两份 conf | **A** | 不污染受版本门禁的 `tauri.conf.json`；CI 改动小；C 会漂移 |
| slim 保什么 | 全裁 / 只裁体积大头 | **slim 保留 `corex-daemon` + `corex-mcp` + `cogito-mcp` + `pdfium` + `goose`，裁掉 `pandoc` / `ffmpeg` / `ffprobe`（及可选 `opencode`）** | goose 是 agent 运行时（`bootstrap.rs` 里无条件 `goose_serve::spawn_and_watch`），裁掉等于没有对话能力；ffmpeg/pandoc 是体积大头且可按需降级。**待确认项见下** |

\### 设计要点

\- **崩溃可读**：`main()` 最先安装 panic hook（token-helper 分支之后），把 `message/location/thread/backtrace` 写 `<appLocalData>/crash/<ts>-panic.json`，同时 `log::error!`；`[profile.release]` 改 `unwind` 后，线程内 panic 还能被 `catch_unwind` 降级成错误。
\- **孤儿进程兜底**：`RunEvent::Exit` 之外再加一道 —— 子进程退出检测改用「父进程 PID 探活」（`corex-daemon` 侧已有 pipe；goose 侧可传 `--parent-pid` 或由 watchdog 线程定期 `is_pid_alive`），即使 abort 也能在 N 秒内自尽；Windows 侧另在 NSIS hook（`src-tauri/nsis/installer-hooks.nsh` 已存在）保留 kill 兜底。
\- **档位单一来源**：`CLIENT_SIDECAR_VARIANT`（`slim`|`full`，默认 `slim`），一处解析三处消费：prepare-binaries（挑文件）→ generated conf（externalBin/resources）→ 运行期 `capabilities:probe`（UI 文案 + 功能降级）。
\- **错误边界三层**：`main.tsx` 的根边界（含 bootstrap）→ 路由 `errorElement`（含磁贴级 `compact`）→ 功能级（overlay/capture）；重试带次数上限与 `resetKeys`，并用 key 强制 remount 子树。
\- **overlay 逃生通道**：Rust 侧 watchdog（不依赖前端）—— 心跳 15s 未更新即 `set_ignore_cursor_events(true)` + `overlay:hide`，30s 仍无心跳则 `park`（真隐藏）+ 重建；全局 `Esc` 在 Rust 侧兜底（前端派发器挂了也能收起浮层）。

\## 实施步骤

1. **打通 Rust 日志 + panic 落盘（让一切可见）**

   改 `apps/client/src-tauri/Cargo.toml`（`tracing` 增 `features = ["log"]`）、`src/app/plugins.rs`（日志级别：默认 `Info`、`cogito` 目标 `Info`、`--verbose` 时 `Debug`；文件上限提升到 5MB，保留期沿用 `utils/log_retention.rs`）、新增 `src/utils/diagnostics.rs`（`install_panic_hook()` / `mark_running()` / `read_pending_crashes()` / `ack_crash()`，会话文件 `<appLocalData>/diagnostics/session.json` 记录 `running` → 正常退出写 `clean`），`src/main.rs:10` 与 `src/app/bootstrap.rs:28` 接线。
   验证：dev 构建里 `std::panic::set_hook` 之后手动触发一次 panic → `crash/*.json` 与 `cogito.log` 同时出现，且 `log` 里能看到 `utils/sidecar.rs` 的 `info!("正在关闭 corex-daemon…")` 这类既有 `tracing` 输出（若已在落盘，说明只缺级别，退化为只补 hook）。

2. **前端日志通道 + 崩溃补偿上报**

   新增 `apps/client/src-tauri/src/diagnostics/command.rs`（`diagnostics:append` 落同一日志文件、`diagnostics:pending` 列待报 crash、`diagnostics:ack` 删除、`diagnostics:capabilities`），在 `src/app/handlers.rs` 注册；新增 `apps/client/src/lib/diagnostics/`（`log-bridge.ts`：包 `console.warn/error` + `window.onerror`，限流 20 条/秒、单条 4KB、带当前 window label；`crash-report.ts`：启动时读 pending → `POST_EXCEPTION`（`source='client-desktop'`、`level='fatal'`、`fingerprint='panic|<location>'`、`context` 带 `logTail ≤8KB`、OS、版本、`sidecarVariant`）→ `ack`）；把 `src/utils/exception-report.ts:103` 的单飞 `isReporting` 换成小队列（失败退避，保留最近 50 条）。
   验证：手工放一个 pending JSON → 启动 → `apps/service` 的 `exception` 表出现该 `eventID`；重启不重复上报（`eventID` 幂等）；断网时不阻塞启动、日志里有「上报失败」记录。

3. **向量库调用隔离（先止血，不换栈）**

   改 `apps/client/src-tauri/src/knowledge/vectorstore.rs`：连接单例（`OnceLock` + `tokio::sync::Mutex`，写操作串行）、路径规范化为 `file://`、`vector_search` 先查表 schema 的 `FixedSizeList` 维度并与 `query_embedding.len()` 比对（不一致返回结构化错误而不是进 arrow）、每个 await 套 `tokio::time::timeout`（10s）、每次调用记录 `elapsed_ms` 与失败原因；`Cargo.toml` 的 `[profile.release] panic = "unwind"`；对 `lancedb` 调用包 `catch_unwind`（`AssertUnwindSafe`），panic 转 `Err` + `log::error!` + 上报。
   验证：注入一个 3 维伪造向量（表是 1536 维）→ 返回明确「维度不匹配」错误且进程存活；并发 8 个 `vector_upsert` 串行执行、无死锁；`cargo test -p cogito` 绿。

4. **前端 embedding 交互收敛（不再一点就炸）**

   改 `apps/client/src/views/knowledge/lib/vector-store.ts`（并发默认 1、每个请求 `AbortController` 超时、批量失败退避并可在中途取消）、`embedding-config.ts`（新增 `probeBeforeEnable`、`lastProbe`）、`surface/settings.tsx:188`（开关先探测端点（一次 8 token 的 `/embeddings`）再落盘，失败不启用并给可读文案；「已索引向量」只在启用时刷新，且走带超时的 `countVectors`；新增「重建索引 / 清空索引」显式按钮，不在挂载时隐式触发），`ingest-runner.ts:162`（embedding 失败不阻断 ingest 主流程，只记一条可上报的 warning）。
   验证：端点填错 → 开关不生效 + toast 明确；搜索时 endpoint 超时 → 8s 后返回 FTS 结果（降级）而不是卡死；`pnpm --filter @cogito/client unit` 中 vector-store 相关用例通过。

5. **打包档位 slim/full（包体积 + 运行期降级）**

   新增 `apps/client/scripts/prepare-binaries.ts`（读 `CLIENT_SIDECAR_VARIANT`，默认 `slim`；校验 `src-tauri/binaries` 下的文件与 `@cogito/sidecar` 清单一致；生成 `src-tauri/tauri.generated.conf.json`：`slim` 的 `externalBin` = `corex-daemon/corex-mcp/cogito-mcp/goose`、`resources` 只留 `pdfium.dll`，`full` 追加 `pandoc/ffmpeg/ffprobe`），改 `scripts/build.ts`（`tauri build --config tauri.generated.conf.json`）；新增 `src-tauri/src/system/capabilities.rs`（`capabilities:probe` 返回各工具存在性与版本）并注册；把 `media/command.rs:68` 与 PDF 管线的缺件错误改成「精简版未内置 FFmpeg（约 xx MB），可在 设置 → 诊断 中安装完整版」；设置页 `views/settings/constant.ts` 的 `NAVS` 增加「诊断」分区（能力清单、日志目录、一键反馈、上传开关）；同步 `.github/workflows/client-release.yaml`（`variant` input 默认 `slim`，把失修的 `corex-serve/SHA256SUMS` 校验换成 `pnpm command sidecar bootstrap client && pnpm command sidecar verify client`）与 `apps/distribution` 的 `publish:client`（默认只接受 slim 产物，`--allow-full` 显式覆盖）。
   验证：`pnpm build:client` 默认产物里不含 `ffmpeg.exe/pandoc.exe/ffprobe.exe`（脚本断言 + 手工列 bundle 目录）；`CLIENT_SIDECAR_VARIANT=full pnpm build:client` 三者齐全；两种包都能启动，slim 下触发 clipchamp 导出/PDF 转换得到可读提示而非崩溃。

6. **ErrorBoundary 体系加固**

   改 `apps/client/src/main.tsx:51`（`bootstrap` 包 try/catch → 失败渲染极简致命页 + `reportUnknown`，并把 `<App/>` 包进**最外层** `RootBoundary`）、`App.tsx`（hook 层错误外提，`Toaster` 也纳入边界）、`components/fallback/ErrorBoundary.tsx:34`（新增 `resetKeys`、重试次数上限 3、超限只留「刷新 / 回到首页」、`componentDidCatch` 里 `reportUnknown` 带 `boundaryId`）、`routers/index.tsx`（每个路由加 `errorElement`，磁贴视图用 `<ErrorBoundary compact>` 包裹 `RouteTransition` 的 outlet）。
   验证：临时在 `views/clock` 引入 `throw new Error('boom')` → 只有该磁贴显示 compact 兜底，磁贴墙与导航仍可用；在 `useKeyboard` 里抛错 → 出现根级致命页而非白屏；连点「重试」3 次后按钮变为「刷新」。

7. **Overlay / 捕获逃生通道（Rust 侧兜底，不依赖前端）**

   改 `apps/client/src-tauri/src/overlay/state.rs`（心跳阈值 3min → 30s，新增 `last_ignoring_cursor` 与模式记录）、`overlay/command.rs:134`（新增独立 watchdog 线程：每 5s 检查心跳，过期即 `set_ignore_cursor_events(true)` + `overlay:hide`，再过期则 `overlay:park` + 重建窗口 + 上报 `source='client-desktop'`）、`through/worker.rs`（`is_screenshot_mode()` 且心跳过期时强制 `should_ignore = true`，不再无条件钉死 `false`）、`utils/global_shortcut` 侧注册全局 `Esc` → `overlay:park`；前端 `views/overlay/overlay.tsx` 与 `features/capture/capture-error-boundary.tsx`（生产态不再只 `render null`：出现错误立即 `invoke(overlay:park)`，并把 `onError` 自身包 try/catch）。
   验证：dev 下杀掉 overlay 渲染进程（或在 overlay 里注入 `while(true)`）→ 30s 内桌面恢复可点、日志有 watchdog 记录、崩溃上报里出现一条 overlay 事件；截屏态下按全局 Esc → 浮层收起、桌面可点。

\## 风险与待确认

1. **`panic = "unwind"` 的体积/性能回退未知**：Step 3 需要实测（记录 release 二进制 MB 与冷启动耗时 before/after）。若回退不可接受，替代方案是 lancedb 走 Step 5 的 feature，让 slim 完全不链接它，full 再单独评估。
2. **`tracing` → `log` 桥是否已偶然生效**：如果依赖树里有 crate 打开了 `tracing/log`，日志本应已在落盘 —— Step 1 的验证要把它区分清楚，别把「日志少」全归给桥。可能的次因：级别过滤、`RotationStrategy::KeepAll` 快速轮转、以及多数崩溃路径根本走不到 Rust 代码。
3. **slim 是否保留 goose 需拍板**：本计划按「保留」写（agent 是核心能力）。若要连 goose 一起外置，必须先做「运行时下载 + sha256 校验 + 失败回退」的通用能力包机制，工作量与风险都显著上升，建议作为二期。
4. **legacy 孤儿进程不会被新逻辑清理**：新逻辑只对本次启动派生的子进程生效；用户机器上已有的 `corex-daemon` / `goose` 需靠 NSIS hook（`src-tauri/nsis/installer-hooks.nsh`）在下次安装/升级时清一次，得确认该 hook 覆盖这两个进程名。
5. **上报的隐私边界**：`context` 会带 `logTail`，可能包含用户路径与片段。需要默认脱敏（`<userHome>` 替换、去掉 URL query、不采集文档正文），并在设置页给出可见开关与说明。
6. **`countVectors` 仍需 lancedb**：slim 档如果裁掉 lancedb（feature），前端必须切到 `json`/`sqlite` store，且已有 `.cogito/lancedb` 目录要能识别并提示「需要完整版才能读取」；这部分迁移策略需确认（丢弃重建 vs 迁移）。
7. **CI 侧车步骤可能长期是红的**：`client-release.yaml` 的 `corex-serve/SHA256SUMS` 事实已过期，Step 5 修它属于「顺手修」；若本轮不想动 CI，至少要保证本地 `pnpm build:client` 的档位可用，并把 CI 修复拆成独立 PR。


\## 验证

可判定标准（全部在当前轮次之后执行，本轮只出计划）：

**A. 编译与单测**
\- `pnpm --filter @cogito/client type-check` → 0 error
\- `pnpm --filter @cogito/client lint` → 0 error
\- `pnpm --filter @cogito/client unit` → 全绿（含新增 vector-store / diagnostics / boundary 用例）
\- `cargo test --manifest-path apps/client/src-tauri/Cargo.toml` → 全绿；新增用例至少覆盖：`is_stale` 阈值、维度不匹配返回 Err、`db_path` 规范化、`capabilities:probe` 缺件分支

**B. 日志与崩溃（人工 + 断言）**
\- 正常启动退出 → `%LOCALAPPDATA%\com.cogito.client\logs\cogito.log` 内含 `[sidecar]` / `[overlay]` 级别的结构化行（不再为空）；`diagnostics/session.json` 末态为 `clean`
\- dev 注入 `panic!("boom")` → 进程退出前生成 `diagnostics/crash/*.json`，含 `location`、`thread`、非空 `backtrace`；同时 `cogito.log` 有一行 `ERROR`；`session.json` 残留 `running` → 下次启动被识别为「上次异常退出」
\- 断网启动 → 启动不被阻塞（首屏 < 3s），日志有「上报失败，已保留」

**C. Embedding 不再致死**
\- 伪造 3 维向量打 `vector_upsert` → 返回 `维度不匹配` 错误字符串，进程存活（`Invoke` 后主窗仍可操作）
\- 并发 8 次 upsert → 全部完成、无 panic、日志里 `elapsed_ms` 单调可读
\- 设置页把端点填成不可达地址 → 开关不生效、toast 明确；在搜索框检索 → 8s 内回退到 FTS 结果
\- 故意 abort 主进程（dev 下 `std::process::abort()`）→ 5s 内 `corex-daemon` / `goose` 自行退出（任务管理器断言：无残留 `corex-daemon.exe` / `goose.exe`）

**D. 档位裁剪**
\- `pnpm build:client` 后，安装包/bundle 目录内**不存在** `ffmpeg.exe`、`ffprobe.exe`、`pandoc.exe`；`corex-daemon.exe`、`corex-mcp.exe`、`cogito-mcp.exe`、`goose.exe`、`pdfium.dll` 存在
\- `CLIENT_SIDECAR_VARIANT=full pnpm build:client` → 上述三个可选件齐全
\- 记录两次构建的安装包体积（MB），slim 相对当前基线下降 ≥ 100MB（否则档位收益不成立，需回看清单）
\- slim 包内触发 clipchamp 导出 → 得到「精简版未内置 FFmpeg」可读提示，主窗不崩；`capabilities:probe` 返回各工具存在性

**E. 错误边界**
\- 人为让 `views/clock` 抛错 → 仅该视图显示 compact 兜底，磁贴墙 / 导航 / 其他视图正常
\- 人为让 `useKeyboard` 抛错 → 出现根级致命页（含「重试 / 刷新」），不是白屏
\- `ensurePersist()` 抛错（mock）→ 出现 bootstrap 失败页 + 一条上报，不是白屏
\- 连点重试 3 次 → 按钮退化为「刷新」

**F. Overlay 逃生**
\- 截屏态下杀掉 overlay 渲染进程 → ≤35s 桌面恢复可点（`GetCursorPos` 点击验证：能选中桌面图标），日志有 watchdog 记录 + 一条 overlay 崩溃上报
\- 截屏态下按全局 `Esc`（即使前端派发器异常）→ 浮层收起、`ignore_cursor_events` 回到 `true`
\- 回归：正常截图 → 剪贴板/贴图/保存链路与改动前一致（对照 `apps/client/scripts/browser-device-acceptance.md` 手工清单里与截屏相关的条目）
===== 计划全文结束 =====

## 追加（第 3 轮）：问题 1 的真正根因 —— `db_uri` 给了 `file:///` URI

`knowledge/vectorstore.rs::db_uri()` 原来把项目路径拼成 `file:///C:/…/.cogito/lancedb`。
`lancedb 0.27` 在 Windows 上会把这整串当成一个目录名去创建，直接报
`os error 123（文件名、目录名或卷标语法不正确）`——所以**不只是并发**：
`vector_upsert` 从第一次起就是失败的，前端只看到「开了 embedding 就卡死 / 闪退」。

修法（已落地、已实测）：`db_uri` 只做路径归一化后返回**普通路径**
（剥 `file://` → `\` 换 `/` → 去尾斜杠 → Windows 盘符去掉前导 `/`），
对旧数据里的 `file:///` 入参保留兼容；单测 `db_path_is_normalized` 同步改成普通路径。

`cargo test --lib` 里的真落盘用例 `concurrent_upserts_survive_and_dim_mismatch_is_rejected`
覆盖：8 并发 upsert 全成功、同 `page_id` 覆写仍 8 行、3 维写入被拒（维度不匹配）、
4 维 `top_k=2` 且 `score > 0`。

## 追加（第 3 轮）：验证 B / F 的真机证据

正在运行的正式实例（`C:\Users\iwell\Applications\cogito\cogito.exe`）会占住
`tauri-plugin-single-instance`，所以真机验证用**独立 identifier** 的构建：
`pnpm exec tauri build --debug --no-bundle --config .r3-devtest.conf.json`
（`identifier=com.cogito.client.devtest`），并用 `COGITO_DEV_NO_SIDECAR=1`
避免和正式实例抢 19828 端口。

debug-only 演练开关（release 构建里不存在，不构成攻击面）：

| 开关 | 作用 |
| --- | --- |
| `COGITO_DEV_PANIC=boom` | 启动 1.5s 后独立线程 `panic!`，验证 panic hook 落盘 |
| `COGITO_DEV_PANIC=abort` | 启动 1.5s 后 `std::process::abort()`，绕过 `RunEvent::Exit` |
| `COGITO_DEV_EXIT_MS=9000` | 到点 `app.exit(0)`，走 `RunEvent::Exit`（mark_clean_exit + sidecar 回收） |
| `COGITO_DEV_OVERLAY_STALL=10` | 到点把 overlay 摆成「可见 + 吃点击 + 心跳过期」，验证看门狗兜底 |
| `COGITO_DEV_NO_SIDECAR=1` | 不拉起 sidecar，隔离运行时不抢端口 |

实测结果：

- 正常启动 + `app.exit(0)` → 日志出现 `演练：app.exit(0)` / `应用退出，开始回收 sidecar`
  / `[cogito::utils::sidecar] 正在关闭 corex-daemon…`；`session.json` 末态
  `{"state":"clean", pid, startedAt, endedAt}`；
- `panic!("boom")` → `diagnostics/crash/1793785105648-f0e7c6b6.json`（3294 字节）含
  `message=boom: boom`、`location=src\utils\diagnostics.rs:164:9`、`thread=<unnamed>`、
  `eventId`（UUID）、`backtrace` 2928 字符；同目录 `cogito-crash.log` 有纯文本副本；
- 强杀后再启动 → 日志 `上次会话未正常退出（pid=…, startedAt=…），待上报崩溃现场 1 份`，
  说明「先读旧标记、再写 running」的顺序修对了（原来的顺序会让异常退出永远认不出来）。

## 追加（第 3 轮续）：孤儿进程的真正兜底 —— Windows Job Object

`panic = "unwind"` 只覆盖「Rust 里 panic」这一种；`std::process::abort()`、任务管理器结束
进程、WebView2 / 驱动层崩溃都不会走 `RunEvent::Exit`，sidecar 仍会留下。新增
`apps/client/src-tauri/src/utils/child_job.rs`：进程级 Job（`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`），
`corex-daemon` / `goose serve` / 一次性 `goose` / `corex edit` 拉起后立即 `adopt(pid, label)`。
宿主无论怎么死，内核都会关掉 Job 句柄 → 整棵子进程树被回收。

真机验证（devtest 构建，`COGITO_DEV_PANIC=abort` + `COGITO_DEV_PANIC_DELAY_MS=32000`，
等 sidecar 起完再崩）：

- `[sidecar] corex-daemon (pid=25960) 已纳入 Job：主进程被强杀时由内核回收`
- `[sidecar] goose serve (pid=71332) 已纳入 Job：主进程被强杀时由内核回收`
- `[diagnostics] 演练：std::process::abort()（跳过 RunEvent::Exit）` → 宿主退出码 `-1073740791`
  （`0xC0000409` fast-fail），日志里**没有** `应用退出，开始回收 sidecar`（即没走 Exit 事件）
- 宿主退出后 `goose.exe pid=71332` **17ms** 内消失，`reap_result=all_gone_within_5s`
- 本次 `corex-daemon` 自己先退出了（`code=1`）：devtest 与正式实例抢同一个管道
  `\\.\pipe\corex`；真实单实例环境没有这个冲突，Job 归属日志证明它同样被纳管。

## 追加（第 3 轮续）：验证 F 的全局 Esc（真机）

`COGITO_DEV_SCREENSHOT_MS=7000` 进截屏态（等价于用户按截屏键），再用 `keybd_event`
注入一次系统级 Esc（等价于按物理键，不走渲染进程）：

```
[19:07:35][WARN][overlay] 演练：已进入截屏态（全局 Esc 已注册），等待 Esc 或看门狗
[19:07:37][INFO][cogito::overlay::command] overlay: 全局 Esc 触发，收起浮层
[19:07:37][INFO][overlay] overlay: 浮层已隐藏（visible=false），不再吃点击
```

注入到收起 1s 内完成；`overlay:park` 内部同时 `unbind_escape`，非截屏态不会占着系统 Esc。

## 追加（第 3 轮续）：验证 D 的缺件文案（真机）

把 debug 版 `cogito.exe` 单独拷到 `C:\Users\iwell\.cache\rust\slimprobe\`（旁边**没有**
`binaries/`），即复现 slim 包里「找不到可选工具」的真实分支：

```
[19:08:08][WARN][media] 演练：ffmpeg 缺失，用户可见提示 = 精简版未内置 ffmpeg.exe（媒体转码需要完整版）；可在 设置 → 诊断 查看完整版能力
[19:08:08][WARN][media] 演练：ffprobe 缺失，用户可见提示 = …（同上）
[19:08:08][WARN][media] 演练：pandoc 缺失，用户可见提示 = …（同上）
```

文案由 `missing_tool_hint()` 统一产出；单测锁死「带工具名 / 带完整版 / 带诊断 / 不含 os error / ≤120 字」。

## 追加（第 3 轮续）：新增的 debug-only 演练开关

| 开关 | 作用 |
| --- | --- |
| `COGITO_DEV_SCREENSHOT_MS=7000` | 到点进截屏态（注册全局 Esc、吃点击） |
| `COGITO_DEV_TOOL_PROBE=1` | 启动后把三个可选工具的真实查找结果打进日志 |
| `COGITO_DEV_PANIC_DELAY_MS=32000` | 配合 `COGITO_DEV_PANIC`，等 sidecar 起完再崩 |

## 追加（第 3 轮续）：前端用例与门禁

- 新增 `apps/client/src/views/knowledge/lib/vector-store.test.ts`（5 例）：写并发常量 = 1、
  JSON 回退写入 / 检索、端点不可达时搜索降级 `[]` 且写入 `false`、开关关闭不发请求、
  批量写入可被 `cancelEmbeddingWork()` 中止。
- `cargo test --lib`：**78 passed / 0 failed**（新增 `child_job` 2 例、`missing_tool_hint` 2 例）。


## 追加（第 3 轮续）：验证 D 的 full 档位（真包）

`CLIENT_SIDECAR_VARIANT=full pnpm run build`（`apps/client`）→ `FULL_BUILD_EXIT=0`
（vite 重建 + `tsc` + `eslint` 全过 + release LTO 链接 + msi/nsis 打包，约 37 分钟）。

| 观测点 | slim | full |
| --- | --- | --- |
| nsis `cogito_1.5.0_x64-setup.exe` | 300.80 MB | **412.27 MB** |
| msi（en-US / zh-CN） | 332.60 MB ×2 | **490.79 / 490.78 MB** |
| bundle 合计 | 966.1 MB | **1393.8 MB** |
| `ffmpeg.exe` / `ffprobe.exe` / `pandoc.exe` | 命中 0 | **命中 3**（release/binaries：157.51 / 157.32 / 211.23 MB） |
| 必带件 | `cogito.exe` / `corex-daemon` / `corex-mcp` / `cogito-mcp` / `goose` / `pdfium.dll` 齐全 | 同上（112.05 / 26.12 / 16.11 / 1.50 / 163.44 / 6.88 MB） |

结论：slim 比 full 小 **427.7 MB**（远超「≥100MB」的要求），且 slim 是真的把三个可选件
排除在外（不是「装了但不显示」）。

## 追加（第 3 轮续）：门禁结果（本轮）

| 门禁 | 结果 |
| --- | --- |
| `pnpm run type-check`（apps/client） | `TC_EXIT=0` |
| `pnpm run lint`（apps/client） | `35 problems (0 errors, 35 warnings)`，`LINT_EXIT=0` |
| `pnpm run unit`（apps/client） | `Test Files 119 passed (119)` / `Tests 682 passed (682)`，`UNIT_EXIT=0` |
| `cargo test --lib` | `78 passed; 0 failed` |


## 第 3 轮：把「端点不可达」与「Esc 只占截屏态」锁成用例

### 改动

| 文件 | 改动 |
| --- | --- |
| `apps/client/src/views/knowledge/lib/embedding-config.ts` | 抽出 `planEmbeddingToggle` / `embeddingProbeFailurePatch` / `embeddingProbeSuccessPatch`：开关决策与结果落盘从组件里剥离成纯函数 |
| `apps/client/src/views/knowledge/surface/settings.tsx` | `handleToggleEmbedding` 改走策略函数；探测失败只写失败记录，`enabled` 恒为 false + toast |
| `apps/client/src/views/knowledge/lib/embedding-config.test.ts` | 新增 8 例（决策 4 + 落盘 4） |
| `apps/client/src/views/knowledge/lib/vector-store.test.ts` | 追加 3 例 probe（端点不可达 / HTTP 500 / 成功返回维度） |
| `apps/client/src-tauri/src/overlay/command.rs` | 抽 `escape_should_bind`，`overlay_update_mode` 走策略；新增 2 个单测（策略 + 「三条退出路径都 unbind」结构防线） |
| `apps/client/src-tauri/src/app/plugins.rs` | `verbose_enabled` 抽 `is_verbose_arg`，把原来「对着常量表断言」的空测试换成真单测（顺带消掉 unused import 警告） |

### 门禁（全部在 `apps/client` 下跑）

- `pnpm run type-check` → `TC2=0`
- `pnpm run lint` → `35 problems (0 errors, 35 warnings)`（与改动前同数量，未新增）
- `pnpm run unit` → `Test Files 120 passed` / `Tests 693 passed`（682 + 11）
- `cargo test --lib` → `81 passed; 0 failed`（cargo 退出码 0，无 unused import 警告）
- 定向：`vitest run embedding-config.test.ts vector-store.test.ts` → `2 files / 16 tests passed`

### 验收项补口

- **C（端点不可达时开关不生效）**：`planEmbeddingToggle` 4 例 + 失败补丁 4 例锁定「探测失败 → `enabled=false` + `lastProbe.ok=false` + 可读错误」；`probeEmbeddingEndpoint` 3 例锁定不可达 / HTTP 500 / 成功三分支。
- **F（正常截图链路回归）**：`git diff --numstat apps/client/src/features/capture` 只有 `capture-error-boundary.tsx`（+12/−1，纯兜底），截屏 → 剪贴板 / 贴图 / 保存的调用链零改动；Esc 只在 `OverlayMode::Screenshot` 绑定（`escape_should_bind` 单测 + 三条退出路径 `unbind_escape` 结构测试），非截屏态不占系统 Esc。
