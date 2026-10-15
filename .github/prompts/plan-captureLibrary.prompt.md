# Plan: 捕获库（截屏 + 录屏）· client

截屏从「一次性浮层工具」升级为**捕获库**：可配置快捷键 → 导出成品自动入历史 → 磁贴双击打开捕获库管理（截图 + 录屏同库、相簿分类、标记保存、按天数/数量/容量自动清理、清理前角标预警）。数据**复用 `asset` 表 + `metadata` JSON**（共享表不加列），相簿新建 `album` 表，全部只动 `apps/client`。

## 背景与调研结论

竞品抓取核实（Snagit / Zight / Loom / Screen Studio + 上一轮的 PixPin / CleanShot X）：

| 产品                 | 库的形态                                         | 分类                   | 保留/配额                                                                                                                            |
| -------------------- | ------------------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Snagit（最接近）     | 截图与录屏**同一个中央 Library**，采集完自动进库 | `Tags` + `Collections` | 未见公开的天数清理（桌面买断软件）                                                                                                   |
| Zight                | 截图与录屏同一 workspace 库                      | `Collections/Folders`  | **`Capture history access: Last 50 captures`（免费）/ Unlimited**；`Storage: 1 GB / 5 GB`；企业档才有 `Custom Data Retention Policy` |
| Loom                 | 云端库                                           | 无（靠 workspace）     | 按套餐限**数量**（Starter 25 videos）                                                                                                |
| Screen Studio        | **不做库**，文件放本地任意位置                   | —                      | 无；但有**录制每 2 秒落盘 + 崩溃恢复**、`Import any video`                                                                           |
| PixPin / CleanShot X | 最近浮窗 + 云分享（1GB）                         | —                      | 无本地保留策略                                                                                                                       |

三条可借鉴的硬结论：

1. **截图与录屏同库**是主流（Snagit / Zight）→ 应按「捕获库」设计，而非截屏专属页面。
2. **按数量 + 按容量**是行业通用配额维度；**按天数自动清理基本只在企业云档** → 本地三合一（天数 + 数量 + 容量）是本仓差异化。
3. **录制过程必然存在"进行中/未完成"文件**（Screen Studio 每 2 秒落盘 + crash recovery 即证据）→ 清理必须有保护窗口。

## 已确认范围

- 只做 `apps/client`（studio 不同步）。
- 截屏磁贴双击 → 打开捕获库（`/capture`）；快捷键仍负责触发截屏浮层。
- 记录复用 `asset` + `metadata`；**导出时记录成品**（复制/贴图/另存任一动作触发；未导出的框选不入历史；一次会话一条记录）。
- 超期清理与手动删除都**删磁盘文件**；相簿走 DB 表；**加入相簿 ≠ 免清理**，只有「标记保存」免清理；将被清理的用**角标**预警。
- **录屏页本期一起设计并实现**：页面、筛选、时长、播放、相簿、保留策略都做；数据来源 = ①预留未来采集端 ②现在提供「导入录屏」入口（复用 gallery 选文件链路）。
- **保留维度 = 天数 + 数量 + 容量**；容量按**分类独立配额**，窗口另显示合计占用仅供查看。
- **默认值**：截图 `7 天 / 100 张 / 500 MB`；录屏 `30 天 / 50 个 / 5 GB`。
- **播放器**：复用 gallery 的 `lightbox/lightbox.tsx`（已核实原生支持视频：`kind === 'video'` → `<video controls autoPlay>`、时长显示、`preload='metadata'` 探测宽高）。

## Steps

### Phase 1 — 设置与可配置快捷键

1. `stores/setting.ts`：`Setting.Capture` 扩为 `{ detect, shortcut, isRetentionEnabled, retention }`，其中 `retention = { screenshot: {days:7, count:100, maxBytes:500MB}, recording: {days:30, count:50, maxBytes:5GB} }`。
2. 新增 `features/capture/shortcut.ts`：`DEFAULT_SHORTCUT`、纯函数 `formatShortcut(event)` / `isValidShortcut(text)`（至少一个修饰键 + 一个主键）、`useCaptureShortcut()`：`getCurrentWindow().label === 'main'` 门控、值取自设置、变更即重注册、注册失败 toast + 回滚到原值。
3. `App.tsx` 挂 `useCaptureShortcut()`；`views/overview/overview.tsx` 删掉 `SCREENSHOT_SHORTCUT` 与那段注册 effect（保留 `dispatchKeyCode('screenshot')` 流程，磁贴接管语义不变）。
4. 设置页新增「截屏」分区：`views/settings/constant.ts`（`SectionKey`/`SECTION`/`NAVS`/`HEAD`/`SECTION_KEYS` 五处）+ `shell.tsx` 分支 + 新建 `panels/capture.tsx`、`panels/shortcut-input.tsx`；把「截图窗口检测」从 `panels/general.tsx` **迁入**（不复制）；同页放截屏/录屏两组策略（天数 + 数量 + 容量）与当前占用摘要。

