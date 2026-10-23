/**
 * 仓库架构卫生检查。
 *
 * 组成：
 *  - 遗留布局卫生：孤儿文件、模块必备文件、禁止路径
 *  - 能力边界门禁（R1–R6、R10、R11）：依赖方向、对外表面、权限判定唯一入口、表所有权、
 *    遗留模块冻结、封禁依赖的封装、内部调用契约路径
 *
 * 能力边界的声明在 scripts/capabilities.ts；本文件只做强制。
 *
 * 用法: pnpm arch
 * 退出码 0 = 通过；非 0 = 违规列表。
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import {
  CAPABILITIES,
  CONFINED_CRATE_DEPS,
  FORBIDDEN_CRATE_DEPS,
  INTERNAL_CONTRACT,
  LEGACY_SERVICES,
  PLATFORM_ENTRY_ALLOWED,
  PLATFORM_ENTRY_OWNER_PATHS,
  PLATFORM_ENTRY_PATTERN,
  ROLE_VOCAB_PATTERN,
  TENANT_SCOPE_LEGACY,
  TENANT_SCOPE_OWNER_PATHS,
  TENANT_SCOPE_PATTERN,
  UNSCOPED_DB_ALLOWED,
  UNSCOPED_DB_OWNER_PATHS,
  UNSCOPED_DB_PATTERN
} from './capabilities.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')
const LIB = join(SRC, 'lib.rs')
const CRATES = join(ROOT, 'crates')

/** 允许出现角色词汇的能力 crate：identity 定义词汇，authz 做判定 */
const ROLE_VOCAB_OWNERS = ['crates/identity', 'crates/authz'] as const

const CAPABILITY_NAMES = new Set(CAPABILITIES.map((c) => c.name))

const STANDARD_SERVICES = ['auth', 'user', 'engine', 'application', 'markdown'] as const

const COMPLEX_SERVICES: Record<string, { extra: Set<string> }> = {
  upload: {
    extra: new Set(['error.rs', 'multipart.rs', 'repository.rs', 'storage.rs', 'validation.rs'])
  }
}

/** 标准服务模块允许出现的额外文件；新增文件必须在此登记，避免模块悄悄膨胀 */
const STANDARD_SERVICE_EXTRA: Record<string, readonly string[]> = {
  auth: ['captcha.rs', 'otp.rs']
}

const FORBIDDEN_FILES = [
  join(SRC, 'utils', 'http.rs'),
  join(SRC, 'utils', 'response.rs'),
  join(SRC, 'middlewares', 'jwt.rs'),
  join(SRC, 'middlewares', 'response.rs'),
  join(SRC, 'services', 'shared')
]

const REQUIRED_SERVICE_FILES = [
  'controller.rs',
  'module.rs',
  'schema.rs',
  'service.rs',
  'README.md'
] as const

function fail(msg: string, errors: string[]) {
  errors.push(msg)
}

function rel(p: string) {
  return relative(ROOT, p).split('\\').join('/')
}

function walk(dir: string, ext = '.rs'): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return []
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full, ext))
    else if (entry.endsWith(ext)) out.push(full)
  }
  return out
}

function crateSrc(name: string): string[] {
  return walk(join(CRATES, name, 'src'))
}

/** 解析 Cargo.toml 中所有 *dependencies 段落里的依赖名 */
function manifestDepNames(text: string): Set<string> {
  const names = new Set<string>()
  let section = ''
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    const table = line.match(/^\[\s*([A-Za-z0-9_.-]+?)\s*\]$/)
    if (table) {
      const parts = table[1].split('.')
      section = parts[0]
      if (parts.length === 2 && section === 'dependencies') names.add(parts[1])
      continue
    }
    if (!section.endsWith('dependencies')) continue
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*[.=]/)
    if (kv) names.add(kv[1])
  }
  return names
}

/** PascalCase 表类型名 → 数据库表名 */
function toSnake(pascal: string): string {
  return pascal
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
}

function migrationTables(): string[] {
  const tables = new Set<string>()
  const dir = join(ROOT, 'migration', 'src')
  for (const file of walk(dir)) {
    const base = rel(file).split('/').pop()
    if (base === 'lib.rs' || base === 'main.rs') continue
    for (const m of readFileSync(file, 'utf8').matchAll(/\.table\((\w+)::Table\)/g)) {
      tables.add(toSnake(m[1]))
    }
  }
  return [...tables].sort()
}

