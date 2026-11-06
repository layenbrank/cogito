# 工具面四件故障：修在哪、怎么验

四件「工具看着有、实际不工作」的故障 —— 缓存乱落盘、请求拦截不生效、截图超时、
计划模式重复执行旧计划。这里只记**修复点**与**可判定的验收口径**，实现细节散在
`agent-terminal.md`（缓存与终端）、`browser-device.md`（拦截与截图）、`plan-mode.md`（计划版本化）里。

## 一张表：改在哪、证据是什么

| # | 故障 | 修复点 | 已有证据 | 运行期验收 |
| - | ---- | ------ | -------- | ---------- |
| 1 | agent 把 `.ps1/.log/.bat` 落在仓库根，会话结束不删，没有集中目录，也没进 AppData | `utils/agent_cache.rs`（根 `/` 会话子目录 `/` 7 天 TTL `/` 一键清空）+ `utils/terminal.rs::spawn_session` 注入 `COGITO_AGENT_CACHE`/`TMP`/`TEMP` + `scripts/check/agent-junk.mjs` + 设置页「Agent 缓存」 | `cargo test --lib agent_cache` 7 passed；`check:agent-junk` 双向实测：造 `tmp/x.log` + `scratch-1.ps1` → `DIRTY_EXIT=1` 并点名两个路径，删掉后 → `CLEAN_EXIT=0` | 待宿主重启：`echo $env:TEMP` 落在缓存目录、设置页「清空」后 0 B |
| 2 | `app_browser_intercept` 的 mock/block 从不命中，请求照发拿真实 401 | `browser/intercept.rs::enable_params()` 下发 `patterns: [{ urlPattern: "*", requestStage: "Request" }]`；新增 `paused` / `matched` 计数 | `cargo test --lib browser::` 33 passed（含 `enable_params_asks_for_a_real_pattern`）；**独立 CDP 探针**实测：`{"patterns":[]}` → `requestPaused=0`、`/api/x` 根本没发出；换成显式 pattern → `requestPaused=3`、`/api/x` 被拦下 | 待宿主重启：dev server 页面上 mock 401→200、面板「命中 M ≥ 1」 |
| 3 | `app_browser_screenshot` 连续两次 `Page.captureScreenshot` 10s 超时，拿不到图 | `browser/agent.rs::screenshot`：拍前 `lifecycle::reveal_for_capture`，CDP 双通道各 4s（`fromSurface: true → false`），都失败走 `os_capture` 客户区 BitBlt，返回 `mode: surface/view/os` + 明确失败原因 | 代码静态核对（`screenshot` → `os_capture` / `screenshot_channels` / `screenshot_params` 三条引用齐备） | 待宿主重启：≤4s 出图，或「窗口不可见（已尝试 surface/view/os）」 |
| 4 | 计划改过之后，「开始执行」跑的还是上一版，`done` 的计划不会被标过期、目标模式继续按旧版烧 token | `plan-store.ts` 的 `executedRevision` / `isPlanStale` / `superseded` + `aside-plan.tsx`「按新计划执行（rN）」+ `goal-auto-advance.tsx` 执行前闸门 + `plan-data-ui.tsx`「已被 rN 取代」 | `plan-store.test.ts` / `plan-draft.test.ts` / `plan-execute.test.ts` 全绿（`pnpm --filter @cogito/client unit` 838 passed） | 待宿主重启：改计划 → revision+1 → 按钮文案变 → prompt 带 `revision N` |

拦截那条的探针是本轮唯一「不依赖宿主」的实证，脚本在
`%LOCALAPPDATA%\cogito\agent-cache\cdp-probe\probe.mjs`（headless Edge + 本地 401 服务），
实测输出与判读见 `browser-device.md` 的「拦截的观测口径」。

## 为什么这四条里有六项只能「待宿主重启」

不是偷懒，是**结构性阻塞**：agent 本身跑在宿主进程里，而这个进程还是装好的旧包 ——
关掉它，当前这条会话、这些工具调用、这个右栏终端一起消失，就没有「谁来验收」这回事了。
所以运行期断言必须在「换二进制 + 重新开一条会话」之后做。