### Phase 2 — 截图成品入历史（可与 P3 并行）

5. 新增 `features/capture/history.ts`：`findCaptureDir()` → `<AppLocalData>/captures`；`toRecordCapture({ png, sessionID })` 写 `captures/screenshot-<ts>.png`，首次 `ASSET.INSERT`（带 `size`）、再次覆盖同一文件 + `ASSET.UPDATE`（一次会话一条记录）；失败只 warn，绝不阻断导出。
   - metadata：`{ source:'capture', isScreenshot:true, captureKind:'screenshot', state:'done', isManaged:true, capturedAt, dateSource:'capture', keep:false, albums:[] }`
6. `features/capture/capture-export.ts`：`handleCopy` / `handlePin` / `handleSave` 各调一次；`features/capture/capture.tsx` 每次 `capture:open` 生成 `sessionID`、close 清空。
7. `views/gallery/model/media.ts`：`toGalleryMedia` 的启发式标记改为只设 `isScreenshot`（不再写 `source:'capture'`，避免把导入截图误判成本机历史）；`isLikelyScreenshot` 去掉 `/textures/` 判据（贴图不再与历史重复）；新增 `findCaptureHistory`；`GalleryAssetMeta` 加 `keep?`/`albums?`/`state?`/`captureKind?`/`isManaged?`，`DateSource` 加 `'capture'`。

### Phase 3 — 相簿（DB 表 + 四件套命令）

8. **前置校验**：`sea-orm-cli migrate status` 确认现有库只记录 `migrations_v001`；若有 v002/v003 残留，`fresh` 会清库 —— 先停下来找用户确认。
9. `crates/database/src/migrations/migrations_v002.rs`（`album`：`id/name/index/coverAssetID/status/archivedAt/createdAt/updatedAt` + `idx_album_archivedAt`/`idx_album_index`，沿用 camelCase 列名与 `'001'` status 约定）+ `migrations/mod.rs` + `migration.rs` 注册。
10. **相簿成员不建关联表**，放 `asset.metadata.albums: string[]`（理由：`asset` 不能加列；成员随行删除自动消失，无需级联清理；相簿量小、前端本就全量读）。
11. `crates/database/src/entity/album.rs`（照 `asset.rs` 的 Model + Read/Insert/Update/Remove 四件套与 `*P`）→ `lib.rs` → `crates/core/src/album/service.rs` → `crates/command/src/album.rs` + `app/handlers.rs` 注册 `album:read/write/update/remove`。
12. `shared/ipc/channels.ts` 加 `ALBUM`；新增 `stores/album.ts`（读/建/改名/删；attach/detach 用 `ASSET.UPDATE` 改 `metadata.albums`，复用 `mergeMeta`/`buildChange`）。

### Phase 4 — 保留与清理（天数 + 数量 + 容量）（依赖 P2 的 metadata 口径）

13. 新增 `apps/client/src-tauri/src/utils/capture_retention.rs`（照 `utils/log_retention.rs`）+ `capture:prune { policies: [{ kind, days, count, maxBytes }] }`：
    - 候选 = `metadata.source === "capture"` 且 `keep !== true` 且 `state !== 'recording'`；
    - 超限 = 天数超限 ∪ 数量超限（按 `capturedAt` 降序取前 N）∪ 容量超限（降序累加超过 `maxBytes`）；
    - **只有 `isManaged === true` 才删文件**（且路径必须落在 `captures/` 内，防越界删除）；记录行一律删；
    - 孤儿回收：`captures/`、`screenshots/` 中未被任何记录引用者，**带 10 分钟 mtime 保护窗口**（为将来录屏每 2 秒落盘兜底）；
    - 返回 `{ ids, freedBytes }`；`#[cfg(test)]` 覆盖：天数/数量/容量/`keep` 免删/`state==='recording'` 免删/外部引用（`isManaged:false`）不删原文件/孤儿保护窗口。
