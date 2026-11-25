# 图库（gallery）重构方案：文件是真相，索引是派生物

> 目标：把现在的「能看图的网格」重构为「能筛片、能找回、不碰原文件的本地照片库」。
>
> 参考两条路线：
>
> - **Lap**（Rust + Tauri 本地相册）：影子索引、增量扫描三元组、自建 `thumb://` 协议、字节级去重、成组资产、拼音搜索、编辑不碰原图。
> - **Adobe Bridge**（文件夹即库）：星级标准、颜色标签管进度、筛选器、关键词三分法、智能收藏集、三遍筛片流程、批量重命名。
>
> 本文是**方案**（决定 + 依据 + 验收），实现按 §10 阶段推进。文中路径均为仓库内相对路径。

## 0. 一句话

**照片站在原地，库可以随时删掉重建；所有重活进 Rust，界面只负责让眼睛快速做决定。**

三条决定支撑全篇：

1. **派生物原则** —— asset 行、缩略图缓存、哈希、分组、评分全部是派生数据；「删除」= 出库，不动文件；要真删走独立的「移入回收站」。
2. **筛片是一等工作流** —— 星级 / 拒绝 / 颜色 / 关键词不是属性面板的装饰，而是「三遍筛片」的输入；纯键盘必须能跑完全程。
3. **密度与响应优先** —— 缩略图走自定义协议（不落 base64、不落临时文件），网格按行虚拟化，筛选在内存里做。

## 1. 现状审计

当前 `apps/client/src/views/gallery` 共 23 文件 / 3085 行，功能上是「时间分组网格 + 类型精选集 + 灯箱 + 隐藏库」。硬伤按严重度排列：

| # | 问题 | 证据 | 后果 |
| --- | --- | --- | --- |
| 1 | 网格直接加载**原始全分辨率**图片 | `library/media-cell.tsx` 用 `media.src`（`convertFileSrc(filePath)`） | 2 万张 iPhone 照滚动即内存爆、掉帧；没有缩略图管线 |
| 2 | 导入在**渲染进程**逐条完成，EXIF 用 `readFile` 读整个文件 | `views/gallery/model/probe-date.ts` → `@tauri-apps/plugin-fs` `readFile`；`import-media.ts` 逐条 `media:stat` / `asset:insert` | 一张 60MB RAW 进 JS 堆 60MB；500 张导入要很久且全程卡 UI |
| 3 | 导入上限 400 文件 / 深度 4 | `import-media.ts` `MAX_FOLDER_FILES=400`、`MAX_FOLDER_DEPTH=4` | 「几万张」的库根本导不进来，与产品定位矛盾 |
| 4 | 「删除」实际只删数据库行 | `crates/core/src/asset/service.rs` `toRemove` 只删行；UI 按钮文案「删除」（`library/library.tsx` 选择条，destructive 样式） | 用户以为文件被删；或以为只是移除——两种理解都错，信任首先崩在这里 |
| 5 | 任何一次字段修改都**全量重读**整个库 | `stores/gallery.ts` `toHideMedias`/`toRemoveMedias` → `toReadMedias()` | 改一个星级 = 万级 IPC + 全量重建对象，状态更新必然卡 |
| 6 | 没有评级 / 拒绝 / 颜色 / 关键词 / 排序 | `model/media.ts` 元数据只有 `hidden/capturedAt/albums/keep/…` | 无法筛片，只能按时间翻——这正是 Bridge 一文解决的问题 |
| 7 | 搜索只有文件名模糊匹配 | `hooks/use-gallery-search.ts`（Fuse，仅 `fileName/mime/kind`） | 打「gugong」搜不到「故宫」；搜不到标签、相簿、相机 |
| 8 | 相簿表与 store 已存在，图库没有入口 | `crates/database/src/entity/album.rs`、`stores/album.ts` 已被 `views/capture` 使用 | 录像能进相簿、照片不能，同一概念两套体验 |
| 9 | IA 重复且分散 | `ShellFrame` Caption 显示「图库」（`useShellSurface({summary})`），`LibraryToolbar` 又显示一次同名 `h1`；搜索条悬浮在网格底部 | 顶栏与页内工具各占一半，中间那条悬浮胶囊长期压住最后一行 |
| 10 | 渲染全量 DOM | `useStreamedCount` 只做「分片挂载」，最终仍把所有 section / cell 都挂上；`constraints.ts` 明确不引入虚拟化 | 1 万格 = 1 万个 `<button>` + 图片节点；`content-visibility` 只省绘制，不省 DOM |

