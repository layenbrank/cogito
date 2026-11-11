#!/usr/bin/env node
/**
 * 壳层权限面门禁（计划 S1 / 1C 的防回滚装置）。
 *
 * 背景：capabilities 只管「渲染进程能调到哪些插件命令」，管不到 Agent 的工具面
 * （Agent 走 loopback 桥 + goose 内置工具，见 docs/decisions/security-boundary.md）。
 * 所以这里断言的不是「安全已经达标」，而是「已经收掉的口子不许被重新放开」：
 *
 *   1. fs:scope 里的全盘通配只许出现在基线账目里（那是 1B 的待清账目），不许新增；
 *   2. withGlobalTauri 必须是 false；
 *   3. @tauri-apps/plugin-fs 的引用面只许缩小；
 *   4. capabilities 里不许再出现明文 http 通配（http 协议 + 星号主机 / 星号端口）；
 *   5. 生产 CSP 的 default-src / connect-src 不许是通配星号；
 *   6. 渲染进程源码里不许出现 COGITO_BRIDGE_TOKEN（S2：令牌只经文件交给 cogito-mcp）。
 *   7. 系统 git 只许在 `git/cli.rs` 一个点上 spawn（S5：加固配置与 spawn 同处）。
 *   8. 工具审计表里不许出现明文参数列，且三个审计点（分发入口 / 被拒请求 /
 *      app 侧工具）不许被删（S6）。
 *
 * 用法：
 *   node scripts/check/security-surface.mjs                  # 门禁模式（CI / pnpm check）
 *   node scripts/check/security-surface.mjs --write-baseline  # 引用面缩小后重写基线
 *   node scripts/check/security-surface.mjs --strict          # 1B 完成后用：任何 fs 通配都算违规
 *
 * 退出码：0 = 全过；1 = 有违规。
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const CLIENT = join(ROOT, 'apps', 'client')
const CAPS_DIR = join(CLIENT, 'src-tauri', 'capabilities')
const TAURI_CONF = join(CLIENT, 'src-tauri', 'tauri.conf.json')
const SRC_DIR = join(CLIENT, 'src')
const BASELINE = join(ROOT, 'scripts', 'check', 'security-surface.allowlist.json')

/** fs:scope 里被禁的全盘通配 */
const FORBIDDEN_FS_SCOPES = new Set(['**', '/**', '**/*', '/*'])
/** capabilities 里被禁的明文 http 通配（https 保留：预签名上传 / 远端素材下载） */
const FORBIDDEN_HTTP_URLS = new Set(['http://**', 'http://*:*'])
/** 引用 @tauri-apps/plugin-fs 的模块（1A 会逐个搬进 Rust 命令） */
const FS_IMPORT_PATTERN = /@tauri-apps\/plugin-fs/
/** 系统 git 的 spawn 形态（S5：只许出现在 git/cli.rs） */
const GIT_SPAWN_PATTERN = /Command::new\("git"\)/

const failures = []
const warnings = []

function fail(message) {
  failures.push(message)
}

function warn(message) {
  warnings.push(message)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function toPosix(path) {
  return path.split('\\').join('/')
}

/** 递归列出 src 下的 ts/tsx */
function listSources(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue
      listSources(full, out)
      continue
    }
    if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(full)
  }
  return out
}

/** 收集 fs:scope 里的全盘通配：{ 文件名: [通配...] } */
/** 递归列出 Rust 源码（跳过 target / node_modules） */
function listRustSources(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (name === 'target' || name === 'node_modules') continue
      listRustSources(full, out)
      continue
    }
    if (name.endsWith('.rs')) out.push(full)
  }
  return out
}

