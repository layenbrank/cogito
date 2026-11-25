# 图库重构 · 决策记录（含被否决的候选项）

> 本文记录实施过程中**由实现方做出的取舍**，每条都写明「选了什么 / 为什么 / 还有什么备选」。
> 目的是让后来的人能判断某个决定是否需要翻案，而不是看到一份只写结论的说明书。
>
> 对应计划：`docs/apps/client/gallery.md`（方案）+ 会话计划文件。日期：2026-11-24。

## D1 图库数据放侧表，而不是给 `asset` 加列

- **选择**：新增 `galleryAsset`（1:1，`assetID` 主键）+ `galleryAlbumAsset` / `galleryKeyword` / `gallerySmartAlbum` / `galleryRoot` 四张表。
- **原因**：`asset:update` 是**全量覆盖**语义（`Change = Insert`），且被 capture / clipboard / signboard 共用。给 `asset` 加十几列会让这 4 个域全部进入「必须逐列原样回传」的脆弱状态；`contentHash`、`probedAt` 这类列会被旧前端用陈旧实体清成 NULL。侧表把爆炸半径限制在图库。
- **代价**：catalog 查询多一次 `galleryAsset` 读取（内存合并，不做 JOIN）；出库时要显式清理侧表（已在 `asset::Service::toRemove` 路径外做孤儿清扫）。
- **备选**：
  - A. 直接给 `asset` 加列 —— 查询更简单，但跨域脆弱（已否决）。
  - B. 把策展字段塞回 `metadata` JSON —— 零 schema 变更，但无法索引/聚合，10 万张库撑不住（已否决）。
  - C. 侧表拆成多张（策展 / 探测分开）—— 更细粒度，但每多一张表就多一次 join 与一次生命周期维护，收益不明显。

## D2 不动 `migrations_0001.rs` 基线，走 `gallery_schema.rs` 双路执行

- **选择**：DDL 单源放 `migrations/gallery_schema.rs`；基线 `up()` 调一次，启动 `migration::ensure_gallery()` 再以 `IF NOT EXISTS` 兜底。
- **原因**：仓库既定范式（`agent_plan_schema` / `run_cost_schema` 同款）；老库不会重跑基线，只靠基线就永远建不出新表。
- **备选**：新增迁移版本 `0002` —— 更「标准」，但与仓库「单文件基线 + 幂等补列」的约定冲突，且 `migrate:fresh` 流程会分叉。

## D3 不引入 `@tanstack/react-virtual`，手写行窗口化

- **选择**：`ui/grid/virtual-grid.tsx` 用「前缀和 + 二分找可视行」。
- **原因**：`docs/apps/client/code-window.md` 已有「等宽行手写窗口化足够」的结论；照片墙布局规则固定（列数 × 正方形单元 + 已知高度的分组头），前缀和能精确算出可视区间，也能让分组头作为普通虚拟项渲染。
- **备选**：
  - A. `@tanstack/react-virtual` —— 生态成熟，但动态测量与「分组头 + sticky」的历史冲突仍需自己绕（已否决）。
  - B. 保留 `content-visibility` + 分片挂载 —— 即现状，DOM 仍是全量（已否决）。

## D4 分组头不做 sticky，改用顶部浮动日期胶囊

- **选择**：分组头是虚拟项（随时可被回收），顶部单独一个浮动 `YYYY年M月D日` 胶囊指示当前位置。
- **原因**：sticky + 绝对定位行是旧文档里「不敢上虚拟化」的根因；把锚点从「每段吸顶」换成「一个浮动胶囊」，两个问题一起消失，且滚动时信息密度更高。
- **备选**：
  - A. 每段 sticky —— 与虚拟化冲突（已否决）。
  - B. 右侧刻度条（`DateScrubber`）—— 保留能力，等虚拟网格暴露 section 偏移后再接（见「剩余工作」）。

## D5 catalog 一次给全量紧凑行，筛选/排序在内存做

- **选择**：`gallery:catalog` 返回全部非归档 asset 的紧凑行（约 20 字段），前端筛选/排序/分组/计数全在 `model/derive.ts` 里做。
- **原因**：改一个星级不该触发全库重读；筛选也不该每次按键都打 IPC。10 万行 × 20 字段的一次性 IPC 远便宜于「每次交互一轮往返」。
- **备选**：
  - A. 服务端 `limit/offset` 分页 + SQL 筛选 —— 超大库更稳，但刻度过期、拖动会闪（暂不采用）。
  - B. 二进制列式编码（`Int64Array`）—— 更快，工程量与调试成本高（留作 >20 万张时的升级路径）。
- **阈值**：若 `gallery:catalog` 在 5 万行上超过 ~400ms，或内存占用异常，切 A 方案。