function workspaceMembers(): string[] {
  const text = readFileSync(join(ROOT, 'Cargo.toml'), 'utf8')
  const m = text.match(/members\s*=\s*\[([\s\S]*?)\]/)
  if (!m) return []
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1])
}

function parseLibUtilsMods(libText: string): Set<string> {
  const m = libText.match(/pub mod utils \{([^}]+)\}/s)
  if (!m) return new Set()
  const names = [...m[1].matchAll(/pub mod (\w+);/g)].map((x) => x[1])
  return new Set(names)
}

function checkForbidden(errors: string[]) {
  for (const path of FORBIDDEN_FILES) {
    if (existsSync(path)) {
      fail(`禁止存在的路径仍在仓库: ${relative(ROOT, path)}`, errors)
    }
  }
}

function checkUtilsOrphans(errors: string[]) {
  const libText = readFileSync(LIB, 'utf8')
  const declared = parseLibUtilsMods(libText)
  const utilsDir = join(SRC, 'utils')
  if (!existsSync(utilsDir) || !statSync(utilsDir).isDirectory()) return
  for (const name of readdirSync(utilsDir)) {
    if (!name.endsWith('.rs')) continue
    const stem = name.slice(0, -3)
    if (!declared.has(stem)) {
      fail(`utils 孤儿文件未在 lib.rs 声明: utils/${name}`, errors)
    }
  }
}

function checkServices(errors: string[], hints: string[]) {
  const services = join(SRC, 'services')
  const names = [...STANDARD_SERVICES, ...Object.keys(COMPLEX_SERVICES)]
  for (const name of names) {
    const dirPath = join(services, name)
    if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) {
      hints.push(
        `services/${name} 已不存在：如已迁入能力 crate，请从 scripts/arch.ts 的遗留模块清单移除`
      )
      continue
    }
    for (const req of REQUIRED_SERVICE_FILES) {
      if (!existsSync(join(dirPath, req))) {
        fail(`services/${name} 缺少必备文件: ${req}`, errors)
      }
    }

    const allowed = new Set<string>(REQUIRED_SERVICE_FILES)
    if (name in COMPLEX_SERVICES) {
      for (const e of COMPLEX_SERVICES[name].extra) allowed.add(e)
    }
    for (const e of STANDARD_SERVICE_EXTRA[name] ?? []) allowed.add(e)

    for (const entry of readdirSync(dirPath)) {
      const full = join(dirPath, entry)
      if (entry === 'http' && statSync(full).isDirectory()) continue
      if (!statSync(full).isFile()) continue
      if (entry.endsWith('.rs') && !allowed.has(entry)) {
        if ((STANDARD_SERVICES as readonly string[]).includes(name)) {
          fail(`services/${name} 出现非标准文件 ${entry}（标准模块仅四文件）`, errors)
        }
        if (name in COMPLEX_SERVICES) {
          fail(`services/${name} 未登记的额外文件: ${entry}（请更新 scripts/arch.ts）`, errors)
        }
      }
    }
  }
}

function checkCrossCutting(errors: string[]) {
  const requiredDirs: Record<string, readonly string[]> = {
    middlewares: ['access_log', 'cors'],
    guards: [
      'account',
      'asset',
      'auth',
      'blacklist',
      'payment',
      'platform',
      'public',
      'session',
      'tenant'
    ],
    filters: ['exception'],
    interceptors: ['envelope']
  }
  for (const [dirname, mods] of Object.entries(requiredDirs)) {
    const base = join(SRC, dirname)
    for (const mod of mods) {
      const fileRs = join(base, `${mod}.rs`)
      if (!existsSync(fileRs)) {
        fail(`缺少横切模块: ${dirname}/${mod}.rs（勿仅用 ${mod}/mod.rs）`, errors)
      }
    }
  }
}

