/**
 * 桌面端产物体积预算 —— 构建体检的单一事实源。
 *
 * 为什么不是「越小越好」：Tauri 把 `dist` 编进可执行文件，资源走本地协议，**没有网络开销**。
 * 于是字节数的代价只剩：WebView2 读取 + V8 解析/编译 + 执行。经验值约 1 MB（minify 后）
 * 对应 15~40 ms 解析，且只在**真的要执行它**时才付。
 *
 * 所以这里的指标按代价排序，而不是按字节排序：
 *
 * 1. `criticalPath`：入口 + 它的静态 import 闭包。这是唯一「每次启动都必须付」的部分，
 *    也是唯一值得严格设上限的部分。首屏多 1 MB，冷启动就多几十毫秒。
 * 2. `chunk`：单个动态 chunk 的软上限。它只在用户进入对应页面时才付费，容忍度高得多，
 *    但超过这条线说明「这一页的解析时间已经能感觉到」，需要拆或写进 allow 说明理由。
 * 3. `total`：总量防呆。桌面端总量不影响启动（不加载就不解析），只影响安装包体积，
 *    所以放宽，仅用来发现「不知不觉多了一个大依赖」。
 *
 * `forbiddenInCriticalPath` 是这套预算里最有价值的一条：它拦的不是「大」，而是
 * 「本该懒加载的东西被静态 import 拖上了首屏」。monaco / mermaid / shiki 这些库
 * 单个就有几 MB，一旦有人写下 `import { x } from 'mermaid'` 而不是 `await import()`，
 * 预算会当场失败，而不是等下次有人抱怨启动慢。
 *
 * 调整规则：数字可以改，但**改的时候要在 PR 里写清为什么**；已知的重块放进 `allow`，
 * 附一行理由，比在群里说「先这样吧」有用。
 */

const MB = 1024 * 1024

interface AllowEntry {
  /** 该 chunk 的字节上限（含 hash 前的名字匹配，如 'tile-code'） */
  limit: number
  /** 为什么它值得这个体积 */
  reason: string
}

interface BundleBudget {
  /** 入口 + 静态 import 闭包（每次启动都要解析的部分）的**当前上限** */
  criticalPath: number
  /** 首屏的**目标值**：只用于在报告里显示进度，不参与断言 */
  criticalPathTarget: number
  /** 单个 chunk 的软上限 */
  chunk: number
  /** 全站 JS 总量（只影响安装包，不影响启动） */
  total: number
  /** 首屏里绝不该出现的包：它们必须走动态 import */
  forbiddenInCriticalPath: readonly string[]
  /** 已知且可接受的重块 */
  allow: Readonly<Record<string, AllowEntry>>
}

const budget: BundleBudget = {
  // 当前是**债务上限**，不是理想值：首屏实测 14.4 MB，因为若干共享工具函数还住在
  // views/ 里（`@/views/code/lib/language.ts`、`@/views/settings/constant`…），
  // 目录级分包让「import 一个 helper」变成「加载整个页面 chunk」。
  // 清偿方式见 docs/apps/client/bundle.md（把共享代码挪到 src/lib），清偿后收紧到 target。
  criticalPath: 15 * MB,
  criticalPathTarget: 2.2 * MB,
  chunk: 4.2 * MB,
  // 21 MB 上下是「桌面应用的正常水位」，留一点呼吸空间，只用来发现异常增长
  total: 24 * MB,
  forbiddenInCriticalPath: [
    'monaco-editor',
    'mermaid',
    '@mermaid-js',
    'shiki',
    '@shikijs',
    'highlight.js',
    'lowlight',
    'konva',
    'cytoscape',
    'shaders',
    'three'
  ],
  allow: {
    'tile-code': {
      limit: 4.6 * MB,
      reason: '代码页的 monaco 内核：唯一必须同步可用的编辑器，懒加载路由已隔离在首屏之外'
    },
    ui: {
      limit: 3.4 * MB,
      reason: '设计系统 + mermaid 图表 + cytoscape 布局：按需渲染，跟着第一个用到图表的页面走'
    },
    'tile-gallery': {
      limit: 3.0 * MB,
      reason: '壁纸/着色器预览页，整页就是一个 WebGPU 渲染器'
    },
    'tile-agent': {
      limit: 2.4 * MB,
      reason: '对话页 + xterm + assistant-ui，主界面之一'
    },
    'tile-knowledge': { limit: 1.6 * MB, reason: '知识库页（含 katex）' },
    'core-routers': { limit: 1.5 * MB, reason: '全部路由表：每个 lazy() 都会在这里留一条登记' },
    'vendor-highlight': { limit: 1.2 * MB, reason: 'highlight.js + lowlight：知识库/对话的代码块回退' },
    'vendor-shiki-engine': { limit: 0.8 * MB, reason: 'oniguruma wasm 引擎，首次渲染代码块才加载' },
    'vendor-monaco': { limit: 0.8 * MB, reason: '代码页与右栏 diff 共享的 monaco 片段' }
  }
}

export type { AllowEntry, BundleBudget }
export { budget }