function collectFsScopeWildcards() {
  const ledger = {}
  if (!existsSync(CAPS_DIR)) return ledger
  for (const name of readdirSync(CAPS_DIR)) {
    if (!name.endsWith('.json')) continue
    const capability = readJson(join(CAPS_DIR, name))
    const permissions = Array.isArray(capability.permissions) ? capability.permissions : []
    for (const permission of permissions) {
      if (typeof permission !== 'object' || permission === null) continue
      if (!String(permission.identifier ?? '').startsWith('fs:scope')) continue
      const allow = Array.isArray(permission.allow) ? permission.allow : []
      const hits = allow.filter((entry) => typeof entry === 'string' && FORBIDDEN_FS_SCOPES.has(entry))
      if (hits.length > 0) ledger[name] = hits
    }
  }
  return ledger
}

/** 1 + 4：capabilities 断言（fs 通配只许留在基线账目里） */
function checkCapabilities(ledger, strict) {
  if (!existsSync(CAPS_DIR)) {
    fail(`找不到 capabilities 目录：${toPosix(relative(ROOT, CAPS_DIR))}`)
    return
  }
  for (const name of readdirSync(CAPS_DIR)) {
    if (!name.endsWith('.json')) continue
    const capability = readJson(join(CAPS_DIR, name))
    const permissions = Array.isArray(capability.permissions) ? capability.permissions : []
    for (const permission of permissions) {
      // 字符串形态（`fs:default`）没有 scope，跳过
      if (typeof permission !== 'object' || permission === null) continue
      const identifier = String(permission.identifier ?? '')
      const allow = Array.isArray(permission.allow) ? permission.allow : []
      if (identifier.startsWith('fs:scope')) {
        const known = new Set(ledger[name] ?? [])
        for (const entry of allow) {
          if (typeof entry !== 'string' || !FORBIDDEN_FS_SCOPES.has(entry)) continue
          if (!strict && known.has(entry)) {
            warn(`${name}: fs:scope 全盘通配 "${entry}" 属 1B 待清账目（授权集落地后清掉）`)
            continue
          }
          fail(`${name}: ${identifier} 出现全盘通配 "${entry}"（1B 收口前必须先有授权集，且不许新增）`)
        }
      }
      if (identifier.startsWith('http:')) {
        for (const entry of allow) {
          const url = typeof entry === 'string' ? entry : entry?.url
          if (typeof url === 'string' && FORBIDDEN_HTTP_URLS.has(url)) {
            fail(`${name}: ${identifier} 仍有明文 http 通配 "${url}"`)
          }
        }
      }
    }
  }
}

/** 2 + 5：tauri.conf.json 断言 */
function checkTauriConf() {
  if (!existsSync(TAURI_CONF)) {
    fail('找不到 apps/client/src-tauri/tauri.conf.json')
    return
  }
  const conf = readJson(TAURI_CONF)
  if (conf?.app?.withGlobalTauri !== false) {
    fail('tauri.conf.json: app.withGlobalTauri 必须是 false（渲染进程不该拿到 __TAURI__ 全局）')
  }
  const csp = conf?.app?.security?.csp
  if (!csp || typeof csp !== 'object') {
    fail('tauri.conf.json: 生产 CSP 缺失')
    return
  }
  for (const key of ['default-src', 'connect-src']) {
    const value = String(csp[key] ?? '')
    if (value.split(/\s+/).includes('*')) {
      fail(`tauri.conf.json: csp.${key} 仍是通配 "*"`)
    }
  }
}

/** 3：plugin-fs 引用面 */
function collectFsImports() {
  const hits = []
  for (const file of listSources(SRC_DIR)) {
    const text = readFileSync(file, 'utf8')
    if (!FS_IMPORT_PATTERN.test(text)) continue
    hits.push(toPosix(relative(CLIENT, file)))
  }
  return hits.sort()
}

/** 3b：渲染进程不许读 __TAURI__ 全局（withGlobalTauri=false 之后的第二道防线） */
function checkGlobalTauriReads() {
  for (const file of listSources(SRC_DIR)) {
    const text = readFileSync(file, 'utf8')
    if (!/window\.__TAURI__\s*\./.test(text) && !/__TAURI__\?\./.test(text)) continue
    fail(`${toPosix(relative(CLIENT, file))}: 直接读 window.__TAURI__ 全局（改用 @tauri-apps/api 的 import）`)
  }
}