/** R1：能力 crate 的形态与依赖方向（只允许依赖已声明的能力，且不得依赖 api 二进制与 Web 框架） */
function checkCapabilityCrates(errors: string[], hints: string[]) {
  const members = workspaceMembers()
  for (const cap of CAPABILITIES) {
    const dir = join(CRATES, cap.name)
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      fail(`缺少能力 crate 目录: crates/${cap.name}（声明见 scripts/capabilities.ts）`, errors)
      continue
    }
    if (!members.includes(`crates/${cap.name}`)) {
      fail(`能力 crate 未在 [workspace] members 登记: crates/${cap.name}`, errors)
    }

    const manifestPath = join(dir, 'Cargo.toml')
    if (!existsSync(manifestPath)) {
      fail(`缺少 crates/${cap.name}/Cargo.toml`, errors)
      continue
    }
    const deps = manifestDepNames(readFileSync(manifestPath, 'utf8'))
    for (const dep of deps) {
      if ((FORBIDDEN_CRATE_DEPS as readonly string[]).includes(dep)) {
        fail(`能力 crate 不得依赖 ${dep}: crates/${cap.name}/Cargo.toml`, errors)
        continue
      }
      if (!CAPABILITY_NAMES.has(dep) || dep === cap.name) continue
      if (!cap.dependsOn.includes(dep)) {
        fail(
          `未声明的能力依赖 crates/${cap.name} → ${dep}（如需依赖请在 scripts/capabilities.ts 声明）`,
          errors
        )
      }
    }
    for (const declared of cap.dependsOn) {
      if (cap.status !== 'pending' && !deps.has(declared)) {
        hints.push(`crates/${cap.name} 声明可依赖 ${declared}，但 Cargo.toml 尚未使用`)
      }
    }
  }
}

/** R2：能力 crate 的对外表面（必备文件、README 章节、未登记的 pub mod） */
function checkCapabilitySurface(errors: string[]) {
  for (const cap of CAPABILITIES) {
    if (!existsSync(join(CRATES, cap.name))) continue
    for (const required of ['src/lib.rs', 'README.md']) {
      if (!existsSync(join(CRATES, cap.name, required))) {
        fail(`crates/${cap.name} 缺少必备文件: ${required}`, errors)
      }
    }
    const readmePath = join(CRATES, cap.name, 'README.md')
    if (existsSync(readmePath)) {
      const readme = readFileSync(readmePath, 'utf8')
      for (const heading of ['## 数据所有权', '## 对外接口']) {
        if (!readme.includes(heading)) {
          fail(`crates/${cap.name}/README.md 缺少章节: ${heading}`, errors)
        }
      }
    }
    for (const file of crateSrc(cap.name)) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(/^\s*pub mod (\w+)/gm)) {
        if (!cap.publicModules.includes(m[1])) {
          fail(
            `crates/${cap.name} 出现未登记的对外模块 pub mod ${m[1]}: ${rel(file)}（请更新 scripts/capabilities.ts）`,
            errors
          )
        }
      }
    }
  }
}

/** R3：角色/状态词汇只允许出现在 identity（定义）与 authz（判定）中，零容忍 */
function checkRoleVocabulary(errors: string[]) {
  const ownerPrefixes = ROLE_VOCAB_OWNERS.map((p) => `${p}/`)
  const files = [...walk(SRC), ...CAPABILITIES.flatMap((cap) => crateSrc(cap.name))]

  for (const file of files) {
    const path = rel(file)
    if (ownerPrefixes.some((p) => path.startsWith(p))) continue
    const hits = readFileSync(file, 'utf8').match(ROLE_VOCAB_PATTERN)
    if (!hits) continue
    fail(
      `角色词汇只能出现在 crates/identity（定义）与 crates/authz（判定）: ${path}（${hits.length} 处，如 ${hits[0]}）——身份解析走 identity，权限判定走 authz`,
      errors
    )
  }
}

/** R4/R5：表所有权唯一且完整（与 migration 实际建表集合对账） */
function checkTableOwnership(errors: string[]) {
  const owner = new Map<string, string>()
  for (const cap of CAPABILITIES) {
    for (const table of cap.owns) {
      const prev = owner.get(table)
      if (prev) {
        fail(`表 ${table} 被多个能力声明所有权: ${prev} 与 ${cap.name}`, errors)
        continue
      }
      owner.set(table, cap.name)
    }
  }

  const actual = migrationTables()
  for (const table of actual) {
    if (!owner.has(table)) {
      fail(`表 ${table} 未被任何能力 crate 声明所有权（migration 中已建表）`, errors)
    }
  }
  for (const [table, cap] of owner) {
    if (!actual.includes(table)) {
      fail(`crates/${cap} 声明了 migration 中不存在的表: ${table}`, errors)
    }
  }
}