顺带记录两个「已在但没人用」的能力：`asset:read` 支持 `limit/offset` 却没用；Rust 里已有 `media:probe`（ffprobe 封装，返回时长/宽高/音轨），而图库前端却用隐藏 `<video>` 元素探测视频时长（`import-media.ts` 的 `probeVideoDurationMs`），等于为了一个时长去解码视频。

## 2. 从两篇参考里取什么、不取什么

| 做法 | 出处 | 我们的决定 |
| --- | --- | --- |
| 影子索引：库可删，照片不动 | Lap | **取**。明确「出库 ≠ 删文件」，DB 损坏可用重扫重建 |
| 增量扫描三元组（路径+大小+mtime） | Lap | **取**。扫描记 `size/mtimeMs`，未变即跳过哈希与 EXIF |
| 自建 `thumb://` / `preview://` 协议 | Lap | **取**。替代 base64 与临时文件；`thumb://` 走异步 uri scheme |
| 缩略图「短边不低于目标 1/4、绝不放大」 | Lap | **取**。全景图不被压成一条线；小图原样出 |
| 缓存目录可整体迁移 + 断点续搬 | Lap | **取思路，不取实现**。缓存是纯派生物，直接删了重建即可，不做迁移 |
| 网盘占位文件跳过、不触发下载 | Lap | **取**。Windows 上 `OneDrive` 占位符不哈希、不解码 |
| 字节级去重（size 分组 → BLAKE3） | Lap | **取**。「完全一样」与「长得像」分两个功能，别混 |
| 成组资产：RAW+JPEG / Live Photo / 边车 | Lap | **取**（RAW+JPEG 与 XMP 边车先行；Live/Motion 探测放最后） |
| 拼音搜索（`gugong` → 故宫） | Lap | **取**。中文用户的必需品，成本极低 |
| 人脸聚类 / 地图 R 树 / CLIP 语义检索 / HNSW 相似图 | Lap | **不取**（v1）。模型体积、内存、构建复杂度都超出本轮目标；只保留接口位 |
| 相册软件 = 库；文件夹是唯一真相 | Bridge | **取**。「文件夹即来源」，不做「导入即搬家」 |
| 星级五档 + 每档一个可回答的问题 | Bridge | **取**。把标准写进产品（tooltip / 筛片引导），不是文档里的口号 |
| 颜色标签管进度（待修/半成/已修/已交付） | Bridge | **取**。与星级正交：星级=好坏，颜色=进度 |
| 关键词三分法（人 / 地 / 题材） | Bridge | **取**。只给 3 星以上加，降低维护成本 |
| 筛选器面板 + 智能收藏集 | Bridge | **取**。筛选状态可保存为智能相簿（规则存库，结果实时算） |
| 批量重命名（日期_地点_序号） | Bridge | **取，但要重**。必须 dry-run + 冲突拒绝 + 断点日志，见 §5.6 |
| 三遍筛片、每遍只问一个问题 | Bridge | **取**。做成「待筛」视图里的流程条 |
| Bridge 无库导致跨文件夹搜索慢、盘不在看不到 | Bridge | **不取**。我们本来就有索引，这正是要比 Bridge 强的地方 |

## 3. 目标信息架构

宽窗口三栏（桌面优先），窄窗口退化为现有「底栏双 tab」形态——不是推倒重来，而是同一套视图定义换一种外壳：

```
┌ Caption ─ 图库 · 搜索 ⌘K · 导入 · 视图密度 ──────────────┐
├ Sidebar 216px ┬─────── 内容区 ─────────┬ Inspector 320px ┤
│ 图库           │ FilterBar（生效中的条件）  │ 缩略图           │
│  全部 / 最近   │                          │ 星级 · 颜色 · 拒绝│
│  照片 / 视频   │ 时间分组网格（虚拟化）      │ 关键词（人/地/题材）│
│  截屏          │   ── 2026年11月 ──        │ 相簿             │
│ 智能           │   ── 11月23日 ──          │ EXIF：相机/镜头/  │
│  待筛 / 5星    │                          │ ISO/快门/光圈/GPS │
│  已拒绝        │                          │ 文件名 / 尺寸 / 路径│
│  重复项        │                          │                  │
│ 相簿  +        │                          │                  │
│  京都 2026     │                          │                  │
│ 已隐藏 🔒      │                          │                  │
├ 状态栏 ─ 12,480 项 · 已选 3 · ⌘K 搜索 ────────────────────┤
└──────────────────────────────────────────────────────────┘
```

规则：