## D6 搜索（含拼音）下沉到 Rust，catalog 不带 `searchText`

- **选择**：`searchText`（小写文件名 + 全拼 + 首字母 + 关键词）作为 `galleryAsset` 的一列，由 `gallery:search` 用 SQL `LIKE` 查；catalog 不携带该字段。
- **原因**：`searchText` 大约让每行载荷翻倍；打字只值一次 5–15ms 往返。
- **备选**：前端用 Fuse + 自带拼音表 —— 零 IPC，但拼音表要打进前端包，且 10 万行模糊匹配比 SQL 慢（已否决）。
- **已知限制**：`LIKE '%x%'` 走全表扫。10 万行量级可接受；再大要换 FTS5（`knowledge_doc_fts` 已有先例）。

## D7 相簿归属改关系表，`metadata.albums` 降级为一次性回填源

- **选择**：`galleryAlbumAsset(assetID, albumID, addedAt)`；启动时按 `seedMark: gallery-backfill-v1` 从 `metadata.albums` 回填一次。
- **原因**：相簿计数、按相簿过滤、相簿名参与检索都需要可索引的关系；JSON 数组做不到聚合。
- **备选**：保留 JSON + 前端过滤 —— 省事，但「相簿里有多少张」每次都要全库遍历，且无法在 SQL 侧检索（已否决）。
- **注意**：`features/capture/history.ts` 仍会写 `metadata.albums: []`（透传旧值）。它**不会**破坏侧表，但会让该字段成为死数据；彻底清理见「剩余工作」。

## D8 删除语义拆成两条路径

- **选择**：`gallery:trash`（移到系统回收站 + 删索引行）与「从图库移除」（只删索引行，后续接命令面板动作）分开；UI 文案与按钮样式区分（destructive vs outline）。
- **原因**：旧实现「删除」只删库行，用户以为文件没了 —— 信任成本最高的一个 bug。
- **备选**：统一成「回收站」一个入口 —— 语义简单，但「只想从库里拿掉、文件留着」是真实需求（已否决）。

## D9 导入用 Rust 一次跑完，不再在前端读整文件

- **选择**：`gallery:import(paths)` 在 Rust 侧 stat → EXIF（`kamadak-exif`，只读容器）→ 尺寸（`image` 只读文件头）→ 插 asset → 写侧表 → 发 `gallery://import-progress`。
- **原因**：前端 `readFile` 把 60MB RAW 读进 JS 堆；逐条 `invoke` 让 500 张导入卡死 UI。
- **备选**：
  - A. 前端 `exifr` + 批量 `asset:insert` —— 无 Rust 依赖，但内存与阻塞问题依旧（已否决）。
  - B. Rust 侧全量解码取尺寸 —— 更准，但一张 45MP RAW 要几百毫秒，只为拿宽高不值（已否决）。

## D10 成组判定先用「同目录同主名」

- **选择**：导入时对本次入参按 `(父目录, 主名)` 分组，同组 >1 个文件则写同一个 `stackID`。
- **原因**：零额外 IO，覆盖 RAW+JPEG、HEIC+MOV（Live Photo）这两类最常见情况。
- **备选**：
  - A. 扫父目录全量比对 —— 更全（能补上「本次只导入了一半」的情况），但要为每个文件列目录（已推迟）。
  - B. 解析 Apple 的 content identifier（Live Photo 的权威判据）—— 最准，属于 P4 增强（已推迟）。

## D11 图库页壳：Caption 只放标题，搜索/工具条在内容区

- **选择**：`useShellSurface({ summary: '图库', scrollable: false })`，搜索框与密度/导入按钮放内容区顶部工具条。
- **原因**：`useShellSurface` 每次传新 JSX 都会触发 Caption 重渲；把受控输入放在 Caption 里会让每次击键重渲整个顶栏。放内容区既稳定又不会和窗口控件抢位置。
- **备选**：按原计划放 Caption `center` —— 视觉更「原生应用」，但需要额外的槽位稳定化机制（可后续优化）。

## D12 视频封面暂用元素解码
- **选择**：视频格仍用 `<video preload="metadata">`，但虚拟化后同屏最多几十个，不再是旧实现的「全量 N 个」。
- **原因**：ffmpeg 首帧抽帧需要新的缓存键协议与预热策略；先把网格从 O(N) 降到 O(视口)。
- **备选**：`thumb://` 支持 `frame=0` 并缓存（P4 增强，见剩余工作）。

## 剩余工作（本次未完成，已明确记录）