/** R6：遗留 src/services 模块集合冻结，且 migrated 的能力不得再留下遗留路径 */
function checkLegacyServices(errors: string[], hints: string[]) {
  const services = join(SRC, 'services')
  if (existsSync(services)) {
    for (const entry of readdirSync(services)) {
      if (!statSync(join(services, entry)).isDirectory()) continue
      if (!(entry in LEGACY_SERVICES)) {
        fail(`src/services 已冻结，新能力请建 crates/<name>: services/${entry}`, errors)
      }
    }
  }
  for (const [name, info] of Object.entries(LEGACY_SERVICES)) {
    if (!existsSync(join(services, name))) {
      hints.push(
        `services/${name} 已删除，请从 scripts/capabilities.ts 的 LEGACY_SERVICES 移除（原归属 ${info.owner}）`
      )
    }
  }

  for (const cap of CAPABILITIES) {
    if (!cap.absorbs.length) continue
    const remaining = cap.absorbs.filter((p) => existsSync(join(ROOT, p)))
    if (cap.status === 'migrated' && remaining.length) {
      fail(`能力 ${cap.name} 已标记 migrated，但遗留路径仍存在: ${remaining.join(', ')}`, errors)
    }
    if (cap.status !== 'migrated' && !remaining.length) {
      hints.push(`能力 ${cap.name} 的遗留路径已全部删除，可把 status 改为 'migrated'`)
    }
  }
}

/** R7：进入租户作用域的唯一入口是 src/guards（遗留调用点按名单只减不增） */
function checkTenantScopeEntry(errors: string[], hints: string[]) {
  const seen = new Set<string>()

  for (const file of walk(SRC)) {
    const path = rel(file)
    if (TENANT_SCOPE_OWNER_PATHS.some((p) => path === p || path.startsWith(p))) continue
    const count = readFileSync(file, 'utf8').match(TENANT_SCOPE_PATTERN)?.length ?? 0
    if (!count) continue
    seen.add(path)
    const allow = TENANT_SCOPE_LEGACY[path]
    if (!allow) {
      fail(
        `进入作用域只能走 src/guards：${path}（${count} 处）——请求路径用对应守卫（TenantCtx/AccountScope/AssetReader::enter），机器路径把调用点登记到 scripts/capabilities.ts 的 TENANT_SCOPE_LEGACY`,
        errors
      )
      continue
    }
    if (count > allow.max) {
      fail(
        `作用域入口新增了 ${count - allow.max} 处: ${path}（豁免上限 ${allow.max}，原因：${allow.reason}）`,
        errors
      )
    } else if (count < allow.max) {
      hints.push(`${path} 的作用域入口已减少到 ${count} 处，请把豁免上限下调为 ${count}`)
    }
  }

  for (const path of Object.keys(TENANT_SCOPE_LEGACY)) {
    if (!seen.has(path)) {
      hints.push(`${path} 已无作用域入口，请从 scripts/capabilities.ts 的 TENANT_SCOPE_LEGACY 移除`)
    }
  }
}

/** R8：提权到平台角色只能走 src/guards 下的 PlatformScope（调用点正向登记） */
function checkPlatformScopeEntry(errors: string[], hints: string[]) {
  const seen = new Set<string>()

  for (const file of walk(SRC)) {
    const path = rel(file)
    if (PLATFORM_ENTRY_OWNER_PATHS.some((p) => path === p || path.startsWith(p))) continue
    const count = readFileSync(file, 'utf8').match(PLATFORM_ENTRY_PATTERN)?.length ?? 0
    if (!count) continue
    seen.add(path)
    const allow = PLATFORM_ENTRY_ALLOWED[path]
    if (!allow) {
      fail(
        `提权到平台角色只能走 src/guards::PlatformScope：${path}（${count} 处）——只有平台目录全局行与跨租户运维汇总需要提权；确需新增请登记到 scripts/capabilities.ts 的 PLATFORM_ENTRY_ALLOWED 并写明用途`,
        errors
      )
      continue
    }
    if (count > allow.max) {
      fail(
        `平台特权入口新增了 ${count - allow.max} 处: ${path}（登记上限 ${allow.max}，原因：${allow.reason}）`,
        errors
      )
    } else if (count < allow.max) {
      hints.push(`${path} 的平台特权入口已减少到 ${count} 处，请把登记上限下调为 ${count}`)
    }
  }

  for (const path of Object.keys(PLATFORM_ENTRY_ALLOWED)) {
    if (!seen.has(path)) {
      hints.push(`${path} 已无平台特权入口，请从 scripts/capabilities.ts 的 PLATFORM_ENTRY_ALLOWED 移除`)
    }
  }
}

