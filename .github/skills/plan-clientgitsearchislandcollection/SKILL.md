---
name: plan-clientgitsearchislandcollection
description: plan-clientGitSearchIslandCollection
disable-model-invocation: true
---
# 客户端九项修复与重构

一句话：先修两个能直接确认的 bug（`capture:*` 命令名漏了 `rename`、市场网格没过滤集合），再把 Git 能力补齐（仓库切换 + 滚动加载 + 储藏/变基/工作树），然后做两件搜索（全盘文件索引、overlay 灵动岛），最后重构集合建组与磁贴右键菜单。所有改动都在 `apps/client`（含 `src-tauri`），不碰其它 app。

## Steps

### P0 小修（可与任何阶段并行）

1. **`capture:pinTexture` 修复** — `apps/client/src-tauri/src/capture/fs.rs` 的 `capture_pin_texture` / `capture_save_png` 只写了 `#[tauri::command]`，Tauri 回退到 Rust 函数名，所以前端 `invoke('capture:pinTexture')` 找不到命令。补 `rename` 后顺带审计全仓是否还有裸 `#[tauri::command]`。
2. **市场不展示 collection** — `apps/client/src/constants/marketplace/buckets.ts` 的 `matchBoothBucket` 现在只排除 `navigation`，并排排除 `component === 'collection'` 即可；Caption 计数和网格都走同一个函数，自动一致。

### P1 Git 视图

3. **仓库切换（SCM + 提交页）** — 现在 `repoRoot` 恒等于 `workspaceRoot`，切换器只挂在 Explorer 头部。在 `stores/code-git.ts` 加 `activeRepoRoot` + `toSelectRepo`，`toSync` 改为探测所有根、默认选第一个真仓库；把 `workspace-switcher.tsx` 抽出 `icon | bar` 两种形态，塞进 `scm/surface.tsx` 顶部与 `git-search-layout.tsx` 工具栏。切换时清空 `searchHits/commitFiles/selectedOid`，并把 `joinPath` 的基准从 `workspaceRoot` 换成 `activeRepoRoot`。
4. **提交列表滚到底加载** — `git-search-commits-panel.tsx` 加滚动哨兵自动调 `toLoadMoreSearch()`，手点按钮降级为失败重试兜底；判断逻辑抽成 `views/code/lib/near-bottom.ts` 纯函数配单测（照 `diff-hunks-view.tsx` 已有的阈值写法）。
5. **储藏 / 变基** — 后端命令和 `CHANNELS` 都已存在，缺的只是 `lib/workspace-git.ts` 封装 + `stores/code-git.ts` 状态 + UI。共享 UI 放新目录 `features/git-operations/`（对话框、储藏列表、冲突「继续/中止」条），由 SCM 头部「…」菜单接入。
6. **工作树** — 全仓零实现，要新增 `crates/command/src/git/worktree.rs`（`worktree list --porcelain` 解析 + add/remove）、注册到 `handlers.rs`、补 channels/TS 封装/store 状态，UI 进 `features/git-operations/worktree-panel.tsx`。
7. **agent 审阅面板同步接入** — `features/agent/workspace/git.ts` 扩 snapshot 与动作（成功后 `bumpWorkspaceRevision()`），`aside-review.tsx` 复用同一份 `more-menu`，避免两套 UI。

### P2 搜索核心 + 全盘文件索引

8. **命令栏搜索核抽取**（灵动岛的前置） — 把 `omnibar.tsx` 里的 query/防抖/abort/键盘/提交抽成 `features/command-bar/use-command-search.ts`，结果面板抽成受控的 `results-surface.tsx`（带 `placement`）。`omnibar.tsx` 退化为壳，行为不变。
9. **文件索引后端** — 新增 `src-tauri/src/file_index/`：`ignore::WalkBuilder` 并行扫描（`crates/command` 已有 `ignore`/`rayon`/`notify` 依赖），批量事务写入 SQLite（`file_entry` + FTS5 `trigram`，与知识库同款；<3 字回退 `LIKE`），进度事件 + 取消；命令 `search:fileIndexStatus/rebuild/cancel/files`。增量首版只挂用户目录 + 工作区根的 `notify`，USN journal 留作后续（要管理员）。
10. **文件搜索 UI** — `HitDomain` 加 `'file'`（`types.ts` / `constants.ts` / `rank.ts` 三处），新增异步 provider 走 `use-command-search` 的异步 lane（provider 契约是同步的，不能用本地 provider 那套）。结果行显示文件名 + 淡色目录，Enter 打开、`Alt+Enter` 在资源管理器定位；扫描中显示进度并可点重建；设置里加开关。

### P3 overlay 灵动岛（依赖 8）

11. **岛本体** — `views/overlay/island/`：`island-geometry.ts` 纯函数（吸附阈值、贴边露出比例、展开朝向：左右边纵向 / 上下边与自由态横向）+ 单测；三态 `自由圆形 / 贴边半圆 / 展开搜索`；根节点带 `data-region="false"` 交给 `use-through` 接管穿透。**拖拽期间必须铺一層全屏 `data-region="false"` 拖拽罩**，否则 `through/worker.rs` 会把窗口设回穿透，拖到一半就断。
12. **持久化 + 设置** — `features/persist` 加 `overlay` namespace（`searchIsland: { enabled, edge, ratioX, ratioY }`，相对坐标抗分辨率变化），`views/settings/surfaces/appearance.tsx` 加开关，**默认开**；截图态与 `concealed` 时隐藏。