0. **回收站落点**：`gallery:trash` 目前把文件挪到 `<cache>/cogito/gallery-trash/<时间戳>_<原名>`，
   **不是系统回收站**。原因：系统回收站要平台 FFI（Windows `SHFileOperationW` + `FOF_ALLOWUNDO`、
   macOS `NSFileManager.trashItem`），而本轮新增 crate 的下载被镜像 504 阻断。
   备选：A. 加 `trash` crate（最省事，等镜像恢复即可）；B. 自己写 `SHFileOperationW`（零依赖，需 `windows` crate 的 `Win32_UI_Shell`）；
   C. 保持应用内回收目录（可恢复、可解释，但用户找不到系统回收站里的它）。
0. **EXIF 拍摄时间**：同样因镜像 504 去掉了 `kamadak-exif`，改为**自实现 TIFF IFD 读取**
   （只取 `DateTimeOriginal`，扫描文件头 512KB）。覆盖 JPEG/TIFF 容器；HEIC 的 EXIF 在 ISO-BMFF box 里，
   目前拿不到 → 回落到 mtime。备选：A. 接回 `kamadak-exif`（宽容度高）；B. 补 HEIC 的 `meta` box 解析。

1. **capture 页迁移**：`views/capture` 仍用旧的 `MediaGrid` / `useGalleryScroll` / `stores/gallery`。新的 `VirtualGrid` 可直接复用，但需要把 capture 的数据源换成 catalog 视图（按 `source === 'capture'` 切）。
2. **旧文件清理**：`views/gallery/gallery.tsx`（已不被路由引用）、`collections/*`、`hooks/use-streamed-count.ts` 仍留在仓库里，等 capture 迁移完成后一并删除。
3. **右侧刻度条**：`DateScrubber` 需要虚拟网格暴露 section 偏移表（`scrollToKey`）。
4. **重复项 / 批量重命名 UI**：后端已有 `media:rename-*` 与 `dupGroup` 列，缺去重计算（BLAKE3 批处理）与对应视图的对话框。
5. **HEIC / RAW 缩略图**：`thumb://` 目前对这些格式回 404 → 前端回落原图。需接 FFmpeg sidecar 或 `libheif-rs`。
6. **语义检索**：`gallery:semantic-*` 命令与模型下载、LanceDB 索引均未实现；当前 `data/semantic` 仍是降级占位。
7. **文件监听**：`galleryRoot` 表已就绪，`notify` 监听与增量重扫未接。
8. **命令面板联动**：`features/command-bar/providers/gallery.ts` 仍读 `stores/gallery`（旧全量 store），需切到 catalog store。

---

## D13 去重哈希用 SHA-256，而不是 BLAKE3

- **选择**：`sha2`（crates.io 早已在依赖里，token 签名在用）+ `hex`。
- **原因**：BLAKE3 需要新 crate，本轮镜像对 crates.io 持续 504；SHA-256 的语义（字节级完全相同）与 BLAKE3 一致，只慢 3–5 倍，而这是**一次性维护命令**，不是热路径。
- **备选**：A. `blake3` crate（更快，等镜像恢复即可换，接口只需改 `dedupe.rs` 里 `hash_file` 一处）；B. xxHash（最快但不是密码学哈希，去重误判代价高，不建议）；C. 复用 `asset.sha` 列（会被 `asset:update` 全量覆盖清空，且语义是「摘要来源」而非内容哈希）。

## D14 相似图用 aHash，语义检索保持诚实占位

- **选择**：`gallery:compute-phash` 用 `image` crate 把图缩到 8×8 灰度、与均值比较得到 64bit aHash，存 `galleryAsset.phash`；`gallery:similar` 用汉明距离（阈值 12、上限 63 条）找相似。
- **原因**：原计划是 CN-CLIP 双塔 + ONNX Runtime + 模型下载，本轮两项前提都不具备（新增 `ort` crate + 数百 MB 模型下载）。aHash 零新依赖、能真正回答「找出同一次拍摄的几张废片」，只是不吃自然语言。
- **备选**：A. `ort` + CN-CLIP ViT-B/16 + LanceDB（原计划，等依赖可用）；B. 渲染进程 WebGPU 跑 transformers.js（零 Rust 依赖，但只在图库页打开时能索引）；C. 纯占位不做（会失去「找相似」这个真实可用的能力）。
- **保留的接缝**：`data/search-provider.ts` 的 `semantic` 模式仍返回 `unavailable` 并明示「索引未构建」，不伪造语义命中。

## D15 批量重命名复用旧对话框（临时桥）