/** R9：无作用域数据库访问只能走 src/guards 与 src/databases 的具名通道（调用点正向登记） */
function checkUnscopedDbAccess(errors: string[], hints: string[]) {
  const seen = new Set<string>()

  for (const file of walk(SRC)) {
    const path = rel(file)
    if (UNSCOPED_DB_OWNER_PATHS.some((p) => path === p || path.startsWith(p))) continue
    const count = readFileSync(file, 'utf8').match(UNSCOPED_DB_PATTERN)?.length ?? 0
    if (!count) continue
    seen.add(path)
    const allow = UNSCOPED_DB_ALLOWED[path]
    if (!allow) {
      fail(
        `无作用域数据库访问只能走 src/guards 与 src/databases 的具名通道（AssetReader::enter / Storage::raw）：${path}（${count} 处）——「读不到」应当来自策略，而不是忘了设作用域；确需读全局表（如没有行级安全的 auth）请登记到 scripts/capabilities.ts 的 UNSCOPED_DB_ALLOWED 并写明用途`,
        errors
      )
      continue
    }
    if (count > allow.max) {
      fail(
        `无作用域访问新增了 ${count - allow.max} 处: ${path}（登记上限 ${allow.max}，原因：${allow.reason}）`,
        errors
      )
    } else if (count < allow.max) {
      hints.push(`${path} 的无作用域访问已减少到 ${count} 处，请把登记上限下调为 ${count}`)
    }
  }

  for (const path of Object.keys(UNSCOPED_DB_ALLOWED)) {
    if (!seen.has(path)) {
      hints.push(`${path} 已无无作用域访问，请从 scripts/capabilities.ts 的 UNSCOPED_DB_ALLOWED 移除`)
    }
  }
}

/** R10：封禁依赖只允许出现在声明的那个 crate 的 manifest 里 */
function checkConfinedCrateDeps(errors: string[], hints: string[]) {
  // 根 manifest 是 api 二进制自己，同样受约束：只有能力 crate 才能碰封禁依赖。
  const manifests = ['Cargo.toml', ...workspaceMembers().map((m) => `${m}/Cargo.toml`)]
  const seen = new Set<string>()

  for (const manifest of manifests) {
    const path = join(ROOT, manifest)
    if (!existsSync(path)) continue
    const deps = manifestDepNames(readFileSync(path, 'utf8'))
    for (const [dep, owner] of Object.entries(CONFINED_CRATE_DEPS)) {
      if (!deps.has(dep)) continue
      seen.add(dep)
      const dir = dirname(manifest).split('\\').join('/')
      if (dir !== owner) {
        fail(`封禁依赖 ${dep} 只允许出现在 ${owner}/Cargo.toml，实际出现在 ${manifest}`, errors)
      }
    }
  }

  for (const dep of Object.keys(CONFINED_CRATE_DEPS)) {
    if (!seen.has(dep)) {
      hints.push(`封禁依赖 ${dep} 已无人使用，请从 scripts/capabilities.ts 的 CONFINED_CRATE_DEPS 移除`)
    }
  }
}