14. 新增 `features/capture/retention.ts`（读设置 → invoke → toast「已清理 N 项，释放 X」），触发点：`App.tsx` 启动就绪、进入捕获库、会话首次写入成功后（节流）。
15. 新增 `features/capture/model/prune-hints.ts`（`findPruneHints(items, policies, now)` → `{ willPrune, reason:'days'|'count'|'size', daysLeft }`，与 Rust 判定同口径）与 `features/capture/model/usage.ts`（按类型汇总条数与占用）+ 前端单测。

### Phase 5 — 捕获库窗口（截屏页 + 录屏页）

16. `views/capture/capture.tsx` = **布局出口**：`Decorations` + 顶部（类型分段 / 相簿选择 / 占用与策略摘要 / 立即清理）+ 相簿侧栏 + `<Outlet/>`。
17. `views/capture/screenshot/screenshot.tsx`（截屏页）、`views/capture/recording/recording.tsx`（录屏页）：时间分组网格 + 多选 + 角标（保存图钉 / 「N 天后清理」/ 超数量 / 超容量）；录屏页额外显示时长角标、文件大小，并带「导入录屏」按钮。
18. 路由（仿 `/agent` 布局 + 子页）：`/capture` 下 `index` → 截屏页、`recording` → 录屏页（懒加载）；更新 `routers/index.test.tsx`。截屏磁贴双击**无需改** `features/magnetic-tile/activate.ts` 与 `constants/magnetic-tile/window.ts`（`findTileRoute('capture')` 即 `/capture`，`WINDOW.capture` 已存在 → 空白窗口问题自然消失）。
19. 复用（不新建播放器）：`library/media-grid.tsx`、`library/media-cell.tsx`（加可选 `badge`/`isKept` props，向后兼容图库）、`library/time-buckets.ts`、`library/date-scrubber.tsx`、`library/use-gallery-scroll.ts`、`lightbox/lightbox.tsx`（已原生支持视频与时长）；**不复用** `library/library.tsx`（props 是图库语义的导入/隐藏）。
20. 「导入录屏」：复用 `views/gallery/import-media.ts` 的 `pickAndImportFiles` 链路，写入改为捕获记录（`captureKind:'recording'`、`isManaged:false`、`state:'done'`、`durationMs` 走 `probeVideoDurationMs`、**原路径不动**），界面明示「清理只移除记录，不会删除你原位置的文件」。
21. 操作：标记/取消保存、加入/移出相簿、删除（记录；`isManaged` 时连文件）、单条预览 / 另存为 / 复制。

## Relevant files

- `apps/client/src/views/overview/overview.tsx` — 移除硬编码快捷键与注册 effect
- `apps/client/src/App.tsx`、`apps/client/src/features/capture/shortcut.ts` — 常驻层注册（main 窗口门控、值随设置变化）
- `apps/client/src/stores/setting.ts` — 唯一持久化源（`plugin-store`）；`apps/client/src/stores/{gallery.ts,album.ts}`
- `apps/client/src/views/settings/{constant.ts,shell.tsx,panels/capture.tsx,panels/shortcut-input.tsx,panels/general.tsx}` — 新分区与录制控件（复用 `panels/section.tsx`）
- `apps/client/src/features/capture/{history.ts,retention.ts,capture-export.ts,capture.tsx,clipboard.ts,model/prune-hints.ts,model/usage.ts}`
- `apps/client/src/views/gallery/model/media.ts`、`views/gallery/import-media.ts`、`views/gallery/model/probe-date.ts`（`probeVideoDurationMs`）
- `apps/client/src/views/capture/{capture.tsx,screenshot/screenshot.tsx,recording/recording.tsx}` + `routers/index.tsx`、`routers/index.test.tsx`
- `apps/client/src/views/gallery/library/{media-grid.tsx,media-cell.tsx,time-buckets.ts,date-scrubber.tsx,use-gallery-scroll.ts}`、`views/gallery/lightbox/lightbox.tsx` — 复用件
- `apps/client/src/shared/ipc/channels.ts` — 加 `ALBUM`
- `apps/client/src-tauri/crates/database/src/{migrations/migrations_v002.rs,migrations/mod.rs,migration.rs,entity/album.rs,lib.rs}`、`crates/core/src/album/service.rs`、`crates/command/src/album.rs`、`src/app/handlers.rs`
- `apps/client/src-tauri/src/utils/capture_retention.rs`、`src/capture/command.rs` — `capture:prune`（照 `utils/log_retention.rs`）