- **选择**：`data/legacy-media.ts` 把 catalog 行转成旧 `GalleryMedia` 形状，喂给既有 `ui/batch-rename-dialog.tsx`；真正的改名仍由 Rust `media:rename-plan/apply/undo` 执行（它读数据库里的真实行，预览字段只用于渲染）。
- **原因**：对话框已有 dry-run 全表预览、冲突禁用、journal、撤销，重写一遍不划算；桥文件只有 40 行且标注了删除条件。
- **备选**：A. 把对话框改成 catalog 行类型（更干净，但涉及 330 行改动）；B. 直接删掉重命名入口（功能回退，不可接受）。

## D16 目录监听暂缺，改为手动重扫

- **选择**：`gallery:rescan`（工具栏「重扫位置」按钮）检查每个文件是否存在，写 `missing` 标记；插回盘自动恢复。
- **原因**：实时监听需要 `notify` crate（镜像不可用）；`tauri-plugin-fs` 的 watch 事件在插件内部，接到 Rust 侧要再建一条桥，复杂度大于本轮收益。
- **备选**：A. `notify` crate（最直接）；B. `tauri-plugin-fs` watch + 前端转发（能用，但多一跳）；C. 定时轮询 rescan（成本可控但会打扰磁盘）。

## 更新后的剩余工作

1. **capture 页迁移**：`views/capture` 仍用旧 `MediaGrid` / `useGalleryScroll` / `stores/gallery`；新的 `VirtualGrid` 可直接复用。
2. **旧文件清理**：`views/gallery/library/*`、`hooks/use-streamed-count.ts`、`stores/gallery.ts`（capture 迁移后一次性删）。
3. **右侧刻度条**：`DateScrubber` 需要虚拟网格暴露 section 偏移表（`scrollToKey`）。
4. **HEIC / RAW 缩略图**：`thumb://` 对这些格式回 404 → 前端回落原图。可接随包 FFmpeg（先验证 `ffmpeg -decoders` 是否含 hevc）或 `libheif-rs`。
5. **语义检索**：`gallery:semantic-*` + 模型下载 + LanceDB 索引（见 D14 备选 A/B）。
6. **目录监听**：见 D16。
7. **命令面板联动**：`providers/gallery.ts` 切到 catalog store。
8. **系统回收站**：见剩余工作第 0 条（应用内回收目录 → 系统回收站）。
9. **EXIF 的 HEIC 分支**：自实现解析只覆盖 JPEG/TIFF 容器；HEIC 的 EXIF 在 ISO-BMFF `meta` box 里。

---

## D17 HEIC / RAW / 视频首帧统一走 FFmpeg 兜底（supersedes D12 的一部分）

- **选择**：`thumb://` 先用 `image` crate 解码；失败时调随包 FFmpeg 抽一帧：
  `ffmpeg -v error -nostdin -i <src> -frames:v 1 -vf scale=... -f image2pipe -vcodec mjpeg -`，
  结果同样落进缩略图缓存（键仍是 `assetID + bucket + mtime`）。
- **原因**：HEIC 要 libheif、RAW 要 LibRaw，都是 C 依赖，而本轮镜像拉不到新 crate；应用本来就随包带 FFmpeg 9.0.2（剪辑模块在用）。顺手把视频首帧也解决了 —— 网格里不再需要 `<video>` 元素（`ui/grid/cell.tsx` 已统一走 `<img>` + `thumb://`）。
- **代价**：每个未缓存的 HEIC/RAW/视频会 fork 一次 ffmpeg（几十到几百毫秒），首屏会有一次「逐渐出图」；命中缓存后零成本。会话内不做并发限流，若实测 CPU 抖动明显，再加信号量（上限 2–4）。
- **备选**：A. `libheif-rs` + `rawler`（纯 Rust 路径，无进程开销，但要 cmake / 新 crate）；B. Windows WIC（依赖系统 HEIF 扩展，跨平台不成立）；C. 只回落原图（HEIC 在 WebView 里根本显示不出来，等于不可用）。
- **验证方法**：拿一张 iPhone HEIC + 一段 MP4 放进图库，确认网格里两张都有图；`ffmpeg -decoders` 里应能看到 hevc/heif 支持（若随包 ffmpeg 未编 libheif，则会回 422，此时再切备选 A）。
- **已知边界**：RAW 走的是「FFmpeg 能解的容器」；若某相机 RAW 不被 ffmpeg 支持，仍回 422（前端回落原图，显示为破图 + 缺失角标）。

---

## D18 启动时自动跑一次 `rescan`（代替目录监听）

- **选择**：图库页挂载时（每会话一次）静默调 `gallery:rescan`，有变化才重新读 catalog。
- **原因**：`notify` crate 不可用（D16），但「点开才发现图没了」是最烦人的体验之一。启动自检只做 `path.exists()`，10 万行大约几百毫秒到 1–2 秒，而且只在打开图库时发生。
- **代价**：首次打开图库会多出一轮 `stat`；`rescan` 在 async 上下文里做同步 IO，期间会占住一个 tokio worker。若实测卡顿，把它改成 `spawn_blocking` + 分批（一次 2000 行）。
- **备选**：A. `notify` 实时监听（真解，等依赖）；B. `tauri-plugin-fs` watch + 前端转发；C. 定时轮询（会持续打扰磁盘，不选）。