- **侧栏 = 视图定义**。`library-view.ts` 里一个视图就是一个纯数据 `{ id, label, icon, filter, sort }`，侧栏只渲染它。智能相簿、相簿、已隐藏都是同一形状 → 新增视图不改 UI 代码。
- **Inspector 只在有选中/预览时出现**，出现时网格列宽自动让位（`Splitter`），不覆盖网格——覆盖式浮层会挡住你要判断的那张图。
- **搜索升级为 ⌘K 命令面板**：同一输入框里搜文件名 / 关键词 / 相簿 / 动作（「按 5 星筛选」「移到回收站」）。底栏那个横向展开的搜索胶囊保留为轻量入口（窄窗口唯一入口）。
- **FilterBar** 常驻内容区顶部，展示当前生效的 chip（`5星+`、`红`、`2026`、`广州`），点 chip 就地取消；「保存为智能相簿」在这一行里。
- 现有「精选集」底栏 tab 的内容并入侧栏「智能」分组，不再单占一个 tab；底栏只在窄窗口出现。
- 标题只出现一次：Caption 显示当前视图名（`summary`），页内不再重复 `h1`。

## 4. 数据模型

### 4.1 每条资产：继续用 `asset.metadata` JSON

不加列（`entity_columns_match_ddl` 要求 entity 与 0001 DDL 严格一致，加列成本远高于收益；筛选在内存里做，也不需要索引）。`model/media.ts` 的 `GalleryAssetMeta` 扩展为：

```ts
interface GalleryAssetMeta {
  // —— 已有 ——
  hidden?: boolean
  capturedAt?: number
  dateSource?: DateSource
  source?: 'import' | 'capture'
  isScreenshot?: boolean
  keep?: boolean
  albums?: string[]
  state?: CaptureState
  captureKind?: CaptureKind
  isManaged?: boolean
  durationMs?: number
  // —— 新增 ——
  rating?: 0 | 1 | 2 | 3 | 4 | 5   // 0 = 未评（默认）
  flag?: 'rejected' | 'picked'      // 拒绝 / 留用
  label?: 'red' | 'yellow' | 'green' | 'blue' | null  // 进度，互斥
  keywords?: { people: string[]; places: string[]; themes: string[] }
  width?: number
  height?: number
  exif?: {                          // 探针一次写入，以后不再读盘
    camera?: string; lens?: string; iso?: number
    aperture?: string; shutter?: string; focal?: number
    takenAt?: number
  }
  gps?: { lat: number; lng: number }
  stackID?: string                  // RAW+JPEG / Live / Motion 成组键
  dupGroup?: string                 // 字节级重复分组键
}
```

约定：

- **缺省即默认**（未评、无标签、无关键词），不需要数据迁移；旧行读出来就是空值。
- **写标签只写库，不写 EXIF/XMP**（Lap 立场：写坏原文件是永久损失）。留一个显式出口：P4 可做「导出 XMP 边车（只写新文件，不覆盖已有）」。
- `stackID` 与 `dupGroup` 由 Rust 计算后随 probe 一起写回，前端只读。

### 4.2 表

- 复用 `album` 表存普通相簿（`name/index/coverAssetID/status`），归属关系统一放在 `asset.metadata.albums`——与现有 `stores/album.ts`、`views/capture` 的用法保持一致，不要另造关联表。
- 新增**一张**表存智能相簿规则（不塞 JSON 到 `album`）：

```sql
CREATE TABLE IF NOT EXISTS gallery_smart_album (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  query TEXT NOT NULL,          -- FilterState 的 JSON（版本化：{"v":1,...}）
  "index" INTEGER NOT NULL DEFAULT 0,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL
)
```

按仓库既有做法：DDL 追加进 `migrations_0001.rs` 的幂等语句块 + 新增 `ensure_gallery_smart_album()` 兜底 + 建 entity 并加进 `entity_columns_match_ddl` 清单。

### 4.3 派生数据（不进库）

缩略图、直方图、分组结果全部可重算。缓存目录：

```
%LOCALAPPDATA%\cogito\thumb-cache\<assetID[0:2]>\<assetID>_<w>_<mtime>.jpg
```

mtime 进文件名 → 文件变了自然换 URL，不需要失效逻辑；LRU 清理 + 总量上限（默认 2 GB，设置项）。

## 5. 后端能力（Rust）

### 5.1 命令清单

