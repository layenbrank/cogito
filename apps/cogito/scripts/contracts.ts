/**
 * 契约代码生成：以 apps/cogito/spec/openapi.json（唯一真源）派生各语言客户端/类型。
 *
 * 用法:
 *   bun run contracts              生成全部产物
 *   bun run contracts:ts           只生成 TypeScript 类型（提交进仓库的那份）
 *   bun run contracts:check        漂移检查，不写仓库文件（CI 用）
 *   bun run contracts ts|python|rust|all [--check]
 *
 * 产物归属（详见 guide/contract-codegen.md）:
 *   TypeScript   packages/types/src/openapi.d.ts       提交；有消费者，且由漂移门禁守护
 *   Python/Rust  apps/cogito/.generated/**               不提交；暂无消费者，按需生成
 *
 * 三个生成器同时充当 spec 的「第三方独立校验器」：
 *   任一对我们的 spec 报错，都说明契约本身有问题——不是生成器的口味问题。
 *   例：OpenAPI 3.1 要求 info.license.identifier，缺失会被 openapi-generator 直接拒绝。
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import process from 'node:process'

import { ROOT as COGITO } from '@/utils/env.ts'

const REPO = join(COGITO, '..', '..')
const SPEC = join(COGITO, 'spec', 'openapi.json')
const GEN = join(COGITO, '.generated')

/** 已提交的 TypeScript 契约；漂移门禁比对的就是它与 spec 的一致性 */
const TS_COMMITTED = join(REPO, 'packages', 'types', 'src', 'openapi.d.ts')

/** 生成器一律走本地 node_modules（版本由 bun.lock 锁定），不在运行期联网解析 */
const TS_CLI = join(COGITO, 'node_modules', 'openapi-typescript', 'bin', 'cli.js')
const RUST_CLI = join(COGITO, 'node_modules', '@openapitools', 'openapi-generator-cli', 'main.js')

/** uvx 侧的版本锁（openapitools.json 锁 openapi-generator 的 jar 版本） */
const PY_CLIENT = 'openapi-python-client==0.25.3'

const TARGETS = ['ts', 'python', 'rust'] as const
type Target = (typeof TARGETS)[number]

function usage(): never {
  console.error('用法: bun run scripts/contracts.ts ts|python|rust|all [--check]')
  process.exit(2)
}

function run(label: string, cmd: string, args: readonly string[], cwd: string): void {
  const r = spawnSync(cmd, [...args], {
    cwd,
    stdio: 'inherit',
    env: process.env,
    windowsHide: true
  })
  if (r.error) {
    console.error(`${label} 启动失败: ${r.error.message}`)
    process.exit(1)
  }
  if (r.status !== 0) {
    console.error(`${label} 失败（退出码 ${r.status}）`)
    process.exit(1)
  }
}

function ensureTool(cmd: string, hint: string): void {
  const r = spawnSync(cmd, ['--version'], { encoding: 'utf8', env: process.env, windowsHide: true })
  if (r.error || r.status !== 0) {
    console.error(`未找到 ${cmd}。${hint}`)
    process.exit(1)
  }
}

/** 生成物逐字节可比：忽略 git 检出时的行尾转换（本仓 Windows 侧为 CRLF） */
function normalize(text: string): string {
  return text.replace(/\r\n/g, '\n')
}

async function generateTs(outFile: string): Promise<void> {
  await mkdir(dirname(outFile), { recursive: true })
  run('openapi-typescript', process.execPath, [TS_CLI, SPEC, '-o', outFile], COGITO)
}

async function generatePython(): Promise<void> {
  ensureTool('uvx', '请安装 uv（https://docs.astral.sh/uv/）')
  const out = join(GEN, 'python')
  await rm(out, { recursive: true, force: true })
  // openapi-python-client 只 mkdir 输出目录本身（parents=False），父目录需先存在
  await mkdir(GEN, { recursive: true })
  run(
    'openapi-python-client',
    'uvx',
    [
      '--from',
      PY_CLIENT,
      'openapi-python-client',
      'generate',
      '--path',
      SPEC,
      '--meta',
      'none',
      '--output-path',
      out
    ],
    COGITO
  )
}