## D19 命令面板的图库 provider 改读 catalog store

- **选择**：`features/command-bar/providers/gallery.ts` 从 `useGalleryStore.medias` 改为 `useCatalogStore.rows`，Fuse 键改为 `name/kind/mime`。
- **原因**：旧 store 只有在打开 capture 页时才会被填充；图库重构后命令面板的图库命中会默默变空 —— 这种「不报错但没结果」的退化最难被发现。
- **备选**：A. 保留旧 store 并在图库页也喂一份（双份真相，不选）；B. provider 直接调 `gallery:search`（异步 provider 支持但每次击键一轮 IPC，不如内存 Fuse 快）。

## D20 导入支持目录递归（修「导入失败」）

- **现象**：点「导入」后提示失败 / 导入 0 项。
- **根因**：`media:pick` 的 `folders` 模式返回的是**目录路径**，而 `gallery:import` 把每个路径
  当成文件去按扩展名猜 mime，于是每个目录都落到「不支持的格式」。
- **修法**：`gallery:import` 现在对入参逐个判定：目录 → 递归收集（深度 8、单次上限 20000 个文件、
  跳过点开头隐藏项）并登记为 `galleryRoot`；文件 → 直接收录；不存在的路径 → 明确记为
  「路径不存在」。文件清单按绝对路径去重。前端加了独立的「导入文件」按钮
  （`media:pick` 一次只能选文件或文件夹，所以拆成两个入口）。
- **验证**：选一个含 JPG/HEIC/MP4 的文件夹 → 状态栏应显示「导入 N 项」；HEIC/MP4 的缩略图
  由 D17 的 FFmpeg 兜底生成（首次几十毫秒，之后命中缓存）。
- **若仍失败**：状态栏会带上失败条数；逐条原因（不支持的格式 / 路径不存在 / 探测失败）
  来自 `gallery:import` 的 `failed[]`。数据库写入本身失败会以异常形式回到 UI。

## D21 图库 UI 一律用组件库，不手写原生控件

- **选择**：
  - 下拉 → `Select` / `SelectTrigger` / `SelectContent` / `SelectItem`（自定义浮层，**不用** `NativeSelect`）
  - 可点击控件 → `Button`（含网格单元：`variant="ghost"` + `h-auto w-full p-0` 覆盖高度，保住 `aspect-square`）
  - 开关型筛选 chip → `Toggle`（`variant="outline" size="sm"` + `rounded-full`），拿到 `aria-pressed` 与统一 focus 环
  - 文本输入 → `Input`；面板分栏 → `Splitter`
- **原因**：原生 `<button>/<select>` 会绕开设计 token（focus 环、hover 底色、disabled 透明度）与无障碍语义，
  后续主题改动会漏掉这些地方；`NativeSelect` 的展开列表由系统控件绘制，圆角/内边距/悬停色一个都改不了，
  与设计系统观感不一致。
- **`Select` 的两个坑**：
  1. `Select.Value` 默认渲染**原始 value**；选项值是 id / 枚举键时必须给 Root 传 `items={[{ value, label }]}`，
     否则触发器会露出 `capturedAt`、UUID 这类裸值。
  2. 「加入相簿…」这类占位态要自己维护 `pendingAlbum` 并在选完后置空，否则第二次选同一项不会触发 `onValueChange`。
- **例外**：`<img>` 缩略图、纯排版用的 `<div>/<span>`、以及 `VirtualGrid` 里的 `role="listbox"/"option"` 布局容器
  保留原生 —— 它们不是交互控件。
- **备选**：A. `NativeSelect`（系统下拉更稳、零 Portal，但与设计系统观感不一致，已按用户要求否决）；
  B. 保留原生 `<select>`（改动最小，但不跟主题）。

## D22 右侧刻度条做在 `VirtualGrid` 内部，不再复用旧的 `DateScrubber`

- **选择**：`VirtualGrid` 自己算刻度。分组头本来就是虚拟项（带 `top`），把它们的 `top` 按
  `top / total` 比例定位成右侧一列 3px 圆点；点击直接把 `scrollTop` 设到该分组头（`behavior: 'auto'`，
  跳转不该有滚动动画）。分组超过 40 个时用 `sampleTimelineMarks` 等距抽样，但**保留最后一个**。