function checkFsImportSurface() {
  const found = collectFsImports()
  if (!existsSync(BASELINE)) {
    fail(
      `缺少基线文件 ${toPosix(relative(ROOT, BASELINE))}；先跑 node scripts/check/security-surface.mjs --write-baseline`
    )
    return
  }
  const baseline = readJson(BASELINE)
  const allowed = new Set(Array.isArray(baseline.files) ? baseline.files : [])
  for (const file of found) {
    if (!allowed.has(file)) {
      fail(`${file}: 新引入 @tauri-apps/plugin-fs（1A 要求走 Rust 命令；确需放行请显式改基线并说明）`)
    }
  }
  for (const file of allowed) {
    if (!found.includes(file)) warn(`${file}: 基线里的 plugin-fs 引用已消失，可跑 --write-baseline 缩小基线`)
  }
}

/** 3c：选路点必须走 shared/ipc/dialog 门面（否则选完不授权，重启后路径失效） */
const DIALOG_IMPORT_PATTERN = /from '@tauri-apps\/plugin-dialog'/
const DIALOG_FACADE = 'src/shared/ipc/dialog.ts'

function checkDialogFacade() {
  for (const file of listSources(SRC_DIR)) {
    const rel = toPosix(relative(CLIENT, file))
    if (rel === DIALOG_FACADE) continue
    if (rel.endsWith('.test.ts') || rel.endsWith('.test.tsx')) continue
    const text = readFileSync(file, 'utf8')
    if (!DIALOG_IMPORT_PATTERN.test(text)) continue
    fail(`${rel}: 直接 import @tauri-apps/plugin-dialog（选路点必须走 ${DIALOG_FACADE}，否则选出目录不进授权集）`)
  }
}
/** 3d：桥令牌不许回到渲染进程（S2）。前端只允许出现「令牌文件路径」相关的名字。 */
const BRIDGE_TOKEN_ENV_PATTERN = /\bCOGITO_BRIDGE_TOKEN\b/

/** 3e：系统 git 只允许一个 spawn 点（S5）——加固只写在这一处，别处再 spawn 就漏了 */
const GIT_SPAWN_ALLOWED = 'src-tauri/crates/command/src/git/cli.rs'

function checkGitSpawn() {
  const dirs = [join(CLIENT, 'src-tauri', 'src'), join(CLIENT, 'src-tauri', 'crates')]
  for (const dir of dirs) {
    for (const file of listRustSources(dir)) {
      const rel = toPosix(relative(CLIENT, file))
      if (rel === GIT_SPAWN_ALLOWED) continue
      const text = readFileSync(file, 'utf8')
      if (GIT_SPAWN_PATTERN.test(text)) {
        fail(
          `${rel}: 在 ${GIT_SPAWN_ALLOWED} 之外 spawn 了 git（加固配置在那里，别处调用会绕开 core.fsmonitor=false / --no-ext-diff）`
        )
      }
    }
  }
}

function checkBridgeToken() {
  for (const file of listSources(SRC_DIR)) {
    const rel = toPosix(relative(CLIENT, file))
    if (rel.endsWith('.test.ts') || rel.endsWith('.test.tsx')) continue
    const text = readFileSync(file, 'utf8')
    if (BRIDGE_TOKEN_ENV_PATTERN.test(text)) {
      fail(
        `${rel}: 渲染进程里出现 COGITO_BRIDGE_TOKEN（令牌只能落 <appLocalData>/bridge/token，由 cogito-mcp 自己读）`
      )
    }
  }
}

/** 3f：工具审计（S6）——表里只许有摘要、审计点不许被删掉 */
const AUDIT_SCHEMA = join(
  CLIENT,
  'src-tauri',
  'crates',
  'database',
  'src',
  'migrations',
  'tool_audit_schema.rs'
)
const AUDIT_CALL_SITES = [
  join(CLIENT, 'src-tauri', 'crates', 'core', 'src', 'tools', 'mod.rs'),
  join(CLIENT, 'src-tauri', 'src', 'bridge', 'http.rs')
]

