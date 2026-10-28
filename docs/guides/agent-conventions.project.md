# Agent 提示备忘 · 本项目特有

通用约定见 [agent-conventions.md](./agent-conventions.md)；这里放本仓库独有的约束（换项目不通用）。

## 应用形态：Tauri 窗口（仅 apps/client）

- 一律 `decorations: false`，自绘：`Caption` = 拖拽区 + 窗口键；`Decorations` = 窗口容器（标题栏 + flex 列）。不用裸 `Caption` + 自建布局。
- 拖拽：槽位容器 `data-region="true"`（CSS `-webkit-app-region: drag`）；槽位内交互元素必须 `data-region="false"`，否则被吃掉点击。不要写 `data-tauri-drag-region`。
- **无内置浏览器**：不要再加浏览窗 / 子 WebView / `navigation-popup`。网址与搜索一律 `openUrl` 进系统浏览器；搜索只挂 overview 操作栏。
- 每窗口都要自绘标题栏，`/overlay` 例外；`Decorations` 根节点透明，材质由窗口承担。
- 磁贴不用 Dialog：双击开独立窗口（`activateTile` → `views/<component>`），label `component:id`；`navigation` 磁贴改为外跳系统浏览器。
- 磁贴两层：`views/<tile>/` = 窗口页；`features/magnetic-tiles/<tile>/` = 磁贴表面；别把窗口逻辑塞回 features。
- 窗口 UI 归 `views/`：agent 部件 `views/agent/chat/components/**`；`features/agent/` 只留 `acp/`、`model/`、`port/`、领域类型。
- 分屏用布局路由 + 子页，不用 Dialog / 页内开关：出口 `views/agent/agent.tsx`，子页 `views/agent/{chat,settings}/`，URL 只有 `/agent/chat` 与 `/agent/settings`。

## 已废弃

- `--ith-*`（antd cssVar）已迁到设计 token；不再写 `var(--ith-…)` / `var(--ant-*)`。

## 版本发布

- client 升级用 `bump:client`；仓库升级按既有发版流程，均触发 tag release。

## 本地工具（corex）

需要桌面 UI 证据（对照 Qoder / 验收 Studio 窗口）时用 corex，不要臆测界面。

### 推荐流程

1. 查能力：`corex actions --bucket ui`（另有 `data` / `system`）。
2. 找窗口：`corex ui window list`，按标题过滤（`Qoder` / `cogito`）。
3. 写 YAML 到 `.cache/corex/directives/` → `corex validate <path>` → `corex run <path>`。
4. 读产物：截图 `.cache/corex/captures/{qoder,studio}/`，OCR / 探测 `.cache/corex/probes/`（已 gitignore）。别把指令 / 截图留 `apps/studio/scripts/`，别提交 `.cache/`。

典型链：`ui.window.focus`（`title_contains` + `prefer_largest`）→ `ui.wait` → `capture.screenshot`（需要时 +`ui.click` / `capture.crop` / `capture.ocr`）。

### 踩坑

- Electron / Chromium 的 UIA 几乎只有标题栏，React 内容树进不了 `ui element tree` —— 以截图验收，别死磕控件树。
- PowerShell 不用 heredoc；YAML 写文件，路径正斜杠（`d:/.../out.png`）。
- 先 `corex actions capture.screenshot` / focus / click / crop / ocr 确认参数，再写 YAML。

## 构建缓存与环境

- **编译缓存不进仓库**：`rustc-wrapper` / `RUSTC_*` / `SCCACHE_*` 一律不写进 `.cargo/config.toml`——这些值因机器而异（端口可能被保留、路径可能不同），写进仓库就会让「换台设备就起不来」。
- 缓存由个人 `~/.cargo/config.toml` 或环境变量决定；想用 sccache 自己装、自己配。
- 守卫：`pnpm check:cargo-config`（`dev:client` 会先跑），发现机器特定键即失败并给出替代写法。
- 排查顺序：`sccache --show-stats`（服务在不在）→ 端口能否 `TcpListener` 绑定 → 最后才查环境变量。