- **原因**：旧的 `DateScrubber` 靠 `querySelector` 找 `[data-gallery-section]` 再读 `offsetTop` ——
  虚拟化之后未渲染的分组根本不在 DOM 里，读数会全错。刻度数据本来就只有网格自己知道，
  放在外面必然要通过 ref/props 反传，属于「为解耦而解耦」。
- **副作用**：滚动位置到「块坐标」需要减掉滚动容器的 `pt-8`（`PAD_TOP`），浮层日期和刻度高亮
  共用同一个 `blockOffset`，三处口径统一。
- **备选**：A. `VirtualGrid` 通过 `onSectionsChange` 把偏移表抛给页面，页面再渲染刻度（多一层状态同步，
  且初次渲染前刻度是空的）；B. 保留 DOM 查询的旧实现（虚拟化下不可用）。

## D23 capture 页继续用旧的 `library/MediaGrid`，不并入新网格

- **选择**：capture 保留 `views/gallery/library/{media-grid,media-cell,date-scrubber,time-buckets,use-gallery-scroll}.tsx`；
  同时删掉已经没人引用的 `library/library.tsx`、`library/album-panel.tsx`、`library/timeline-axis.tsx`，
  以及 `hooks/use-gallery-{assets,search}.ts`、`data/{search-provider,album-filter}.ts`（连同测试）。
- **原因**：capture 的两个语义不在 `galleryAsset` 里 —— `meta.keep`（「永久保留」会反过来喂给
  `findPruneHints` 的保留策略，决定哪些截图会被清理）和 `meta.captureKind`（截图 / 录屏分栏）。
  这两者现在住在 `asset.metadata` JSON 里，backfill 时没有进 `galleryAsset`；硬迁等于先把 schema、
  `toBackfill`、retention 三处一起改，风险远大于收益（capture 是已上线的功能，清理策略错了会**丢用户的截图**）。
- **条件**：等 `galleryAsset` 真的需要 `keep` / `captureKind`（比如图库里也要按「保留」筛）时再迁，
  届时 capture 只是换个数据源，UI 语义可以整段照搬。
- **备选**：A. 立刻给 `galleryAsset` 加 `keep`/`captureKind` 两列并迁 capture（一次性消除两套网格，
  但要重跑 retention 测试并迁移存量 `asset.metadata`）；B. 两套网格长期并存（现状）。

## D24 原图也走 `thumb://`（`/o/<assetID>/<version>`），并且协议要先百分号解码

现象：图库网格里所有缩略图 `GET http://thumb.localhost/%2Ft%2F…-cover.jpg 400`。

- **400 的根因**：`convertFileSrc` 会把**整条路径**编码成一段（`/t/x/384/1-cover.jpg` →
  `%2Ft%2Fx%2F384%2F1-cover.jpg`），而自定义协议拿到的 `uri().path()` 是**未解码**原文，
  于是第一段不是 `t`，`parse_thumb_uri` 直接判非法。修法：`serve` 里先 `percent_decode` 再解析，
  并顺手把「纯点号 token」挡掉（解码后 `%2E%2E` 会变成 `..`）。
- **同时发现的第二个问题**：灯箱/回落的原图地址原来用 `asset://`（`convertFileSrc(row.path)`），
  但 `tauri.conf.json` 的 `assetProtocol.scope` 只放行 `$APPLOCALDATA` 等应用目录，
  用户照片在 `D:\Photos\…` 会被拦。选择**不**把 scope 放宽成 `**`（那等于把整个磁盘交给渲染进程），
  而是在同一个协议里加原图通道：`/o/<assetID>/<version>`，规则与缩略图一致 —— 只认库内 assetID。
- **Range**：`/o/` 实现了 `bytes=start-end` / `bytes=start-` / `bytes=-N`，命中回 206 带 `Content-Range`；
  视频拖动进度条必须要它（否则 WebView 只能播完不给 seek）。
- **缓存**：两条通道都带 `version`（mtime）→ `Cache-Control: immutable`，文件变了 URL 自然变。
- **备选**：A. `assetProtocol.scope` 加 `**`（一行改完，但等于开放任意文件读取）；
  B. 前端把原图 base64 内联（大图内存爆、无法 seek）；C. 再注册一个 `preview://`（与 `thumb://`
  功能重叠，还要多维护一套 scope）。

## D25 性能与正确性复审（一次集中收敛）

复审前提：`Storage` 是 `max_connections(1)` —— **所有**命令排队在同一条 SQLite 连接上，
所以「往返次数」比「单条语句快不快」更决定手感。

### 正确性

- **`toWriteDerived` 静默丢数据**：侧表行不存在时直接 `return Ok(())`。而 dedupe / phash / rescan
  都是「先写派生、后面才可能有别的路径建行」，于是这些派生数据被丢掉 —— 表现为「点了去重没反应」。
  改成 upsert（缺行就补 `blank_row`）。
