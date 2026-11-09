# Agent / 终端 / 自动化链路审计与修复

> 一次跨 12 轮的审计结论与验收清单。它回答三件事：**改了什么**、**哪些能一键验**、
> **哪些必须人点**。所有取舍的理由都写在对应代码的注释里，这里只做索引与验收。

## 一句话结论

七类现象的共同根因是**状态归属层级错位**（mode 是线程偏好却按消息级语义用、终端会话按
cwd 派生导致跨 agent 共享、缓存清理依赖「系统会清」这个不成立的前提），以及**症状级补丁
掩盖时序根因**（首字母截断靠回显兜底 + 垫空格、渲染错乱靠 LRU 保活硬撑）。修复方向都是
把状态放回它真正的归属层，并把时序问题交给「就绪等待 + 单次写 + 整条重发」这类机制。
（`echo <nonce>` 哨兵与 Ctrl-U 清行后来被证伪，见 `agent-terminal.md` 的「写入载荷」一节。）

## 改动清单

### Rust（apps/client/src-tauri）

| 文件 | 改动 |
| --- | --- |
| src/utils/agent_cache.rs | 落点改 %LOCALAPPDATA%\Temp\cogito\agent-cache（Temp 是系统清理域）；旧目录只做一次性迁移；陈旧判定改「目录内最新文件 mtime」；新增容量上限 + LRU 淘汰（prune_by_size）；30 秒节流的 prune_all；AgentCacheStats 增 lastPrunedAt / lastPrunedBytes / maxBytes / legacyBytes；环境变量 COGITO_AGENT_CACHE_RETENTION_DAYS / COGITO_AGENT_CACHE_MAX_BYTES 覆盖（0 对保留期 = 全部超期，对上限视为误配回落默认）；prune_in_background 供高频入口异步清理 |
| src/app/bootstrap.rs | 启动按 retention_days()（环境变量优先）强制清一次 |
| src/utils/terminal.rs | 删掉 103 行死代码（legacy_write_command / type_command / await_echo / submit_enter 与 7 个常量）——「加空格」补丁随之消失；命令下发统一走 write::submit_command；新增闲置回收 start_idle_reaper（60s tick，只回收 agent 会话、有 run 在跑不回收、COGITO_TERMINAL_IDLE_CLOSE=0 可停，收尾写系统行「会话已结束（闲置）」并发 terminal://idle-closed）；判据抽成纯函数 should_reap；terminal_attach 顺手触发一次缓存节流清理 |
| src/utils/terminal/write.rs | 就绪等待（提示符/安静期，**不发哨兵**）+ 一个前导空格的**单次 write**（正文与回车同批，**不塞 Ctrl-U**）+ 回显不符先 Ctrl+C 丢行再整条重发 |
| src/utils/goose_serve.rs | 仅注释：说明它**刻意不做**闲置退出（单例后端 + ACP 长连接 + Job Object 收养） |
| crates/core/src/automation/service.rs | 「认领 ≠ 开跑」：insert_run 的 startedAt 写 NULL，真正开跑由前端 touchAutomationRun 补写；toReapStale 两条分支（startedAt < cutoff 或 startedAt IS NULL AND scheduledFor < cutoff），文案区分「任务没有被执行」与「执行没有回写结果」——修掉 automation:due 丢事件导致的静默失败 |
| crates/core/src/agent_goal/ | agent_goal 增 leaseRunID / leaseUntil / modeBefore 三列，供回合租约与启动前模式还原 |

### 前端（apps/client/src）

