/**
 * `pnpm size`：带预算断言的构建 + 体积摘要。
 *
 * 与 `pnpm build-only` 的区别只有一个：设置 COGITO_BUNDLE_STRICT=1，让预算不通过时
 * 直接构建失败。日常开发用 build-only（只报告不拦），提交前/CI 用这条。
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CLIENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPORT = path.join(CLIENT_DIR, 'dist/bundle-report.json')

interface ChunkRow {
  name: string
  bytes: number
  onCriticalPath: boolean
}

interface BundleReport {
  totals: { chunks: number; loose: number; looseBytes: number; js: number }
  criticalPath: { bytes: number }
  budget: { passed: boolean; violations: string[] }
  chunks: ChunkRow[]
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

const result = spawnSync('pnpm', ['exec', 'vite', 'build'], {
  cwd: CLIENT_DIR,
  env: { ...process.env, COGITO_BUNDLE_STRICT: '1' },
  stdio: 'inherit',
  shell: process.platform === 'win32'
})

if (result.status !== 0) process.exit(result.status ?? 1)

const report = JSON.parse(readFileSync(REPORT, 'utf8')) as BundleReport
console.log('')
console.log(`首屏关键路径  ${mb(report.criticalPath.bytes)}`)
console.log(
  `JS 总量       ${mb(report.totals.js)}（${report.totals.chunks} 个 chunk + ${report.totals.loose} 个独立 JS，后者 ${mb(report.totals.looseBytes)}）`
)
console.log('最大的可懒加载块：')
for (const chunk of report.chunks
  .filter((item) => !item.onCriticalPath)
  .slice(0, 8)) {
  console.log(`  ${mb(chunk.bytes).padStart(9)}  ${chunk.name}`)
}
console.log(report.budget.passed ? '预算：通过' : '预算：未通过')
for (const violation of report.budget.violations) console.log(`  - ${violation}`)