| 命令 | 现状 | 目标 |
| --- | --- | --- |
| `media:pick` | ✅ 已选即授权 | 保留 |
| `media:scanDir` | 只回路径；深 4 / 400 | 回 `{ path, size, mtimeMs, isOnlineOnly }`；默认上限提到 5000 且可传参；跳过占位符与系统隐藏文件 |
| `media:probe` | ⚠️ 只有 ffprobe 版（`crates/media/command.rs`），图库没用 | 扩成批量探针：图片走 EXIF/尺寸（只读文件头），视频走现有 ffprobe（带 5s 硬超时） |
| `media:import` | ❌ 前端逐条 | **Rust 一次事务**：scan → probe → 按 `filePath` 去重 → batch insert；`asset:import-progress` 事件流式回报进度 |
| `thumb://` | ❌ | 自定义协议，见 §5.2 |
| `media:hash` | ❌ | BLAKE3 批量；按 size 预分组，mtime 未变复用旧哈希，写 `asset.hash` |
| `media:trash` | ❌ | 移入系统回收站（`trash` crate）；预览影响面后执行 |
| `media:rename` | ❌ | 批量重命名，见 §5.6 |
| `media:watch` | ❌ | 目录监听（`tauri-plugin-fs` watch 已在）→ 防抖后增量 rescan |
| `asset:read` | 全量 | 支持 `limit/offset/kind/时间范围`；首屏 200 条，后续分页补齐 |
| `asset:remove` | 只删行 | 语义改名为「出库」，UI 文案同步；文件操作全部走 `media:trash` |

新增 Rust 依赖：`kamadak-exif`（宽容 EXIF 解析）、`blake3`、`fast_image_resize`（缩略图缩放）、`trash`。

### 5.2 `thumb://` 协议规格

```
thumb://asset/<assetID>?w=384&fit=cover
```

- 注册方式：`register_asynchronous_uri_scheme_protocol`，handler 在 `spawn_blocking` 里解码 → 缩放 → 编码 JPEG q85，直接回字节；不落中间文件、不阻塞主线程。
- **安全边界**：handler 只接受能在 `asset` 表里查到的 `assetID`，路径由库内行给出——不接受任意路径参数，避免把协议变成任意文件读取器。
- 缩放规则（Lap）：
  - 尺寸桶固定 `192 / 384 / 768`，只按桶取，避免缓存碎片；
  - 绝不放大：源短边 < 目标 → 原样输出尺寸；
  - 全景保护：缩放后短边 < `w/4` 时按 `contain` 出图并在 CSS 侧用模糊底兜住，避免压成一条线。
- 格式边界：`image` crate 能解的（JPEG/PNG/WebP/GIF/BMP/AVIF）出真缩略图；**HEIC / RAW 本轮不解码**，回落 `convertFileSrc` 原图 + 角标提示。别假装支持——解码链是独立工程（libheif / LibRaw / 内嵌预览提取），放 P4 再评估。
- 视频：取 ffmpeg 首帧（`media_filmstrip_frames` 已有能力）生成 `thumb://` 封面，替代现在的 `<video>` 当封面（现在一个页面能挂几十个 video 元素在解码）。

### 5.3 导入管线

```
pick → scanDir（一次目录遍历，带 size/mtime）
     → 按 filePath 查库，已存在且 mtime/size 相同 → 跳过
     → probe 批量（并发上限 4，逐条发进度事件）
     → 分组（stackID）+ 事务批量 insert
     → 首帧/缩略图按需生成（滚动到才要，不在导入时全量生成）
```

- 导入**不再**在前端逐条 `invoke`；渲染进程只负责进度 UI 与取消。
- 视频时长改用 `media:probe`（ffprobe），删掉 `import-media.ts` 的隐藏 `<video>` 探测。

### 5.4 增量与重扫

每行记 `size + mtimeMs`。重扫时三元组不变 → 跳过 EXIF 与哈希；只更新 `filePath`（用户挪了文件夹）。文件消失 → 标记 `missing`（新元数据位）而不是删行，浏览时给「位置已失效」角标，盘接回来自动恢复——这是 Lap 里「移动盘拔了照样能翻」的最小版本。

### 5.5 去重（字节级）

1. 按 `size` 分组，孤值直接排除；
2. 组内算 BLAKE3（mtime 未变则复用）；
3. 按 `hash + size` 分组，组内即重复；
4. 写 `asset.hash`（已有 `idx_asset_hash` 索引）+ `metadata.dupGroup`。

UI：侧栏「重复项」视图按组折叠，默认建议保留（分辨率最高 → 星级最高 → 体积最大），一键「其余移入回收站」。**不做「长得像」**——那是相似图，另一个功能。

### 5.6 批量重命名（高风险，单独设闸）