| 文件 | 改动 |
| --- | --- |
| features/agent/mode.ts | 消息级模式快照：MODE_SNAPSHOT_KEY = modeSnapshot、readModeSnapshot / stampModeSnapshot / findModeSnapshot / resolveModeFor / resolveRunMode |
| features/agent/port/model.ts | run() 先按消息快照取模式，取不到才回落线程偏好 |
| features/agent/port/thread-history.ts | 用户消息落库前打快照（stampUserModeSnapshot），已有快照不重打 |
| views/agent/chat/runtime.tsx | 安装 user message 徽标解析器：只认消息里的快照，老消息不显示 |
| features/agent/goal-run.ts | 单入口 advanceGoal + generation 丢弃过期回调；回合租约（beginGoalTurn / renewGoalTurn / isTurnLeaseLive）；崩溃自愈 recoverInterruptedGoals；收尾标记段落级严格匹配 + **跳过代码围栏**（围栏完整时才跳，奇数次维持旧行为） |
| features/agent/plan-store.ts | agent_goal 本地档案 + 400ms 防抖，modeBefore 参与自愈还原 |
| features/terminal/terminal-write-queue.ts | 写入队列：rAF 合并 + 串行 write(bytes, cb) + MAX_FLUSH_BYTES 上限，只搬字节不解码（xterm 的 UTF-8 解码器有状态） |
| features/terminal/terminal-focus.ts | 焦点策略 isEditableElement / canTakeFocus：容器未挂载、窗口在后台、用户在输入框或别的 xterm 里 → 不抢 |
| features/terminal/terminal-view.tsx | 唯一程序化聚焦入口 focusIfAllowed()；写入全走队列；鼠标 onMouseDown 才直接 focus |
| features/terminal/agent-tabs.ts | watchAgentTerminal 只 reveal 不 focus；bootstrap 单飞 + generation；watchIdleClosed 只标退出 |
| features/terminal/terminal-layout.ts | 尺寸为 0 / 1px 不排布局；双 rAF settle 后断开 observer |
| stores/terminal.ts | hydrateSession 保留退出态（不把死会话翻回运行态）、closePanel 不杀会话、revealAgentTab 按 scope 隔离 |
| features/agent/context-estimate.ts / context-breakdown.ts | 上下文估算（按 part 身份缓存字符数）+ 分段 / 阈值 / 「最占 Top 5」纯函数 |
| views/agent/chat/components/composer-footer.tsx | 接入 ContextBreakdownBar：结构订阅 + 200ms 节流 + Top5 点击跳转消息 |
| views/settings/surfaces/diagnostics.tsx + lib/diagnostics/cache-text.ts | 诊断页显示缓存根 / 会话数 / 上限 / 上次清理释放字节，并列出两个环境变量 |

### 设计包（packages/design）

| 文件 | 改动 |
| --- | --- |
| src/assistant/context.tsx | 新增 ContextBreakdownBar：四段色条 + 图标 + 阈值环（warn 70% / danger 90%）+「最占」标签 + drilldown 列表 + onJumpToMessage |
| src/assistant/thread.aui.tsx | 用户消息元信息行加 UserMessageBadgeSlot；助手 / 用户消息各带 data-message-id / data-user-message-id 供 Top5 跳转定位 |
| src/assistant/user-message-badge.tsx | 徽标插槽 + 解析器注册（模式语义留在 app 侧） |

## 验收：一键跑（命令级）

```powershell
# 1) Rust：终端写入时序 / 会话隔离 / 闲置回收判据
cargo test --manifest-path apps/client/src-tauri/Cargo.toml -p cogito-client utils::terminal
# 期望 56 passed：write_command_single_write、retries_whole_command_on_echo_mismatch、
#   swallowed_first_byte_eats_only_the_clear_line、terminal_run_serialized_same_session、
#   terminal_run_isolated_across_threads、echo_confirmed_* 5 条

# 2) Rust：缓存落点 / 陈旧判定 / 容量淘汰 / 迁移 / 环境变量
cargo test --manifest-path apps/client/src-tauri/Cargo.toml -p cogito-client utils::agent_cache
# 期望 12 passed：root_prefers_local_temp、stale_uses_latest_file_mtime、
#   prune_by_size_evicts_lru_first、migrate_legacy_drains_old_root、
#   retention_days_env_override、max_bytes_env_override_rejects_zero、
#   zero_retention_clears_fresh_sessions

# 3) Rust core：自动化收尸 + 目标租约
cargo test --manifest-path apps/client/src-tauri/Cargo.toml -p cogito-core
# 期望 68 passed，含 claimed_but_never_started_run_is_reaped_as_failed

# 4) 前端
pnpm --filter @cogito/client exec vitest run src/features/terminal src/features/agent src/lib/diagnostics src/stores
# 期望 39 files / 326 tests passed
pnpm --filter @cogito/client run lint          # 0 errors 0 warnings
pnpm --filter @cogito/client run type-check    # 静默（exit 0）
pnpm check:agent-junk                          # 「仓库根干净」
```