- **关键词筛选恒为空**：`matchesFilter` 要求外部传 `keywordIDs`，而 `findViewRows` 一直传 `undefined`，
  于是任何按关键词 chip 的筛选都把整个网格滤空。改为直接在 catalog 行上比对（catalog 现在带 `keywords`）。
- **图库混入非媒体**：`asset` 是各域共用的表，旧 catalog 把 PDF / 文档全端给网格。改为只收
  `kind ∈ {image, video}`；dedupe / phash / rescan 同步收窄（对 PDF 做字节去重没有意义，还白烧 CPU）。
- **网格单元缩略图过期**：`src` 存在 `useState` 里，只在挂载时算一次 —— 换列数（桶变）或文件被
  覆盖/改名（mtime 变）后仍显示旧 URL。改为从 props 现算，只记录「哪个 URL 失败过」，
  URL 一变就自动重试。
- **`ActiveModelTrait::insert` 在 SQLite 上会报 `Failed to find inserted item`**：它插入后会按
  TEXT 主键做一次 RETURNING 回查，而这套驱动上拿不到行。`toWriteProbe` 正好走这条路径 ——
  也就是「每次导入新文件」都会失败（表现成导入报错，而旧代码里没人验证过）。
  全部改成 `Entity::insert(model).exec(db)`（只发 INSERT）；已用真实 SQLite 测试钉住
  （`curate_updates_existing_and_creates_missing_rows` / `probe_write_creates_side_row` 等）。

### 查询次数（单连接下最贵的东西）

| 场景 | 之前 | 现在 |
| --- | --- | --- |
| 全选改星级（N 张） | 2N + 每次 `keep`/关键词再 +6 | 1 次 SELECT + 1 次 `update_many` + 分块 insert |
| 加入相簿（N 张） | 2N | 1 次 SELECT + 1 次 `insert_many` |
| 导入 2 万张 | 每文件 6 条语句、独立自动提交 | 每文件 6 条语句、**200 个一事务** |
| 去重 / 指纹 / 重扫 | 每文件 2 条语句、逐条提交 | 攒起来，`toWriteDerivedMany` **一个事务** |
| 启动图库 | catalog ×3（facets、albumCounts 各再读一遍整库） | catalog ×1 |
| 每次进入图库 | 全库 `stat` 一遍 | 每会话一次 |

- **facet / 相簿角标移到前端**：`gallery:facets`、`gallery:album-counts` 两条命令删掉。
  它们各自把整库再读一遍（3 次全表扫描 + 3 遍 JSON 解析），而 catalog 本来就在渲染进程里，
  改成 `findFacets` / `findAlbumCounts` 两个纯函数（O(n) 一次遍历，有单测）。
- **导入热路径**：一次 `metadata` 同时拿 size+mtime（原来 3 次 stat）；EXIF 只对图片读、且只读前
  128KB（原来对每个文件含视频都读 512KB，2 万张 ≈ 10GB 无谓 I/O）；「是否已入库」改成一次性
  取回所有 `filePath` 做集合判断；进度事件按「每 20 个或 150ms」节流；目录递归丢进 `spawn_blocking`。
- **感知哈希走缩略图缓存**：`image::open` 会解整张像素矩阵（48MP JPEG 30–60ms），而我们只要 8×8。
  现在优先读 `thumb://` 已经缓存的 192px 成品（1–2ms），没有才回落原图。
- **`rescan` 不再卡 async runtime**：`Path::exists` 是同步 stat，几万张在机械盘/网络盘上能卡几秒；
  改成一整批 `spawn_blocking`，并且前端**每会话只跑一次**（图库页会被反复挂载）。
- **`findSections` 不再二次排序**：默认排序就是 `capturedAt`，`findViewRows` 已经排过，
  分组时跳过重排（5 万行省十几毫秒 × 每次筛选）。
- **年份筛选**：从「每行 `new Date().getFullYear()`」改成一次性把年份换算成毫秒区间
  （5 万行筛选一次不再造 5 万个 Date）。
- **`GalleryCell` 加 `memo`**：改星级只会替换命中的行对象，其余单元不必重渲染。

### 仍然知道的取舍

- **dedupe 的 SHA-256 / phash 的逐文件解码仍是串行**：都是磁盘/CPU 密集，改为并发要引入
  有界线程池（`futures` 或手写 worker）；当前用「分块 + 单事务 + 缩略图缓存」先解决主要开销。
- **`toReadCatalog` 仍是全量**：10 万行以上需要考虑分页/增量同步，那是另一轮设计（`seq` 游标）。