function checkToolAudit() {
  if (!existsSync(AUDIT_SCHEMA)) {
    fail('工具审计表 DDL 不见了（S6）：agent_tool_audit 的列定义在 tool_audit_schema.rs')
    return
  }
  const ddl = readFileSync(AUDIT_SCHEMA, 'utf8')
  // 只看 DDL 正文（`r#"..."#` 里的 CREATE 语句）：测试断言与注释里会提到
  // 「arguments TEXT」这个禁词，不能算违规
  const statements = [...ddl.matchAll(/r#"([\s\S]*?)"#/g)]
    .map((match) => match[1])
    .join('\n')
  if (/\b(?:arguments?|args)\s+TEXT/i.test(statements)) {
    fail('tool_audit_schema.rs: 审计表里出现了明文参数列（只许存 argsDigest）')
  }
  if (!/argsDigest\s+TEXT/i.test(statements)) {
    fail('tool_audit_schema.rs: 缺 argsDigest 列 —— 参数摘要没了就等于不记参数')
  }
  // 审计点：`tools::call` 入口（含失败）与桥的两条旁路（被拒 / app 侧工具）
  const [modRs, httpRs] = AUDIT_CALL_SITES
  if (!existsSync(modRs) || !/audit::record\(/.test(readFileSync(modRs, 'utf8'))) {
    fail('crates/core/src/tools/mod.rs: 工具分发入口没有调用 audit::record（S6 审计点被删）')
  }
  if (!existsSync(httpRs)) {
    fail('src/bridge/http.rs 不见了')
    return
  }
  const http = readFileSync(httpRs, 'utf8')
  if (!/audit::record_rejected\(/.test(http)) {
    fail('src/bridge/http.rs: 被拒请求（401 / 会话）不再落审计')
  }
  if (!/audit::record\(/.test(http)) {
    fail('src/bridge/http.rs: app 侧工具（浏览器 / 终端）不再落审计')
  }
}

function writeBaseline() {
  const payload = {
    $comment:
      'plugin-fs 引用面基线（只许缩小）。S1/1A 会把下列文件逐个搬进 Rust 命令；新增文件必须显式改这里。',
    $fsScopeDebt:
      'fs:scope 全盘通配账目：1B 收口完成前允许存在，清掉后删条目并用 --strict 跑一次门禁。',
    generatedAt: new Date().toISOString(),
    files: collectFsImports(),
    fsScopeWildcards: collectFsScopeWildcards()
  }
  writeFileSync(BASELINE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  console.log(
    `security-surface: 已写入基线 ${toPosix(relative(ROOT, BASELINE))}（plugin-fs ${payload.files.length} 个文件 / fs 通配 ${Object.keys(payload.fsScopeWildcards).length} 个 capability）`
  )
}

function readLedger() {
  if (!existsSync(BASELINE)) return {}
  const baseline = readJson(BASELINE)
  return baseline.fsScopeWildcards ?? {}
}

function main() {
  if (process.argv.includes('--write-baseline')) {
    writeBaseline()
    return
  }
  const strict = process.argv.includes('--strict')
  checkCapabilities(readLedger(), strict)
  checkTauriConf()
  checkGlobalTauriReads()
  checkFsImportSurface()
  checkDialogFacade()
  checkBridgeToken()
  checkGitSpawn()
  checkToolAudit()

  for (const message of warnings) console.warn(`security-surface warn: ${message}`)
  if (failures.length > 0) {
    console.error(`security-surface: 发现 ${failures.length} 处回归`)
    for (const message of failures) console.error(`  ✗ ${message}`)
    process.exit(1)
  }
  console.log(
    'security-surface: OK（withGlobalTauri=false / plugin-fs 引用面未扩大 / 选路走 dialog 门面 / 桥令牌不进渲染进程 / 无新增明文 http 通配 / CSP 非通配 / git 单点 spawn / 审计只存摘要）'
  )
}

main()