判断「跑的是不是新代码」用构建指纹，别靠猜：`设置 → 诊断 → 运行中的宿主` 看**链接时间**，
或看启动日志里的 `宿主构建指纹 version=… profile=… exe=… exe_modified_ms=… pid=…`。
链接时间早于最近一次 `cargo build` = 这个进程跑的是旧二进制（详见 `build-fingerprint.md`）。
两个不同的文件：装好的包在 `D:\Applications\cogito\cogito.exe`，dev 构建产物在
`D:\Documents\cache\debug\cogito.exe` —— 重启装好的包带不上任何 Rust 改动。

## 重启后照着做：六条运行期断言

1. **终端落点**：新会话里 `echo $env:TEMP`、`echo $env:COGITO_AGENT_CACHE` 都是
   `%LOCALAPPDATA%\cogito\agent-cache\<session>`；`Out-File t.log` 之后 `git status --porcelain` 无新增。
2. **一键清空**：设置 → 诊断显示「Agent 缓存 · N MB」，点「清空」→ 0 B；`.cogito/plans` 与日志目录不受影响。
3. **拦截生效**：dev server 页面上对一个 XHR 设 mock（401 → 200 `{"ok":true}`）→ 页面拿到 200；
   再设 block → 请求失败；两次的计数 `paused > 0` 且「命中 M ≥ 1」。
4. **截图**：`app_browser_screenshot` ≤4s 出图；把右栏切到聊天视图（webview 被 hide）再截，
   应当拿到图（`mode: os`）或明确的「窗口不可见」文案，而不是 10s 超时。
5. **计划版本化**：计划模式里说「把第 3 步改成 X」→ 右栏 revision +1、按钮变「按新计划执行（rN）」；
   点执行后的 prompt 含 `revision N`；上一版计划卡出现「已被 rN 取代」。
6. **不再重复执行**：`revision > executedRevision` 时目标模式应当 `paused`，消息流不再新增轮次。

## 顺手记下的三个坑

- **终端输入会回放历史**：`app_terminal_run` 在旧宿主上出现过「每次按键把整段历史重刷一遍」，
  命令被打散成 `'xt' is not recognized` 之类的碎片，长命令基本不可用。绕法是
  `.bat` + `Start-Process -WindowStyle Hidden` + 重定向到文件，再用 `app_workspace_read` 读；
  `.bat` 别写在仓库里（会撞 `check:agent-junk`），写缓存目录。
- **`pnpm <script>; "EXIT=$LASTEXITCODE"` 会把尾巴当参数塞给脚本**：pnpm 把 `run` 之后的多余
  参数透传给脚本，于是 `cargo check` 收到 `'*;'`、`'EXIT=$LASTEXITCODE'` 并报
  `error: unexpected argument '*;' found` —— 看起来像「编译失败」，其实是被参数污染。
  要拿退出码就包一层：`cmd /c "pnpm … > out.txt 2>&1 & echo EXIT=%ERRORLEVEL% >> out.txt"`；
  但**同一行里的 `%ERRORLEVEL%` 是解析期展开的**（拿到的是上一条命令的码），
  所以判定看输出里的 `Finished … in Ns` / `test result: ok` 这类终止行，别只盯那个数字。
- **`cargo test` 的 manifest 别手动补**：lib 单测靠 `src/lib.rs` 里的
  `#[link(name = "resource", kind = "static")]`，改回 `mt.exe` 注入会撞 `CVT1100`（见 `browser-device.md`）。

## 本轮命令侧结论

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @cogito/client type-check` | exit 0 |
| `pnpm --filter @cogito/client lint` | exit 0 |
| `pnpm --filter @cogito/client unit` | 838 passed |
| `pnpm --filter @cogito/design exec vitest run` | 247 passed（25 files） |
| `pnpm --filter @cogito/client check:cargo` | `Finished dev profile … in 21.83s`，0 error，5 条既有 `non_snake_case` warning |
| `cargo test --lib agent_cache` | 7 passed / 0 failed |
| `cargo test --lib browser::` | 33 passed / 0 failed |
| `pnpm check:agent-junk` | 脏 → 1（点名 2 个路径）；干净 → 0 |