## 验收：必须人点（行为级）

| # | 场景 | 通过判据 | 已有 headless 判据 |
| --- | --- | --- | --- |
| 5 | 设置 → 诊断 | 缓存根显示 …\Temp\cogito\agent-cache；有「上限 / 上次清理 … 释放 N MB」；COGITO_AGENT_CACHE_RETENTION_DAYS=0 重启后旧会话目录被清空、旧目录提示消失 | agent_cache 12 条 + cache-text.test.ts 8 条 |
| 6 | 目标模式发一轮 → 停止 → 切执行 → 切回目标 → 重新生成 | 系统提示仍是目标模式；user 消息徽标显示「目标」 | mode-snapshot.test.ts 8 条 |
| 7 | 目标跑到一半杀进程 → 重启 | 会话模式 / 审批档回到启动前；goal 行是 interrupted 而非 running | goal-run.test.ts 19 条（崩溃自愈 / 租约 / 单飞 / 围栏） |
| 8 | 同一 cwd 两个线程各跑一条命令 | 两次 terminal_run 输出互不污染；同线程连发两条串行 | Rust 2 条 + agent-tabs / stores/terminal 的 #scope 用例 |
| 9 | 新 shell 里连跑 20 次 npm --version | 0 次缺首字符、命令全成功 | swallowed_first_byte_eats_only_the_clear_line（20 轮） |
| 10 | composer 输入到一半，agent 触发 terminal:run | 输入框内容与光标不变；面板掀开且 tab 高亮 | terminal-focus.test.ts 12 条 + agent-run 不改 activeElement |
| 11 | 中文文件名 + 回车进度条 + 清屏的构建输出；6 tab 来回切 10 次 | 无乱码 / 半行 / 重复段；切回无空白 | 写入队列 9 条（含 UTF-8 跨帧、10 万行）+ layout 16 条 |
| 12 | 让 agent 会话闲置超过 TTL | PTY 消失、tab 显示「会话已结束（闲置）」、重开面板不复现死会话 | should_reap 四组合 + watchIdleClosed 2 条 + hydrate 不复活 |
| 13 | 构造 70% / 90% 两档用量 | 色条与图标进 warn / danger；四项求和 = 总量；点 Top5 跳到对应消息 | context-breakdown.test.ts 7 条 |
| 14 | 10 万行输出 + 流式对话 | 主线程无 >50ms 长任务；RSS 不线性增长；footer 重渲染与 token 解耦 | 10 万行压测 + Rust 环形缓冲字节上限 |

## 审计中确认「不需要改」的三处

1. **goose serve 不做闲置退出**：单例后端（一个进程服务所有会话），进程数不随使用时长增长；
   ACP 是长连接，按闲置杀掉会打断进行中的回合；宿主退出时由 child_job 的 Job Object 连带
   收掉，不留孤儿。与 PTY 不同（那边每 cwd 一个 shell，才需要 start_idle_reaper）。
2. **自动化 claim 已是幂等 + 原子**：(automationId, scheduledFor) 唯一索引 + 事务内算 next-run
   + 先查再插；重复 tick / 补跑 / 多副本都只落一条。
3. **终端回滚缓冲已是字节上限实现**：push_output 256 KiB 上限 + drain(..overflow) + dropped
   计数，read_since 用 cursor - dropped 换算，不是全量复制。

## 调试开关

| 环境变量 | 作用 |
| --- | --- |
| COGITO_AGENT_CACHE_RETENTION_DAYS=0 | 下一次清理把所有会话目录视为超期（验证 / 救急用），启动时生效 |
| COGITO_AGENT_CACHE_MAX_BYTES | 缓存容量上限（默认 512 MiB）；0 或非法值回落默认 |
| COGITO_TERMINAL_IDLE_CLOSE=0 | 关掉终端闲置回收（默认 30 分钟 TTL） |
