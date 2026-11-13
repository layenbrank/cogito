/**
 * 构建体检：把产物体积摊到「谁贡献的」、算出首屏关键路径、按预算做断言。
 *
 * 与常见的 bundle 分析工具不同，这里不关心 gzip：Tauri 把 `dist` 编进可执行文件，
 * 资源走本地协议，压缩率对启动没有任何意义。真正有代价的是**被解析的字节数**，
 * 而「会不会被解析」= 它在不在首屏的静态 import 闭包里。
 *
 * 产出三样东西：
 * - `dist/bundle-report.txt`：人看的表（首屏路径 / 各 chunk 构成 / 预算结论）
 * - `dist/bundle-report.json`：机器看的（体积趋势、CI 断言、后续做体积 diff）
 * - 控制台一行结论 + 超预算明细；`COGITO_BUNDLE_STRICT=1` 时直接让构建失败
 *
 * 分工：`generateBundle` 只攒材料（体积、首屏闭包、预算判定），`writeBundle` 才定稿 ——
 * 因为 modulepreload 的裁剪必须等产物落盘：generateBundle 阶段 index.html 里还没有那些 link。
 *
 * 预算定义在 `vite.chunk.budget.ts`，那里解释了为什么指标长这样。
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

import { budget as defaultBudget, type BundleBudget } from './vite.chunk.budget.ts'

interface RenderedModule {
  renderedLength?: number
  code?: string
}

interface ChunkLike {
  type: 'chunk'
  fileName: string
  code: string
  isEntry: boolean
  imports: string[]
  dynamicImports: string[]
  modules?: Record<string, RenderedModule>
}

/** 一份报告的完整材料：`generateBundle` 攒，`writeBundle` 定稿 */
interface ReportState {
  lines: string[]
  chunks: ChunkLike[]
  bytesOf: Map<string, number>
  critical: string[]
  onCriticalPath: Set<string>
  criticalBytes: number
  total: number
  violations: string[]
  debt: string[]
  preload: { kept: number; dropped: number; droppedLinks: string[] }
}

