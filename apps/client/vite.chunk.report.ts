// 构建期体检：把每个 chunk 的字节按「谁贡献的」摊开，写到 dist/chunk-report.txt。
//
// 为什么需要它：`unknown-deps` 这类兜底组只报总量（8.95 MB），不报构成 ——
// 想拆就得先看见「这 8.95 MB 里到底是谁」，否则只能靠猜正则去试。
// 只在设置了 COGITO_CHUNK_REPORT 时才跑，平时构建不多做一次全量遍历。
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

interface RenderedModule {
  renderedLength?: number
  code?: string
}

interface ChunkLike {
  type: 'chunk'
  fileName: string
  code: string
  modules?: Record<string, RenderedModule>
}

/** 从模块 id 里取包名；`.pnpm` 铺平的那一层要跳过，本地源码单独归一类 */
const PACKAGE_OF = /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?((?:@[^\\/]+[\\/])?[^\\/]+)/

function packageOf(id: string): string {
  const match = id.match(PACKAGE_OF)
  if (match) return match[1].replace(/[\\/]/g, '/')
  const local = id.match(/[\\/](?:apps|packages)[\\/]([^\\/]+)[\\/]/)
  if (local) return `~local/${local[1]}`
  const src = id.match(/[\\/]src[\\/]((?:[^\\/]+[\\/])?[^\\/]+)/)
  return src ? `~src/${src[1].replace(/[\\/]/g, '/')}` : '~other'
}

/** 模块 id 缩短：去掉 node_modules（含 .pnpm 铺平层）与 monaco 的 esm/vs 前缀，只留包内路径 */
function shortId(id: string): string {
  return id
    .replace(/\\/g, '/')
    .replace(/^.*?node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?/, '')
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

/** 报告的最小 chunk 门槛：太碎的组没必要列 */
const MIN_CHUNK_BYTES = 150 * 1024
const TOP_PER_CHUNK = 14
const TOP_OVERALL = 45
const TOP_MODULES = 30

export function chunkReport(): Plugin {
  let outDir = ''
  return {
    name: 'cogito-chunk-report',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    generateBundle(_options, bundle) {
      if (!process.env.COGITO_CHUNK_REPORT) return

      // rolldown 的 OutputChunk 类型比这里要的字段多，取到想要的形状就够
      const chunks: ChunkLike[] = []
      for (const item of Object.values(bundle)) {
        if (item.type === 'chunk') chunks.push(item as unknown as ChunkLike)
      }
      const totals = new Map<string, number>()
      const lines: string[] = []
      let grand = 0

      chunks.sort((a, b) => b.code.length - a.code.length)

      for (const chunk of chunks) {
        const bytes = Buffer.byteLength(chunk.code)
        grand += bytes
        const perPackage = new Map<string, number>()
        for (const [id, module] of Object.entries(chunk.modules ?? {})) {
          const name = packageOf(id)
          const size = sizeOf(module)
          perPackage.set(name, (perPackage.get(name) ?? 0) + size)
          totals.set(name, (totals.get(name) ?? 0) + size)
        }
        if (bytes < MIN_CHUNK_BYTES) continue

        lines.push(`${chunk.fileName}  ${mb(bytes)}  ${Object.keys(chunk.modules ?? {}).length} modules`)
        const rows = [...perPackage].sort((a, b) => b[1] - a[1]).slice(0, TOP_PER_CHUNK)
        for (const [name, size] of rows) {
          lines.push(`  ${mb(size).padStart(9)}  ${pct(size, bytes)}  ${name}`)
        }
        if (perPackage.size > TOP_PER_CHUNK) {
          lines.push(`  ... 另有 ${perPackage.size - TOP_PER_CHUNK} 个包`)
        }
        // 包级汇总只能告诉你「谁占地方」，拆不动的时候还得看具体是哪个模块：
        // COGITO_CHUNK_DETAIL=1 时再列一层模块明细（默认关，免得报告被刷屏）
        if (process.env.COGITO_CHUNK_DETAIL) {
          const modules = Object.entries(chunk.modules ?? {})
            .map(([id, module]) => [shortId(id), sizeOf(module)] as [string, number])
            .sort((a, b) => b[1] - a[1])
            .slice(0, TOP_MODULES)
          lines.push('  · 模块明细：')
          for (const [id, size] of modules) {
            lines.push(`    ${mb(size).padStart(9)}  ${id}`)
          }
        }
        lines.push('')
      }

      lines.push('========== 全部 chunk 按包汇总 ==========')
      const overall = [...totals].sort((a, b) => b[1] - a[1]).slice(0, TOP_OVERALL)
      for (const [name, size] of overall) {
        lines.push(`${mb(size).padStart(9)}  ${pct(size, grand)}  ${name}`)
      }
      lines.push(`\nchunks=${chunks.length}  js=${mb(grand)}`)

      const target = resolve(outDir, 'chunk-report.txt')
      writeFileSync(target, `${lines.join('\n')}\n`, 'utf8')
      console.log(`[chunk-report] 写入 ${target}`)
    }
  }
}
