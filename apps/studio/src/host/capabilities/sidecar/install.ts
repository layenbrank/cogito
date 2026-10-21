import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  findBinary,
  findBundledBinary,
  findUserDataDir,
  isPackagedApp
} from '@/host/framework/binaries'

/**
 * 怎么找到 corex。三份来源**各归各位**，谁也不顶替谁：
 *
 * - **用户自己装的那份**（`COREX_CLI` 指定 / PATH / `%LOCALAPPDATA%\corex\bin` / `Program Files\corex`）：
 *   数据目录、端点、token 都由它自己算（问 `corex paths --json`）。它是用户的，指令就在他的数据目录里。
 * - **Studio 自带的那份**：打包态在 `resources/sidecar`，开发态在
 *   `apps/studio/sidecar/staging/<platform>`（`pnpm command sidecar bootstrap studio` 按 tools.lock
 *   拉下来并校验 sha256）。自带那份用应用私有的数据目录，端点与 corex 平台默认一致
 *   （Windows `\\.\pipe\corex`，Unix `<data>/corex.sock`）。
 * - **数据目录不是安装目录**：`~/.corex` 只放数据（指令库、token、历史），不放进候选安装位置。
 *   它曾经也在候选里 —— 那会让「开发时用哪份二进制」被用户环境里那份旧 corex 悄悄决定。
 *
 * 优先级按「谁来用」分：打包态用户那份优先（尊重用户环境），开发态自带那份优先（tools.lock 钉版本、
 * 可复现）；`COREX_CLI` 永远最高 —— 显式指定说了算。
 */

const COREX_CLI = 'corex'
const COREX_DAEMON = 'corex-daemon'

/** 显式指定 corex 可执行文件；优先于 PATH 与常见安装位置。 */
const COREX_CLI_ENV = 'COREX_CLI'
/** 数据目录：corex 自己认它（优先级最高），宿主也用它钉住自带那份的落点。 */
const COREX_DATA_DIR_ENV = 'COREX_DATA_DIR'
const COREX_TOKEN_ENV = 'COREX_TOKEN'

/** 指令库文件名：`paths --json` 没报 `database` 时按数据目录下的这个默认名推（对齐 cogito-client.db） */
const DATABASE_FILE = 'corex.db'

/** 探测 `corex paths` 的超时：启动路径上不该被一条命令拖住。 */
const PATHS_TIMEOUT_MS = 5_000

/**
 * Windows 默认命名管道，与 `corex_ipc::ipc_endpoint` / CLI / MCP 一致。
 * 私有数据目录靠 `COREX_DATA_DIR` 隔离；端点不另起名字，避免宿主与 corex 各连各的。
 */
const BUNDLED_ENDPOINT = String.raw`\\.\pipe\corex`

/** `corex paths --json` 的字段，由 corex 自己算好，宿主不重新拼。 */
interface CorexPaths {
  version: string
  data_dir: string
  /** v13 起指令的唯一真相：一个 SQLite 文件（`corex.db`） */
  database: string
  endpoint: string
  /** daemon 的 token 文件；`null` 表示 token 来自 `COREX_TOKEN` 或配置，那两处属于调用方 */
  token_file: string | null
}

/** 一份 corex 装在哪、怎么连。 */
interface CorexInstall {
  cli: string
  daemon: string
  /** 数据目录：指令库 / token / 历史都在这 */
  dataDir: string
  /** 指令库文件（v13）；旧版 corex 不报时按数据目录下的默认名推 */
  database: string
  endpoint: string
  /** daemon 的 token 文件；`null` 时只能靠 `COREX_TOKEN` */
  tokenFile: string | null
  version: string
  /** true = Studio 自带的那份（用户没装 corex） */
  isBundled: boolean
}