- 规则：`{日期}_{地点}_{序号}`（Bridge 的做法），日期取自 `capturedAt`，地点来自关键词或手填；
- **先 dry-run**：返回 `旧名 → 新名` 全表 + 冲突检测（同目录重名、路径非法字符、只读、文件被占用）；
- 执行：写一行迁移日志（`<cache>/rename-journal.jsonl`）再逐条 rename，中途崩溃下次启动可从日志对账；任一条失败即停止并回滚已改的；
- 不跨盘、不动边车以外的文件（同名字段的 `.xmp` / `.aae` 跟着走）；
- 仅对「导入来源」的资产开放；`isManaged`（截图/录像）禁改，避免打断 capture 的保留策略。

## 6. 前端结构

现状 `views/gallery` 把「模型 + 视图 + 交互」混在 3000 行里，`gallery.tsx` 一个组件扛 8 个 `useState`。目标按**职责**切：

```
views/gallery/
  gallery.tsx              # 装配：视图路由 → 侧栏 / 内容 / 检查器；只做组合
  constraints.ts           # 常量与产品约束（更新 V1_OMITTED、加键盘表引用）
  model/
    meta.ts                # GalleryAssetMeta 读写、默认值、批量 patch 生成
    media.ts               # 类型 + 纯函数（保留，逐步瘦身）
    filter.ts              # FilterState + matches() + 序列化/反序列化（智能相簿用）
    sort.ts
    stack.ts               # 成组：RAW+JPEG / Live / Motion 的展示折叠
    views.ts               # 视图定义表：全部/最近/照片/视频/截屏/待筛/5星/拒绝/重复项
  store/
    assets.ts              # 资产读 / 导入 / 出库 / 回收站；乐观更新
    selection.ts           # 选择集 + 锚点（shift 范围选）+ 全选/反选
    curation.ts            # 评级/拒绝/颜色/关键词（批量、撤销栈）
    albums.ts              # 相簿 + 智能相簿
    view.ts                # 当前视图/筛选/排序/密度（持久化到 Tauri Store）
  data/
    thumbnail.ts           # thumb:// URL 构造 + 尺寸桶 + 视口预取
    import.ts              # 导入流程（进度、跳过、分组、取消）
    probe.ts               # 仅兜底；主路径在 Rust
  ui/
    shell/sidebar.tsx  shell/toolbar.tsx  shell/statusbar.tsx  shell/inspector.tsx  shell/filter-bar.tsx
    grid/grid.tsx      # 虚拟化 + 时间分组 + 密度
    grid/cell.tsx      # 缩略图 + 角标（星级/颜色/组/时长/位置失效）+ 选择框
    grid/scrubber.tsx  # 现有 DateScrubber 迁入
    grid/compare.tsx   # 2/4 联看
    review/culling.tsx # 「待筛」键盘驱动流程
    lightbox/*         # 复用 components/media-lightbox，补评级/标签/EXIF 操作条
    dialogs/batch-rename.tsx  dialogs/dedup.tsx
```

数据流单向：`assets`（真相）→ `view`（筛选/排序）→ 派生列表 → `grid`。`curation` 写库成功后**就地 patch `assets`**，不再 `toReadMedias()` 全量重读（这是现状第 5 条硬伤的解法）。

三条会被复用的东西不要重写：`components/media-lightbox`（灯箱）、`features/capture`（截图入库与保留策略）、`stores/album.ts`（相簿写入）。图库只做入口与展示的补齐。

## 7. 交互规格

### 7.1 键盘（网格/灯箱内，输入态与对话框内不生效）

| 键 | 动作 |
| --- | --- |
| `0`–`5` | 设星级（`0` = 清除） |
| `.` / `,` | 升 / 降一级（二遍三遍最常用） |
| `X` | 标记拒绝；再按一次取消 |
| `P` | 标记留用 |
| `6`–`9` | 颜色：红 / 黄 / 绿 / 蓝；同键再按取消 |
| `Space` | 大图预览；`←/→` 翻页；`Esc` 关闭 |
| `C` | 对比模式（2 宫；再按切 4 宫） |
| `I` | 开关检查器 |
| `Enter` | 进出选择模式；`⌘/Ctrl+click` 加选；`Shift+click` 范围选（以最近点击为锚点，按当前视图顺序） |
| `⌘/Ctrl+A` | 全选当前视图 |
| `⌘/Ctrl+Z` | 撤销上一次评级/标签/出库（栈深 20，toast 同步提示） |
| `⌘/Ctrl+K` | 命令面板 |
| `/` | 聚焦筛选 |
| `G` | 回到网格 |

