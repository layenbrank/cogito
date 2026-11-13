# 桌面端产物体积策略

> 适用：`apps/client`（Tauri 桌面壳）。目标不是「越小越好」，而是**让该懒加载的东西别上首屏**，
> 并且让这条规则在每次构建里自动被检查。

## 一、先搞清楚代价是什么

Tauri 把 `dist` 编进可执行文件，前端资源走本地协议读取 —— **没有网络开销**，也就没有
「首屏要下载多少 KB」这个问题。剩下的代价只有三样：

| 代价 | 什么时候付 | 怎么省 |
| --- | --- | --- |
| 解析 / 编译 JS | 每次这段代码被加载时 | 不进首屏、按需加载 |
| 执行（模块求值） | 同上 | 同上 + 不在模块顶层做重活 |
| 安装包体积 | 只在安装/更新时 | 关掉无用的 gzip、别把同一份代码打两遍 |

经验值（WebView2 / Chromium，minify 之后的 JS）：大约 **1 MB ≈ 15~40 ms** 的解析+编译。
所以：

- **首屏（入口 + 静态 import 闭包）**：目标 **≤ 2.2 MB**，超过这个数量级，冷启动会明显变慢
- **单个懒加载 chunk**：**≤ 4 MB**。它只在进入那一页时付一次，容忍度高；monaco 是唯一的例外
- **总量**：**20~25 MB 属于正常水位**。它不影响启动（不加载就不解析），只影响安装包，
  所以只用来发现「不知不觉多了一个大依赖」

换句话说：**没有「最佳 MB 数」，只有「首屏解析字节」这条硬指标。** 一个 25 MB 的桌面应用
如果首屏只有 1.5 MB，启动会比一个 8 MB、首屏 6 MB 的应用快得多。

## 二、这套方案由什么组成

| 文件 | 作用 |
| --- | --- |
| `apps/client/vite.chunk.budget.ts` | **预算的单一事实源**：首屏上限/目标、单块上限、总量、`forbiddenInCriticalPath`、`allow` 清单 |
| `apps/client/vite.chunk.report.ts` | 构建期体检：算首屏静态闭包、裁掉多余的 modulepreload、写 `dist/bundle-report.{txt,json}`、按预算断言 |
| `apps/client/scripts/size.ts` | `pnpm size`：带 `COGITO_BUNDLE_STRICT=1` 的构建 + 摘要 |

### 三个指标，按代价排序

1. **首屏关键路径** = 入口 chunk + 它在产物代码里**真的静态 import** 的闭包。
   实现上直接扫产物里的 `from"./x.js"`，**不用** rolldown 的 `chunk.imports` —— 后者把动态
   import 的预加载依赖也算进去，会把 lazy 路由全部算成首屏，指标就废了。
2. **单块上限**：每个 chunk 与预算比，已知重块走 `allow`（要求写 `reason`）。
3. **总量**：防呆。
4. **首屏预加载**：`index.html` 里那些 `<link rel="modulepreload">` 的字节数。本地协议
   没有网络开销，但 modulepreload 会真的把文件读进来并编译 —— 它的代价和首屏是同一份。
   报告按首屏闭包裁掉多余的 link（在 `writeBundle` 阶段做，因为 `generateBundle` 时 html
   里还没有这些 link），裁不掉的那部分就等于「它本来就在首屏」，即下面那条债。

另外还有一条**架构债清单** `forbiddenInCriticalPath`：monaco / mermaid / shiki / konva 这些
库只要出现在首屏就记一条 debt。debt **不让构建失败**（它是存量问题，靠改代码还，不靠调数字），
但每次构建都会打印，报告里也能看到条数变化 —— 债务有没有在还，一目了然。

### 日常怎么用

```powershell
pnpm --filter @cogito/client build-only   # 构建 + 体检（超预算只警告）
pnpm --filter @cogito/client size         # 构建 + 体检 + 严格断言（提交前 / CI）
```

- 详细构成：`apps/client/dist/bundle-report.txt`（人看）/ `bundle-report.json`（机器看）
- 想看某个 chunk 里到底是哪些模块：`$env:COGITO_CHUNK_DETAIL=1` 再构建一次

### 两个「因为桌面端」的构建决定

- **不生成 gzip**：`.gz` 对本地协议没有意义，只是让 `dist` 多一份同量级的副本、
  拖慢打包、撑大安装包。只有真要部署成网站时用 `COGITO_WEB_BUILD=1`。
- **压缩用 oxc 而不是 terser**：产物体积基本相同，构建时间从 ~66 s 降到 ~12 s。
  需要复现历史体积时 `COGITO_MINIFY=terser`。

## 三、当前已知债务：首屏 14.4 MB

报告现在会告诉你：首屏关键路径 ≈ **14.4 MB**（目标 2.2 MB），命中的包包括 `monaco-editor`、
`shaders`、`shiki`、`highlight.js`…

同一份报告里还能看到 **首屏预加载 ≈ 14.4 MB**：`index.html` 的 25 个 modulepreload link
全部落在首屏闭包里，一个也裁不掉 —— 这正是上面这条债在启动时的真实账单。

**根因不是「有人写了错误的 import」，而是分包粒度和目录结构打架：**

- 分包按目录走（`views/<x>/` → `tile-<x>` chunk），所以一个 chunk = 一个页面的**全部**东西
- 但不少**共享工具函数住在 `views/` 里**，被 `stores/`、`features/` 引用：
  - `stores/code.ts` → `@/views/code/lib/{language,path}.ts`（于是 monaco 整块上首屏）
  - `features/*` → `@/views/settings/constant`、`@/views/knowledge/locale.ts`、`@/views/knowledge/lib/image-src.ts`
  - `util/*` → `@/views/gallery/model/media`（type-only，影响较小）
- 结果：**import 一个 20 行的 helper = 加载整个页面 chunk**

### 还债方向（按性价比排序）

1. 把被跨目录引用的东西搬到 `src/lib/`（视图只做 re-export）：
   `views/code/lib/{language,path}`、`views/settings/constant`、`views/knowledge/locale`、
   `views/knowledge/lib/image-src`。这一条能直接把 monaco 从首屏摘掉。
2. 视图内部再分层：`views/<x>/lib/**`（纯函数，可被任何地方引用）与 `views/<x>/**`（组件，
   只能被路由引用）分开成两个 chunk。
3. 护栏：新的 `views/<x>/` 文件不要被 `stores/`、`features/`、`lib/` 引用；需要共享就下沉。

## 四、加一个新依赖时怎么做

1. 默认 **动态 import**（`await import()`），除非它真的在首屏就要用。
2. 跑一次 `pnpm size`，看 `bundle-report.txt`：
   - 进了首屏 → 会被 `forbiddenInCriticalPath` 记成 debt，先想能不能挪走
   - 单块超 4 MB → 拆，或者写进 `allow` 并说明理由
3. 预算数字可以改，但**改的时候在 PR 里写清为什么**；`allow` 里的 `reason` 不是装饰。