/** 找用户装 corex 的常见位置。**不含数据目录** —— `~/.corex` 只放数据。 */
function findCandidateDirs(): string[] {
  const dirs: string[] = []
  for (const entry of (process.env.PATH ?? '').split(path.delimiter)) {
    if (entry) {
      dirs.push(entry)
    }
  }
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local')
    // install.ps1 的默认安装目录，外加老版本的落点
    dirs.push(path.join(local, 'corex', 'bin'))
    dirs.push(path.join(local, 'corex'))
    if (process.env.ProgramFiles) {
      dirs.push(path.join(process.env.ProgramFiles, 'corex'))
    }
  } else {
    dirs.push(path.join(os.homedir(), '.local', 'bin'))
    dirs.push('/usr/local/bin')
  }

  const seen = new Set<string>()
  return dirs.filter(function (dir) {
    const key = process.platform === 'win32' ? dir.toLowerCase() : dir
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

/** `COREX_CLI` 显式指定的那份：说了算，两种模式都排最前。 */
async function findExplicitInstall(): Promise<CorexInstall | null> {
  const explicit = process.env[COREX_CLI_ENV]?.trim()
  return explicit ? probeDir(path.dirname(explicit)) : null
}

/** 探一个目录：得同时有 cli 与 daemon，且那份 corex 自己认得路。 */
async function probeDir(dir: string): Promise<CorexInstall | null> {
  const cli = findBinary({ dirs: [dir], names: [COREX_CLI] })?.path
  const daemon = findBinary({ dirs: [dir], names: [COREX_DAEMON] })?.path
  if (!cli || !daemon) {
    return null
  }
  const paths = await probePaths(cli)
  if (!paths) {
    return null
  }
  return {
    cli,
    daemon,
    dataDir: paths.data_dir,
    database: paths.database,
    endpoint: paths.endpoint,
    tokenFile: paths.token_file,
    version: paths.version,
    isBundled: false
  }
}

/** 用户自己装的那份：按候选目录顺序探，第一个认路的算。 */
async function findUserInstall(): Promise<CorexInstall | null> {
  for (const dir of findCandidateDirs()) {
    const install = await probeDir(dir)
    if (install) {
      return install
    }
  }
  return null
}

/** 自带那份的二进制在不在：开发态没 bootstrap 过就没有，那时才轮到用户装的那份。 */
function hasBundledBinary(): boolean {
  return existsSync(findBundledBinary(COREX_CLI)) && existsSync(findBundledBinary(COREX_DAEMON))
}

/**
 * 找 corex：`COREX_CLI` → 按「谁来用」排的两份来源。
 *
 * 两份都不可用时把自带那份的路径交出去 —— 界面至少能说明它指向哪、为什么连不上。
 */
async function findCorexInstall(): Promise<CorexInstall> {
  const bundled = async function (): Promise<CorexInstall | null> {
    return hasBundledBinary() ? findBundledInstall() : null
  }

  const explicit = await findExplicitInstall()
  if (explicit) {
    return explicit
  }

  const sources = isPackagedApp() ? [findUserInstall, bundled] : [bundled, findUserInstall]
  for (const find of sources) {
    const install = await find()
    if (install) {
      return install
    }
  }

  return findBundledInstall()
}

/** 问 corex 自己路径；不认识 `paths`（旧版）或跑挂了一律当没这份安装。 */
function probePaths(cli: string): Promise<CorexPaths | null> {
  return new Promise(function (resolve) {
    execFile(
      cli,
      ['paths', '--json'],
      { timeout: PATHS_TIMEOUT_MS, windowsHide: true, encoding: 'utf8' },
      function (error, stdout) {
        if (error) {
          console.warn('[corex] 探测 corex paths 失败，跳过这份安装', cli, error.message)
          resolve(null)
          return
        }
        resolve(parsePaths(stdout))
      }
    )
  })
}

/** 校验 `paths --json` 的输出：缺了赖以连上的字段就作废。 */
function parsePaths(text: string): CorexPaths | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    console.warn('[corex] corex paths 输出不是 JSON', error)
    return null
  }
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const doc = raw as Record<string, unknown>
  const dataDir = typeof doc.data_dir === 'string' ? doc.data_dir : ''
  const endpoint = typeof doc.endpoint === 'string' ? doc.endpoint : ''
  if (!dataDir || !endpoint) {
    return null
  }

  return {
    version: typeof doc.version === 'string' ? doc.version : '',
    data_dir: dataDir,
    database:
      typeof doc.database === 'string' && doc.database
        ? doc.database
        : path.join(dataDir, DATABASE_FILE),
    endpoint,
    token_file: typeof doc.token_file === 'string' && doc.token_file ? doc.token_file : null
  }
}

/**
 * 自带那份的数据目录：打包态固定用应用私有的那份；开发态允许 `COREX_DATA_DIR` 指向真实数据目录
 * —— 自带那份只认识起步指令，调编辑器时看不到自己的指令。
 */
function findBundledDataDir(): string {
  const privateDir = path.join(findUserDataDir(), 'corex')
  if (isPackagedApp()) {
    return privateDir
  }
  return process.env[COREX_DATA_DIR_ENV]?.trim() || privateDir
}
/**
 * Studio 自带的那份：私有数据目录 + 平台默认端点（与 corex CLI / MCP 同一条管道）。
 *
 * 数据目录**绝不用 exe 旁边**：开发态 staging 在仓库里、打包态 `resources/sidecar` 在应用目录里，
 * 而 corex 的解析顺序里「可写的 exe 目录」排在第二位 —— 不钉住就会把指令库写进那些地方。
 * Windows 端点不随数据目录变；已有 daemon 在默认管道上时会复用（见 sidecar `ping`）。
 */
function findBundledInstall(): CorexInstall {
  const dataDir = findBundledDataDir()
  return {
    cli: findBundledBinary(COREX_CLI),
    daemon: findBundledBinary(COREX_DAEMON),
    dataDir,
    database: path.join(dataDir, DATABASE_FILE),
    endpoint: process.platform === 'win32' ? BUNDLED_ENDPOINT : path.join(dataDir, 'corex.sock'),
    tokenFile: path.join(dataDir, 'token'),
    version: '',
    isBundled: true
  }
}

/**
 * 连 daemon 用的 token，与 corex 连接方的顺序一致：`COREX_TOKEN` → 记录里的 token 文件。
 *
 * 每次调用都重读文件：自起的 daemon 是在第一轮 ping 之后才把 token 写下来的。
 * 读不到就是空串 —— 那时该做的是自起一个 daemon，而不是拿别人的 token 硬连。
 */
function resolveAuthToken(install: CorexInstall): string {
  const fromEnv = process.env[COREX_TOKEN_ENV]?.trim()
  if (fromEnv) {
    return fromEnv
  }
  if (!install.tokenFile) {
    return ''
  }
  try {
    return readFileSync(install.tokenFile, 'utf8').trim()
  } catch (error) {
    console.warn('[corex] 读 token 文件失败', install.tokenFile, error)
    return ''
  }
}

export {
  BUNDLED_ENDPOINT,
  COREX_CLI,
  COREX_CLI_ENV,
  COREX_DAEMON,
  COREX_DATA_DIR_ENV,
  COREX_TOKEN_ENV,
  DATABASE_FILE,
  findBundledInstall,
  findCandidateDirs,
  findCorexInstall,
  parsePaths,
  PATHS_TIMEOUT_MS,
  resolveAuthToken
}
export type { CorexInstall, CorexPaths }