/** 从模块 id 里取包名；`.pnpm` 铺平的那一层要跳过，本地源码单独归一类 */
const PACKAGE_OF =
  /[\\/]node_modules[\\/](?:\\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?((?:@[^\\/]+[\\/])?[^\\/]+)/

function packageOf(id: string): string {
  const match = id.match(PACKAGE_OF)
  if (match) return match[1].replace(/[\\/]/g, '/')
  const local = id.match(/[\\/](?:apps|packages)[\\/]([^\\/]+)[\\/]/)
  if (local) return `~local/${local[1]}`
  const src = id.match(/[\\/]src[\\/]((?:[^\\/]+[\\/])?[^\\/]+)/)
  return src ? `~src/${src[1].replace(/[\\/]/g, '/')}` : '~other'
}

/** 模块 id 缩短：去掉 node_modules（含 .pnpm 铺平层）与 monaco 的 esm/vs 前缀 */
function shortId(id: string): string {
  return id
    .replace(/\\/g, '/')
    .replace(/^.*?node_modules\/(?:\\.pnpm\/[^/]+\/node_modules\/)?/, '')
    .replace(/^monaco-editor\/esm\/vs\//, 'monaco/')
}

function sizeOf(module: RenderedModule): number {
  if (typeof module.renderedLength === 'number') return module.renderedLength
  return typeof module.code === 'string' ? module.code.length : 0
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function pct(part: number, whole: number): string {
  if (whole === 0) return '  -  '
  return `${((part / whole) * 100).toFixed(1).padStart(4)}%`
}

/** `javascript/tile-code-_PonGPDi.js` → `tile-code`（hash 8 位，可能含 - 和 _） */
function chunkName(fileName: string): string {
  const base = fileName.replace(/^.*\//, '').replace(/\.[cm]?js$/, '')
  return base.replace(/-[A-Za-z0-9_-]{8}$/, '')
}

/**
 * 产物代码里的静态 import / re-export 说明符（`import ... from "./x.js"`）。
 * 排除 `import("./x.js")`：那是动态导入，Vite 的 `__vitePreload` 也会把依赖名以字符串
 * 数组的形式写进代码，正则必须把两者分开，否则又会把 lazy 路由算成首屏。
 */
function staticImportsOf(code: string): string[] {
  const found = new Set<string>()
  // `import{a}from"./x.js"` / `export{a}from"./x.js"`（压缩后没有空格，花括号也夹在中间）
  for (const match of code.matchAll(/\bfrom\s*"(\.\/[^"]+\.js)"/g)) found.add(match[1])
  // 副作用导入 `import"./x.js"`（注意不能匹配 `import("./x.js")`，那是动态导入）
  for (const match of code.matchAll(/(?:^|[;}\s])import\s*"(\.\/[^"]+\.js)"/g)) found.add(match[1])
  return [...found]
}

/** `javascript/a.js` + `./b.js` → `javascript/b.js` */
function resolveSibling(fileName: string, specifier: string): string {
  const dir = fileName.includes('/') ? fileName.slice(0, fileName.lastIndexOf('/')) : ''
  return `${dir}/${specifier.replace(/^\.\//, '')}`
}

/** 报告里列明细的最小 chunk 门槛：太碎的组没必要列 */
const MIN_CHUNK_BYTES = 150 * 1024
const TOP_PER_CHUNK = 10
const TOP_MODULES = process.env.COGITO_CHUNK_DETAIL ? 30 : 0

/** 产物里的 modulepreload link：`<link rel="modulepreload" crossorigin href="/javascript/x.js">` */
const PRELOAD_LINK =
  /[ \t]*<link\s+rel="modulepreload"[^>]*href="\/(javascript\/[^"]+\.js)"[^>]*>\r?\n?/g

/**
 * 按首屏的真实静态闭包裁剪 modulepreload。
 *
 * Vite 给入口写 preload 时把 lazy 路由的 chunk 也算成了「预加载依赖」。这些 link 一旦存在，
 * WebView 启动就会读+解析它们 —— 本地协议没有网络开销，但解析是实打实的，等于把懒加载
 * 还原成全量加载。只能等产物落盘后再改 html：`generateBundle` 阶段 html 里还没有这些 link。
 */
function trimPreloadLinks(outDir: string, critical: Set<string>, state: ReportState): void {
  for (const file of readdirSync(outDir)) {
    if (!file.endsWith('.html')) continue
    const path = resolve(outDir, file)
    const source = readFileSync(path, 'utf8')
    let dropped = false
    const next = source.replace(PRELOAD_LINK, function (link: string, name: string) {
      const bytes = state.bytesOf.get(name) ?? 0
      if (critical.has(name)) {
        state.preload.kept += bytes
        return link
      }
      state.preload.dropped += bytes
      state.preload.droppedLinks.push(name)
      dropped = true
      return ''
    })
    if (dropped) writeFileSync(path, next, 'utf8')
  }
}

/** 汇总段：裁完 preload 之后才能算准，所以放在定稿时追加 */
function summaryLines(state: ReportState, budget: BundleBudget): string[] {
  const lines: string[] = []
  const { preload, total, criticalBytes, violations, debt } = state
  lines.push('========== 汇总 ==========')
  lines.push(`chunks=${state.chunks.length}  js=${mb(total)}（预算 ${mb(budget.total)}）`)
  lines.push(`首屏=${mb(criticalBytes)}（预算 ${mb(budget.criticalPath)}）`)
  lines.push(
    `首屏预加载=${mb(preload.kept)}${preload.droppedLinks.length
      ? `，另裁掉 ${preload.droppedLinks.length} 个非静态闭包的 link（${mb(preload.dropped)}）`
      : ''}`
  )
  if (violations.length === 0) {
    lines.push('预算：全部通过 ✅')
  } else {
    lines.push('预算：未通过 ❌')
    for (const violation of violations) lines.push(`  - ${violation}`)
  }
  if (debt.length > 0) {
    lines.push(`首屏债务：${debt.length} 项（不拦构建，见 docs/apps/client/bundle.md）`)
    for (const item of debt) lines.push(`  - ${item}`)
  }
  return lines
}

/** `bundle-report.json`：给体积趋势 / CI 断言 / 后续 diff 用 */
function reportJson(state: ReportState, budget: BundleBudget): unknown {
  const { chunks, bytesOf, critical, criticalBytes, total, violations, debt, preload } = state
  return {
    generatedAt: new Date().toISOString(),
    totals: { chunks: chunks.length, js: total },
    criticalPath: { bytes: criticalBytes, chunks: critical },
    preload: {
      kept: preload.kept,
      droppedBytes: preload.dropped,
      droppedChunks: preload.droppedLinks.length
    },
    budget: {
      criticalPath: budget.criticalPath,
      chunk: budget.chunk,
      total: budget.total,
      passed: violations.length === 0,
      violations,
      debt
    },
    chunks: chunks.map(function (chunk) {
      const bytes = bytesOf.get(chunk.fileName) ?? 0
      const perPackage = new Map<string, number>()
      for (const [id, module] of Object.entries(chunk.modules ?? {})) {
        const pkg = packageOf(id)
        perPackage.set(pkg, (perPackage.get(pkg) ?? 0) + sizeOf(module))
      }
      return {
        name: chunkName(chunk.fileName),
        fileName: chunk.fileName,
        bytes,
        entry: chunk.isEntry,
        onCriticalPath: state.onCriticalPath.has(chunk.fileName),
        dynamicImports: chunk.dynamicImports.length,
        packages: [...perPackage].sort((a, b) => b[1] - a[1]).slice(0, 5)
      }
    })
  }
}

export function chunkReport(budget: BundleBudget = defaultBudget): Plugin {
  let outDir = ''
  let pending: ReportState | null = null
  return {
    name: 'cogito-chunk-report',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    generateBundle(_options, bundle) {
      // rolldown 的 OutputChunk 类型比这里要的字段多，取到想要的形状就够
      const chunks: ChunkLike[] = []
      for (const item of Object.values(bundle)) {
        if (item.type === 'chunk') chunks.push(item as unknown as ChunkLike)
      }
      chunks.sort((a, b) => Buffer.byteLength(b.code) - Buffer.byteLength(a.code))

      const bytesOf = new Map<string, number>()
      for (const chunk of chunks) bytesOf.set(chunk.fileName, Buffer.byteLength(chunk.code))
      const total = chunks.reduce((sum, chunk) => sum + (bytesOf.get(chunk.fileName) ?? 0), 0)

      // 首屏 = 入口 + 它在**产物代码里真的静态 import** 的闭包。
      //
      // 不用 rolldown 的 `chunk.imports`：它把动态 import 的预加载依赖也算了进去，
      // 按它算会把 lazy 路由（monaco / shiki / mermaid…）全部算成「首屏」，指标就废了。
      // 这里直接读产物代码里 `import ... from "./x.js"` 这类语句 —— 那才是启动时真的会执行的。
      const critical: string[] = []
      const seen = new Set<string>()
      const queue = chunks.filter((chunk) => chunk.isEntry).map((chunk) => chunk.fileName)
      while (queue.length > 0) {
        const name = queue.shift() as string
        if (seen.has(name)) continue
        seen.add(name)
        critical.push(name)
        const chunk = chunks.find((item) => item.fileName === name)
        if (!chunk) continue
        for (const imported of staticImportsOf(chunk.code)) {
          const resolved = resolveSibling(chunk.fileName, imported)
          if (!seen.has(resolved)) queue.push(resolved)
        }
      }
      const criticalBytes = critical.reduce((sum, name) => sum + (bytesOf.get(name) ?? 0), 0)

      // violations = 体积超标（会让 strict 模式失败）
      // debt       = 架构债：首屏里出现了本该懒加载的包。单独记一份，随构建打印但不拦人 ——
      //              这笔账要靠「把共享代码从 views/ 挪出去」来还，不是靠调数字
      const violations: string[] = []
      const debt: string[] = []
      const lines: string[] = []

      lines.push('========== 首屏关键路径（入口 + 静态 import 闭包） ==========')
      for (const name of [...critical].sort((a, b) => (bytesOf.get(b) ?? 0) - (bytesOf.get(a) ?? 0))) {
        lines.push(`${mb(bytesOf.get(name) ?? 0).padStart(9)}  ${name}`)
      }
      lines.push(
        `${mb(criticalBytes).padStart(9)}  合计（当前上限 ${mb(budget.criticalPath)}，目标 ${mb(budget.criticalPathTarget)}）`
      )
      lines.push('')

      if (criticalBytes > budget.criticalPath) {
        violations.push(`首屏关键路径 ${mb(criticalBytes)} 超过预算 ${mb(budget.criticalPath)}`)
      }

      // 首屏里出现「本该懒加载」的包，比体积超标更值得拦
      const criticalPackages = new Map<string, number>()
      for (const name of critical) {
        const chunk = chunks.find((item) => item.fileName === name)
        for (const [id, module] of Object.entries(chunk?.modules ?? {})) {
          const pkg = packageOf(id)
          criticalPackages.set(pkg, (criticalPackages.get(pkg) ?? 0) + sizeOf(module))
        }
      }
      for (const pkg of criticalPackages.keys()) {
        const hit = budget.forbiddenInCriticalPath.find(function (forbidden) {
          return pkg === forbidden || pkg.startsWith(`${forbidden}/`)
        })
        if (hit) debt.push(`首屏关键路径里出现了 ${pkg}（应改为动态 import）`)
      }

      lines.push('========== 各 chunk（按体积，≥150 KB） ==========')
      for (const chunk of chunks) {
        const bytes = bytesOf.get(chunk.fileName) ?? 0
        if (bytes < MIN_CHUNK_BYTES) continue
        const name = chunkName(chunk.fileName)
        const perPackage = new Map<string, number>()
        for (const [id, module] of Object.entries(chunk.modules ?? {})) {
          const pkg = packageOf(id)
          perPackage.set(pkg, (perPackage.get(pkg) ?? 0) + sizeOf(module))
        }

        const allow = budget.allow[name]
        const limit = allow?.limit ?? budget.chunk
        if (bytes > limit) {
          violations.push(
            `${chunk.fileName} ${mb(bytes)} 超过${allow ? ' allow' : '单块'}上限 ${mb(limit)}`
          )
        }

        lines.push(
          `${chunk.fileName}  ${mb(bytes)}  预算 ${mb(limit)}  ${Object.keys(chunk.modules ?? {}).length} modules`
        )
        if (allow) lines.push(`  ↳ ${allow.reason}`)
        for (const [pkg, size] of [...perPackage].sort((a, b) => b[1] - a[1]).slice(0, TOP_PER_CHUNK)) {
          lines.push(`  ${mb(size).padStart(9)}  ${pct(size, bytes)}  ${pkg}`)
        }
        if (TOP_MODULES > 0) {
          lines.push('  · 模块明细：')
          const modules = Object.entries(chunk.modules ?? {})
            .map(([id, module]) => [shortId(id), sizeOf(module)] as [string, number])
            .sort((a, b) => b[1] - a[1])
            .slice(0, TOP_MODULES)
          for (const [id, size] of modules) lines.push(`    ${mb(size).padStart(9)}  ${id}`)
        }
        lines.push('')
      }

      if (total > budget.total) {
        violations.push(`JS 总量 ${mb(total)} 超过预算 ${mb(budget.total)}`)
      }

      // 汇总与落盘留给 writeBundle：那时 modulepreload 已经裁完，数字才是最终的
      pending = {
        lines,
        chunks,
        bytesOf,
        critical,
        onCriticalPath: seen,
        criticalBytes,
        total,
        violations,
        debt,
        preload: { kept: 0, dropped: 0, droppedLinks: [] }
      }
    },
    writeBundle() {
      const state = pending
      if (!state) return
      pending = null

      trimPreloadLinks(outDir, state.onCriticalPath, state)

      const lines = [...state.lines, ...summaryLines(state, budget)]
      writeFileSync(resolve(outDir, 'bundle-report.txt'), `${lines.join('\n')}\n`, 'utf8')
      writeFileSync(resolve(outDir, 'bundle-report.json'), `${JSON.stringify(reportJson(state, budget), null, 2)}\n`, 'utf8')

      const { criticalBytes, total, violations, debt, preload } = state
      console.log(
        `[bundle] 首屏 ${mb(criticalBytes)}（预加载 ${mb(preload.kept)}）/ 总量 ${mb(total)} / 预算 ${violations.length === 0 ? '通过' : '未通过'}`
      )
      for (const item of debt) console.warn(`[bundle] 首屏债务：${item}`)
      for (const violation of violations) {
        if (process.env.COGITO_BUNDLE_STRICT) this.error(`[bundle] ${violation}`)
        console.warn(`[bundle] ${violation}`)
      }
    }
  }
}