## D26 功能完整性与交互补全

复审口径：**用户能不能只靠界面走完全流程**。之前有一批能力“有命令、没入口”，或入口做了但看不见反馈。

### 补上的功能

- **多选批量操作条**（`ui/shell/selection-bar.tsx`）：星级、颜色、拒绝、加入相簿、*移出当前相簿*、
  重命名、移入回收站、全选、完成。之前选择模式下只有键盘能操作 —— 鼠标用户选中 200 张后无从下手。
- **移出相簿**：`gallery:album-detach` 早就有，但界面只提供“加入”。检查器与批量条在相簿视图下才显示。
- **智能相簿可删除**：`gallery:smart-albums-remove` 同样一直没入口；侧栏 hover 出现删除。
- **隐藏 / 取消隐藏**：检查器加开关，筛选条加「含隐藏」「仅失效」两个 chip ——
  否则「已隐藏」视图只能进不能出（隐藏后永远找不回来）。
- **关键词增删**：检查器直接编辑（回车添加、点 chip 移除），写 `curate` 的 `keywords` 全量替换语义。
  顺带修掉了“chips 读 `details` 导致更新后不刷新”的问题：现在读 catalog 行上的 `keywords`。
- **导入 / 去重进度**：监听 `gallery://import-progress` / `gallery://dedupe-progress`，状态栏顶部一条细进度 +
  `done/total`。之前只有一个永远转圈的“导入中…”。
- **操作结果改用 toast**：导入/去重/重扫/相似/相簿操作成功与失败都走 `sonner`，
  状态栏只留统计与错误 —— 状态栏文案会被下一次操作覆盖，一闪就没。
- **空状态可操作**：整库为空 → “导入文件夹”；只是被筛空 → “清除筛选”（文案与动作对应，不再是同一句话）。
- **首屏骨架**：`catalog` 未加载完时显示渐变格子，而不是“还没有照片”这种错误暗示。
  刷新（导入后重读）**不**再走骨架，避免整个网格闪一下。
- **确认/命名改用设计系统 Dialog**：替代 `window.confirm` / `window.prompt`（后者在 Tauri 里会阻塞 WebView 且脱离主题）。

### 交互细节

- `Ctrl/⌘ + K` 聚焦搜索框（侧栏提示改为按平台显示 `⌘K` / `Ctrl+K`）；`Esc` 先退出选择模式再清选择；
  `Delete` 移入回收站（走确认框）；灯箱 / 批量重命名打开时图库快捷键全部让位。
- 网格：鼠标悬停出现淡描边；选择模式下每格左上角有勾选圈（悬停显示、选中打勾）。
- 工具条「选择」按钮在选择模式下显示已选数量。
- 保存智能相簿后自动切到该相簿（用户刚表达的就是“以后回到这个视图”）。
- 导入失败时 toast 的 description 给出前几条去重后的原因（之前的 `failed[]` 只显示数量，等于不可诊断）。

### 仍然没做（有意）

- **相簿重命名 / 排序**：`album:update` 的 `Change` 是**全量覆盖**语义，前端目前只持有 `id`/`name`；
  直接提交会把 `coverAssetID` / `status` 清空。要做必须先把相簿行读全再 patch，属于另一条链路的工作，
  不值得在“图库 UI 补全”里顺手带上。
- **窗口级拖拽导入**：需要接 Tauri 的 `onDragDropEvent` 并处理文件 vs 目录、权限与进度，
  与 `media:pick` 是两条授权路径，单独评估。

## 至此仍开放的事项

| 事项 | 状态 |
| --- | --- |
| CLIP 语义检索 | 阻塞：需 `ort` + 模型下载（D14 备选 A/B） |
| 实时目录监听 | 阻塞：需 `notify`（D16），现由 D18 的启动自检代替 |
| 系统回收站 | 阻塞：需平台 FFI（D8 备注） |
| HEIC / RAW 的 EXIF 拍摄时间 | 待做：现在只解 JPEG 的 TIFF IFD，HEIC 走 mtime 兜底（`dateSource` 会标 `mtime`）；要精确得解 ISO-BMFF 的 `meta` box |
| capture 并入新网格 | 见 D23，等 `galleryAsset` 需要 `keep`/`captureKind` 时再做 |
| 去重/指纹并发化 | 见 D25「仍然知道的取舍」；10 万级库里串行会成为瓶颈 |
| catalog 分页 | 见 D25；现在一次性全量 IPC |
| 相簿重命名 / 排序 | 见 D26「仍然没做」：`album:update` 是全量覆盖，需先读全行 |
| 拖拽导入 | 见 D26「仍然没做」：与 `media:pick` 是两条授权路径 |