async function generateRust(): Promise<void> {
  ensureTool('java', 'openapi-generator 需要 JRE 11+')
  const out = join(GEN, 'rust')
  await rm(out, { recursive: true, force: true })
  await mkdir(GEN, { recursive: true })
  // cwd 必须是 apps/cogito：openapi-generator-cli 就近读取 openapitools.json 里的 jar 版本
  run(
    'openapi-generator (rust)',
    process.execPath,
    [
      RUST_CLI,
      'generate',
      '-i',
      'spec/openapi.json',
      '-g',
      'rust',
      '-o',
      '.generated/rust',
      '--additional-properties',
      'packageName=cogito_client',
      '--global-property',
      'apiTests=false,modelTests=false,apiDocs=false,modelDocs=false'
    ],
    COGITO
  )

  const manifest = join(out, 'Cargo.toml')
  const text = await readFile(manifest, 'utf8')
  if (!text.includes('[workspace]')) {
    // 生成的 crate 落在 apps/cogito 子树里，会被 cargo 误判为父 workspace 成员
    await writeFile(manifest, `${normalize(text).trimEnd()}\n\n[workspace]\n`, 'utf8')
  }
}

/** 漂移检查：重新生成到 .generated/ 并与已提交文件比对，绝不写仓库文件 */
async function checkTs(): Promise<boolean> {
  const probe = join(GEN, 'typescript', 'schema.d.ts')
  await generateTs(probe)

  const fresh = normalize(await readFile(probe, 'utf8'))
  if (!existsSync(TS_COMMITTED)) {
    console.error(`缺少已提交的 TypeScript 契约: ${TS_COMMITTED}`)
    console.error('  修复: bun run contracts:ts')
    return false
  }
  const committed = normalize(await readFile(TS_COMMITTED, 'utf8'))
  if (fresh === committed) return true

  console.error('TypeScript 契约已漂移：spec/openapi.json 与已提交类型不一致')
  const a = fresh.split('\n')
  const b = committed.split('\n')
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      console.error(`  首个差异在第 ${i + 1} 行`)
      console.error(`    生成: ${a[i] ?? '<无>'}`)
      console.error(`    已提交: ${b[i] ?? '<无>'}`)
      break
    }
  }
  console.error(`  修复: bun run contracts:ts 后提交 ${TS_COMMITTED}`)
  return false
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const check = argv.includes('--check')
  const names = argv.filter((a) => !a.startsWith('-'))
  if (names.length !== 1) usage()

  const target = names[0] === 'all' ? null : (names[0] as Target)
  if (target !== null && !TARGETS.includes(target)) usage()
  const selected: readonly Target[] = target === null ? TARGETS : [target]

  if (!existsSync(SPEC)) {
    console.error(`缺少契约真源: ${SPEC}（先执行 cargo run --bin docs）`)
    return 1
  }

  const done: string[] = []

  if (selected.includes('ts')) {
    if (check) {
      if (!(await checkTs())) return 1
      done.push('typescript: 已提交类型与 spec 一致')
    } else {
      await generateTs(TS_COMMITTED)
      done.push(`typescript: ${TS_COMMITTED}`)
    }
  }

  if (selected.includes('python')) {
    await generatePython()
    done.push(`python: ${join(GEN, 'python')}`)
  }

  if (selected.includes('rust')) {
    await generateRust()
    done.push(`rust: ${join(GEN, 'rust')}`)
  }

  for (const d of done) console.log(`  ok  ${d}`)
  console.log(check ? '契约检查通过。' : '契约生成完成。')
  return 0
}

process.exit(await main())