/** 从 spec/internal.yaml 的 paths 段取出声明的路径（2 空格缩进 + `/` 开头） */
function declaredInternalPaths(text: string): Set<string> {
  const out = new Set<string>()
  let inPaths = false
  for (const raw of text.split(/\r?\n/)) {
    if (/^\S/.test(raw)) {
      inPaths = raw.replace(/#.*$/, '').trim() === INTERNAL_CONTRACT.pathsKey
      continue
    }
    if (!inPaths) continue
    const m = raw.match(/^ {2}(\/\S*?):\s*$/)
    if (m) out.add(m[1])
  }
  return out
}

/** 去掉 `#[cfg(test)]` 标注的项（单测里的期望值不是调用点）。
 *
 * 依赖 rustfmt 的缩进惯例：`#[cfg(test)]` 标注的项以第 0 列的 `}`（或 `;`）收尾，
 * 所以跳过范围是有界的，不会把文件后半段一起吞掉。
 */
function stripTestRegions(text: string): string {
  const out: string[] = []
  let skipping = false
  let armed = false
  for (const line of text.split(/\r?\n/)) {
    if (!skipping) {
      if (/^\s*#\[cfg\(test\)\]/.test(line)) {
        skipping = true
        armed = true
        out.push('')
        continue
      }
      out.push(line)
      continue
    }
    out.push('')
    if (armed) {
      // 属性标注的是紧接着的那个项：先进到它的 `{`；单行项（如 `use`）以 `;` 收尾。
      if (line.includes('{')) {
        armed = false
      } else if (/;\s*$/.test(line)) {
        skipping = false
      }
      continue
    }
    if (/^\}/.test(line)) skipping = false
  }
  return out.join('\n')
}

/** R11：内部调用契约的路径只允许出现在出站客户端里，且必须已登记在 spec/internal.yaml */
function checkInternalContractPaths(errors: string[], hints: string[]) {
  const specPath = join(ROOT, INTERNAL_CONTRACT.spec)
  if (!existsSync(specPath)) {
    fail(`内部契约 ${INTERNAL_CONTRACT.spec} 不存在（cogito ↔ compute 的路径声明源）`, errors)
    return
  }

  const declared = declaredInternalPaths(readFileSync(specPath, 'utf8'))
  if (!declared.size) {
    fail(`${INTERNAL_CONTRACT.spec} 的 paths 段没有任何路径声明，R11 会形同虚设`, errors)
    return
  }

  const used = new Set<string>()
  for (const file of walk(SRC)) {
    const fileRel = rel(file)
    const ownsContract = fileRel.startsWith(`${INTERNAL_CONTRACT.clientDir}/`)
    const source = stripTestRegions(readFileSync(file, 'utf8'))
    for (const m of source.matchAll(/["'`](\/internal\/[A-Za-z0-9_{}./-]*)["'`]/g)) {
      const path = m[1]
      used.add(path)
      if (!ownsContract) {
        fail(
          `内部契约路径 ${path} 出现在 ${fileRel}；/internal/** 只允许出现在 ${INTERNAL_CONTRACT.clientDir}/ 的客户端里`,
          errors
        )
      } else if (!declared.has(path)) {
        fail(`${fileRel} 调用了未登记的内部契约路径 ${path}（请先写进 ${INTERNAL_CONTRACT.spec}）`, errors)
      }
    }
  }

  if (!used.size) {
    hints.push(
      `${INTERNAL_CONTRACT.spec} 声明了内部契约，但 src/ 里没有任何调用点（P6 实现 compute 后应接入客户端）`
    )
  }
}

function main(): number {
  const errors: string[] = []
  const hints: string[] = []
  if (!existsSync(LIB)) {
    console.error('ERROR: src/lib.rs 不存在')
    return 2
  }

  checkForbidden(errors)
  checkUtilsOrphans(errors)
  checkServices(errors, hints)
  checkCrossCutting(errors)
  checkCapabilityCrates(errors, hints)
  checkCapabilitySurface(errors)
  checkRoleVocabulary(errors)
  checkTenantScopeEntry(errors, hints)
  checkPlatformScopeEntry(errors, hints)
  checkUnscopedDbAccess(errors, hints)
  checkTableOwnership(errors)
  checkLegacyServices(errors, hints)
  checkConfinedCrateDeps(errors, hints)
  checkInternalContractPaths(errors, hints)

  if (errors.length) {
    console.log('Architecture check FAILED:')
    for (const e of errors) console.log(`  - ${e}`)
    if (hints.length) {
      console.log('提示:')
      for (const h of hints) console.log(`  - ${h}`)
    }
    return 1
  }

  if (hints.length) {
    console.log('提示:')
    for (const h of hints) console.log(`  - ${h}`)
  }
  console.log('Architecture check passed.')
  return 0
}

process.exit(main())