### 7.2 星级标准（写进产品）

| 档 | 问自己 | 含义 |
| --- | --- | --- |
| 拒绝 | 有硬伤吗？ | 跑焦、手抖、闭眼、误拍 |
| 1★ | 技术过关吗？ | 记录用 |
| 2★ | 有点意思吗？ | 连拍备选 |
| 3★ | 愿意给别人看吗？ | 值得调色、可分享 |
| 4★ | 是这次最好的吗？ | 作品集 |
| 5★ | 一年后还会喜欢吗？ | 代表作，隔时间再给 |

这张表做成：星级 tooltip、筛片流程条上的提示、首次进入「待筛」时的一次性引导。

### 7.3 三遍筛片（`review/culling.tsx`）

「待筛」视图 = `rating === 0 && flag !== 'rejected'`，顶部流程条常驻当前遍次与提示：

1. 第一遍：有没有硬伤？→ `X` 拒绝 / 否则 `1`
2. 第二遍：愿意给别人看吗？→ 是 `3` / 有点意思 `2`
3. 第三遍：哪几张是这次最好的？→ `4`
4. 5★ 不在当天给：侧栏「5★候选」= 4★ 且拍摄于 30 天前

每遍结束显示「本遍 300 张 → 拒绝 41 / 1★ 168 / 3★ 21」，一张都不漏地走完；自动前进由 `Space`/`→` 驱动，评级不自动跳（避免手滑漏看）。

### 7.4 删除语义（必须改，先于一切功能）

| 动作 | 文案 | 行为 |
| --- | --- | --- |
| 出库 | **从图库移除** | 只删 asset 行；文件留在原处；可撤销 |
| 真删 | **移到回收站** | `media:trash` → 系统回收站；同时出库；可撤销（回收站还原） |

两者都是二次确认 + 影响条数；「出库」不写 destroyed 红按钮，用 `outline`。

## 8. 性能预算（验收线）

| 指标 | 目标 | 现状 |
| --- | --- | --- |
| 20,000 张库首屏可交互 | < 1.5s | 全量读 + 全分辨率解码，秒级起不来 |
| 滚动 | 稳定 60fps，无长任务 > 50ms | 图片解码抖动明显 |
| 改一个星级 | < 16ms 出反馈（乐观更新） | 全量重读 |
| 导入 500 张 | UI 不卡；进度可见；可取消 | 前端串行 probe，卡死 |
| 1 万格 DOM 节点 | ≤ 视口行数 + 2 屏缓冲 | ≈ 1 万 |
| 缩略图缓存 | < 2GB，LRU | 无 |

虚拟化取舍：改用按**行**虚拟化（固定列数 → 行高可算），section header 作为行内容 + `sticky top-0` 保留分组感。`constraints.ts` 里「不引入 react-virtual 因为与 sticky 头冲突」的结论需要修订：冲突来自绝对定位行，按行虚拟化 + header 内嵌在行里可解。

## 9. 迁移与兼容

- 旧数据无需迁移：新字段全部可选；`dateSource` 回填逻辑保留但搬到 Rust（导入时一次写完）。
- `asset.metadata` 的写法统一走 `buildChange()`（现状已有），避免各处手拼 JSON。
- 破坏性变更仅两处，且都在 UI 文案层：`asset:remove` 的语义改名、底部 `精选集` tab 并入侧栏。发布说明要写清。
- 被别处复用的模块（`model/media.ts` 的 `toGalleryMedia`、`preview-cache.ts`、`views/capture`）保持导出签名，内部实现可换——先加新接口再删旧函数，别一刀切。

## 10. 阶段计划

每个阶段独立可发布，前三个阶段就能覆盖两篇文章「精华」的 80%。

### P0 地基：缩略图 + Rust 导入（先做，其它都依赖它）

- `thumb://` 协议 + 尺寸桶 + LRU 缓存；`grid/cell.tsx` 切到缩略图 URL；
- `media:scanDir` 返回 stat；新增 `media:import` 事务批量；删掉前端 `readFile` 整文件与 `<video>` 时长探测；
- 导入上限提到 5000 / 深度 8，超限按「分批」提示而不是静默截断。
- **验收**：2 万张库首屏 < 1.5s、滚动不掉帧；导入 500 张全程可交互；缓存目录可清空后自愈。

### P1 筛片管线（Bridge 的精华）