## Verification

1. 前端：`pnpm --filter @i-thinking/client unit`（新增 `formatShortcut`/`isValidShortcut`/`findPruneHints`/`usage` 单测）、`type-check`、`lint`。
2. Rust：`pnpm --filter @i-thinking/client check:cargo`；`cargo test -p thinking-core`；迁移改前/改后各跑一次 `sea-orm-cli migrate status`（只应多出 `migrations_v002` 一行且 Applied）。
3. 手工（`pnpm --filter @i-thinking/client dev`，tauri dev）：
   ① 默认 `Alt+Q` 唤起截屏，**打开设置页后快捷键仍然可用**（本次回归点）；
   ② 改成 `Control+Shift+A` 生效、旧键失效；设成被系统占用的组合 → 明确提示并回滚；
   ③ 截屏→标注→「复制」→ 双击磁贴进捕获库：出现一条记录、图为**含标注的成品**、大小与占用正确；
   ④ 同会话再「另存」→ 仍只有一条记录；
   ⑤ 策略收到 1 天 / 1 张 / 0.1 MB → 其余条目出现「将被清理」角标 → 点「立即清理」→ 只剩「标记保存」那条，`captures/` 同步减少；
   ⑥ 相簿新建/改名/删除/筛选/移出后回「未分类」；
   ⑦ 图库「截屏」叶子不再出现与历史重复的贴图项；
   ⑧ 导入一个 `.mp4` → 录屏页可见、时长与占用正确、点开能播放；把录屏容量配额调到 0 → 清理后**原位置视频仍在**、只少一条记录；
   ⑨ 手工往 `captures/` 放一个无记录的 `.mp4` 后立刻清理 → **不会被删**（保护窗口生效）。
4. `pnpm --filter @i-thinking/client test:e2e`（可扩展一条截屏历史回归）。

## Decisions

- 记录落点：`asset` + `metadata` JSON，**不给 `asset` 加列**（client/studio 共用 `i-thinking.db`，studio drizzle 按列名 SELECT，缺列即报错）；`asset.metadata` 无查询能力 → 列表仍"全量读 + 前端筛"，量级上千后再议专用列/表；`asset:remove` 只删行不删文件，故清理走新命令 `capture:prune`。
- 一次会话一条记录；成品文件固定落 `<AppLocalData>/captures/`（corex 原始暂存 `screenshots/` 仅作暂存，孤儿会被回收）；贴图域零改动（仍写 `textures/`）。
- 保留策略默认值：截图 `7 天 / 100 张 / 500 MB`，录屏 `30 天 / 50 个 / 5 GB`，分类独立配额、三项同时生效。
- 相簿：`album` 表存定义，成员放 `metadata.albums`；加入相簿**不等于**免清理，只有「标记保存」免清理；将被清理的用角标预警。
- 录屏页本期完整实现（含导入入口与播放），**录制采集本身不在范围**；导入的外部文件按 `isManaged:false` 只删记录不删文件。
- 快捷键：保持渲染侧注册、注册点提到常驻层（主窗口只 `hide()` 不销毁，`App.tsx` 常驻即可根治"进设置页就失效"）。
- 文案遵守硬规则：只用「保留最近 7 天」「最多保留 100 张」「最多占用 5 GB」「已保存，不会被自动清理」「3 天后清理」，不出现表名/字段/服务端等术语。
- 范围外：studio 同步（`album` 表对 studio 不可见、无影响，跨端时再补 drizzle schema）、相簿关联表、截屏磁贴 `onTrash` 空实现、分享上传、快捷键迁 Rust。

## Further Considerations

1. 迁移残留风险处理方式：若 `migrate status` 发现 v002/v003 记录，建议**检测到就提示、不静默清库**（由用户决定何时 `fresh`），而不是自动重置。
2. 相簿成员将来若需要 SQL 侧统计（每簿条数、排序/备注），再升级为 `albumAsset` 关联表 + 迁移；当前 metadata 方案在相簿数量增长后仍无查询瓶颈（前端本就全量读）。
3. 录屏采集落地时只需：写 `state:'recording'` 的记录 + 完成后补 `durationMs`/`size` 并改 `state:'done'`；清理引擎与角标口径已就绪，无需改动捕获库主体。