### P4 集合交互 + 磁贴菜单

13. **先修 `collectionID` 清空**（其它步骤的前提）— `Change.collection_id: Option<String>` 无法表达 `null`，导致「移出集合」实际只 bump 了 `updatedAt`。改成 `Option<Option<String>>` + 自定义 deserializer（缺失=不变，`null`=清空）。
14. **Ctrl+单击多选** — 新 `features/controller/use-tile-selection.ts`；正好复用现有「Ctrl 按下禁用 sortable」的语义；`MagneticTile.Section` 加 `isSelected` → `data-selected` + ring。
15. **右键菜单重排** — `layout-menu/items.tsx` 改为按「选中集 + 触发目标」生成分组：集合（加入/移出/新建并移入）、布局、浮层、删除▸；`controller.tsx` 的 `findItems` 用「有没有 `data-id`」区分墙面菜单与磁贴菜单。样式把 `layout-menu.module.scss` 里的 `rgba(255,255,255,…)` 硬编码换成 `--popover/--muted/--border/--primary`。
16. **移除 trash 图标** — 删 `magnetic-tile.tsx` 的删除按钮并清掉 `onTrash` 整条链（约 20 个磁贴组件 + `views/collection`），集合页「移出」迁到右键菜单。
17. **新建集合入口** — 墙面空白右键（新建集合/新建网址）、集合页 `+` 拆成「新建子集合 / 添加已有网址」、Overview 操作栏 `final` 加「+」菜单（这是「怎么建集合装网址」的主要发现点）、命令面板 + 快捷键、「空墙」提示文案。
18. **清理 `collection:reads`** — `channels.ts` 里有常量、Rust 无实现，删掉或补实现（二选一）。

## Relevant files

- `apps/client/src-tauri/src/capture/fs.rs` — 补 `rename`（bug 根因）
- `apps/client/src/constants/marketplace/buckets.ts` — `matchBoothBucket` 排除 collection
- `apps/client/src/stores/code-git.ts` / `stores/code.ts` — `activeRepoRoot`、储藏/变基/工作树状态
- `apps/client/src/views/code/workspace/{scm/surface.tsx, git-search-layout.tsx, git-search-commits-panel.tsx, use-git-search.ts, overlay/workspace-switcher.tsx}`
- `apps/client/src-tauri/crates/command/src/git/{history.rs, worktree.rs(新)}`、`workspaceGit.rs`、`src/app/handlers.rs`
- `apps/client/src/features/command-bar/**` — `use-command-search.ts`、`results-surface.tsx`、`providers/files.ts`、`types/constants/rank`
- `apps/client/src-tauri/src/file_index/**`（新）、`crates/database` 迁移
- `apps/client/src/views/overlay/{overlay.tsx, island/**}`、`hooks/use-through.ts`
- `apps/client/src/features/controller/controller.tsx`、`features/magnetic-tile/**`、`views/collection/**`、`views/overview/caption/trail.tsx`
- `apps/client/src/features/persist/{types,defaults,parse}.ts`、`views/settings/surfaces/{appearance,diagnostics}.tsx`
- 参考实现：`views/code/workspace/diff-hunks-view.tsx`（滚动加载）、`views/signboard/name-dialog.tsx`（轻量命名框）、`features/command-bar/providers/web.ts`（异步 lane）

## Verification

1. `pnpm --filter @cogito/client type-check` / `lint` / `unit`（client 不在根 turbo 里，必须带 filter）
2. `pnpm --filter @cogito/client check:cargo`（worktree / file_index / magnetic_tile）
3. `pnpm dev:client:isolated` 手工验收：贴图不报 `capture:pinTexture not found`；市场磁贴桶无集合卡；SCM 与提交页都能切仓库且不残留旧数据、滚到底自动加载；储藏→弹出、变基冲突出「继续/中止」、工作树可增删；`Ctrl+K` 能命中磁盘文件名；灵动岛拖到左边露半圆、点开纵向、拖到中间变圆形、设置可关；墙上 Ctrl+多选后右键在 navigation/collection 上给不同群组项

## Decisions

- 文件索引走**独立 SQLite**（`<appLocalData>/index/files.db`）而不是主库，避免百万行把主库撑大、拖慢迁移与备份
- 提交分页只能顺序翻页（cursor=上页末 oid），深翻页成本线性上升 —— 滚动加载会更频繁触发，保留 `hitScanCap` 提示
- worktree / 储藏 / 变基的 UI 放 `features/git-operations/` 由 props 驱动，code 窗与 agent 视图各接各的数据源，不新增第三套缓存
- 删除 trash 图标后不保留「隐形」旧路径：`onTrash` 整条链一并删掉（符合「不叠补丁、能删就删」的偏好）

## Further Considerations

1. **文件索引的新鲜度**：首版全盘扫一次 + 只监听用户目录/工作区根 + 手动重建；要不要现在就把 USN journal 做进来（需管理员权限）？建议：先按首版，USN 作为下一轮。
2. **多仓库的粒度**：现在按「选一个根作为当前仓库」实现（VS Code 的 active repository），不是 VS Code 那种一次列出所有仓库并分组展示。若你要的是后者，`scm/surface.tsx` 要重构成「仓库列表 + 每仓库一组变更」，工作量翻倍。
3. **灵动岛与磁贴浮层是否共用一层**：岛放进 `views/overlay` 与现有浮层磁贴同级（推荐，穿透逻辑现成），还是独立一个窗口（可跨显示器，但要新建 Tauri 窗口 + 单独穿透源）？