- `meta.ts` 扩展字段 + `curation` store（批量写、乐观更新、撤销栈）；
- 键盘表全量；选择集（shift 范围选、⌘A）；星级/颜色/拒绝角标；
- 「待筛 / 5★ / 拒绝」视图 + 三遍筛片流程条 + 星级标准提示；
- 「从图库移除 / 移到回收站」文案与行为拆分。
- **验收**：300 张一次拍摄全键盘完成三遍筛片；任意评级操作 < 16ms 反馈且不重读全库。

### P2 找得到（Bridge 的第二步）

- `filter.ts` + FilterBar（星级 ≥ / 颜色 / 类型 / 日期区间 / 关键词 / 相簿 / 来源）；
- ⌘K 命令面板（文件名 + 关键词 + 相簿 + 动作）；拼音搜索（`gugong` → 故宫）；
- 排序（拍摄时间 / 文件名 / 大小 / 星级 / 加入时间）+ 视图状态持久化；
- Inspector：EXIF / 尺寸 / 路径 / 关键词 / 相簿 / 直方图（从缩略图 canvas 算，不读原图）。
- **验收**：「三年前旅行的合影」≤ 3 步可达（年 → 地点关键词 → 3★+）。

### P3 整理

- 相簿 CRUD + 拖入 + 封面 + 与 capture 的统一入口；智能相簿（`gallery_smart_album` 表 + 规则编辑）；
- 重复项视图（BLAKE3 分组 + 保留建议 + 批量回收站）；
- 批量重命名（dry-run 全表预览 → 执行 → 日志可对账）。
- **验收**：重复项能识别 100% 字节相同并给出保留建议；重命名在 500 个文件上可中断可续。

### P4 增强（可选，不承诺）

- 成组资产：RAW+JPEG 折叠、XMP 边车随动、Live/Motion 探测；
- 文件夹监听 + 增量重扫 + `missing` 状态；
- `preview://` 大图预览（1024/2048 分桶，避免 45MP 原图解码）；
- HEIC / RAW 解码链（libheif / 内嵌预览提取）；
- 语义检索接口位（本地 CLIP 或复用知识库 embedding 通道），只做「接口 + 单图」验证，不做全库建索引。

## 11. 非目标（本轮明确不做）

人脸聚类、云同步、在线分享、多人协作标注、地图钉与行政区反查、AI 自动打标、写 EXIF/XMP 回原文件、跨设备库。

## 12. 已拍板（2026-11-23）

三条都定了，按「最佳方案」执行，不按最小改动：

1. **相簿：真做。** 「文件夹是真相，相簿是视图」——`album` 表 + `asset.metadata.albums` 已经存在，图库补齐入口（左栏相簿列表、新建 / 重命名 / 删除、选中项加入 / 移出、点相簿过滤）。相簿第一张照片自动做封面；删除相簿只清引用，照片仍在图库。智能相簿（规则表 `gallery_smart_album`）留到 P3 后半，本轮不假装有。
2. **批量重命名：真改文件。** 两段式：`media:rename-plan`（dry-run：旧名 → 新名全表 + 冲突）→ `media:rename-apply`（逐条 rename + `<cache>/rename-journal/rename-<ts>.jsonl` 迁移日志 + 失败整体回滚 + asset 行同步）。冲突即整批拒绝；只对导入来源开放，截图 / 录屏（`source=capture` / `isManaged`）拒绝；边车 `.xmp` / `.aae` 跟着改名。改名成功后可「撤销」：`media:rename-undo` 按迁移日志反向操作（前置校验：文件仍在日志记的新名上、原位置空着），任何一条对不上就整批拒绝；撤销本身也写 `<cache>/rename-journal/rename-undo-<ts>.jsonl`。
3. **AI 语义检索：占位，且诚实。** 新增 `data/search-provider.ts` 抽象：`keyword` / `semantic` 两种 mode。`semantic` 现在回落到关键词结果并返回 `unavailable` 文案，UI 用常驻提示 + toast 明示「索引未构建」；不生成伪造的语义命中。将来接本地 embedding 只换 provider，不动调用点。

验收（本轮已满足）：
- 相簿左栏可建 / 改名 / 删；选中照片可加入 / 移出；点相簿能过滤，计数正确，删除相簿不删照片。
- 重命名 dry-run 全表可见，冲突时执行按钮保持禁用；成功后可看到迁移日志路径；中断后可按 journal 对账（自动续跑留待后续）。
- 打开语义开关能看到「尚未启用」说明，结果集与文件名搜索一致 —— 不出现「看起来像 AI 结果」的假象。

## 13. 实施记录（2026-11-23，P0 地基之一 + P3 两项）

| 能力 | 落地文件 |
| --- | --- |
| `thumb://` 协议 + 尺寸桶 + LRU 缓存（P0 协议部分） | `src-tauri/src/media/thumb.rs`、`app/bootstrap.rs`、`tauri.conf.json` 的 `img-src` |
| 网格改用缩略图，失败回落原图 | `views/gallery/data/thumbnail.ts`、`library/media-cell.tsx`、`library/media-grid.tsx` |
| 相簿入口与 CRUD | `views/gallery/library/album-panel.tsx`、`stores/album.ts`、`views/gallery/gallery.tsx` |
| 批量重命名（真改文件） | `src-tauri/src/media/rename.rs`、`views/gallery/data/rename.ts`、`views/gallery/ui/batch-rename-dialog.tsx` |
| 语义检索占位接口 | `views/gallery/data/search-provider.ts`、`hooks/use-gallery-search.ts` |
| 出库文案与按钮语义修正 | `library/library.tsx`（「从图库移除」）、`gallery.tsx` |
| 相簿过滤 / 计数抽成纯函数并单测 | `views/gallery/data/album-filter.ts` + `album-filter.test.ts` |
| 检索单测：相簿名命中、语义占位只降级不伪造 | `views/gallery/data/search-provider.test.ts` |
| 重命名的文件层抽出 `rename_files` 并单测（真实改名 + journal + 回滚） | `src-tauri/src/media/rename.rs` |
| 重命名撤销（按迁移日志反向、整批校验） | `src-tauri/src/media/rename.rs`（`undo_tasks` / `media:rename-undo`）、`data/rename.ts`、`ui/batch-rename-dialog.tsx` 的 toast action |
| 相簿封面：自动首张 + 手选（单选「设为封面」）+ 左栏缩略图 | `library/album-panel.tsx`、`gallery.tsx` |

已知取舍：
- 缩略图 URL 的 `version` 取 `asset.updatedAt`（不是文件 mtime）。行更新（含改名）会换 URL；文件在库外被覆盖时缓存不会失效 —— 重扫时补 mtime 再换 `version` 是后续项。
- 重命名的 journal 只保证「可对账」，启动时不会自动续跑 / 自动回滚。
- 视频仍用元素解码封面（首帧缩略图属 P4）。
- 语义占位返回的结果与关键词模式**完全相同**（含「相簿名」命中）：相簿 id → 名称由 `gallery.tsx` 的 `albumNames` memo 提供；人脸 / 场景标签入库前不扩检索字段。
- `rename_files` 的回滚只覆盖「本次进程内已改名」的部分；崩溃后按 journal 人工对账，不自动恢复。
- 撤销只针对「本次 apply 返回的那份日志」且未被外部改动：文件被挪走 / 再次改名 / 原位置被占用时整批拒绝，不做部分撤销。
- 相簿封面取 192 桶缩略图，视频相簿不出封面（首帧抽帧属 P4）；缩略图生成失败的格式回落文件夹图标。

仍按 P0 → P4 推进的剩余项：Rust 批量导入事务、按行虚拟化、`media:trash`、重复项（BLAKE3）、智能相簿规则表、文件监听与 `missing` 状态、视频首帧封面、HEIC / RAW 解码。

## 14. 排查记录：图库导入整条链路哑掉（2026-11-23）

**现象**：`dev:isolated` 起来后点「导入照片 / 导入文件夹」没反应或只弹「导入失败」，图库始终为空，没法调试。

**根因**：`media/import.rs` 的三个命令写的是裸 `#[tauri::command]`，注册名就是函数名
（`media_stat` / `media_scan_dir` / `media_pick`），而 `channels.ts` 里 invoke 的是
`media:stat` / `media:scanDir` / `media:pick`。少写 `rename` 不报编译错，只在运行期变成
`Command media:pick not found` —— 选文件那一步就断了，后面 scanDir / asset:insert 全跑不到。

**修复**：三个命令补 `#[tauri::command(rename = "media:stat" | "media:scanDir" | "media:pick")]`；
`gallery.tsx` 的导入失败 toast 改成带原始信息（Tauri 的 reject 是字符串，之前被吞成笼统文案）。

**防回归**：新增 `src/shared/ipc/channels.contract.test.ts` —— 扫 Rust 源码里所有
`#[tauri::command]`（rename 名或函数名），断言 `CHANNELS` 里每个 invoke 频道都能对上；
含一条「故意构造未注册频道必须被抓到」的自检，防止正则退化后假通过。
以后再新增命令，`pnpm --filter @cogito/client test:unit` 就会拦住这类「名字对不上」的哑火。

