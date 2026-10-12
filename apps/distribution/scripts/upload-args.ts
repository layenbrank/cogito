/**
 * 两个上传脚本共用的参数解析：
 * - `--x 值` / `--x=值`，布尔旗标只有 `--help`；pnpm 原样递过来的 `--` 跳过；
 * - 「源文件 + 对象键」按 `--release|--version` + `--name`（默认 i-thinking_<版本>_x64-setup.exe）拼，
 *   并用读侧白名单先卡一道 —— 读侧下不了的键，传上去也是白传；
 * - 脚本入口统一收尾（出错打一行、退出码 1）。
 */

import { existsSync } from 'node:fs'
import { basename } from 'node:path'

import { isSetupKey } from '../src/setup-key.ts'

type UploadTarget = {
  source: string
  key: string
}

function parseArgs(argv: string[]): Map<string, string> {
  const parsed = new Map<string, string>()
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index] ?? ''
    if (token === '--') {
      continue
    }
    if (!token.startsWith('--')) {
      throw new Error(`无法识别的参数: ${token}`)
    }
    const [name, inlineValue] = token.slice(2).split('=')
    if (!name) {
      throw new Error(`无法识别的参数: ${token}`)
    }
    // 布尔旗标不能按「--x 值」解析
    if (inlineValue === undefined && name === 'help') {
      parsed.set('help', 'true')
      continue
    }
    if (inlineValue === undefined) {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`--${name} 缺参数值`)
      }
      parsed.set(name, value)
      index++
    } else {
      parsed.set(name, inlineValue)
    }
  }
  return parsed
}

/** 解析出源文件与对象键；`usage` 会跟着报错一起打出来 */
function findUploadTarget(args: Map<string, string>, usage: string): UploadTarget {
  const source = args.get('source')
  if (!source) {
    throw new Error(`--source 必填\n\n${usage}`)
  }
  if (!existsSync(source)) {
    throw new Error(`源文件不存在: ${source}`)
  }

  // --release 是主名；--version 留作别名（根 CLI 有同名旗标，直接写 --version 会被它截走）
  const version = args.get('release') ?? args.get('version')
  const name =
    args.get('name') ?? (version ? `i-thinking_${version}_x64-setup.exe` : basename(source))
  const key = args.get('key') ?? (version ? `${version}/${name}` : undefined)
  if (!key) {
    throw new Error(`--release 或 --key 必须给一个\n\n${usage}`)
  }
  if (!isSetupKey(key)) {
    throw new Error(
      `对象键 ${key} 不在读侧白名单内（形如 1.3.0/i-thinking_1.3.0_x64-setup.exe）——` +
        '传上去也下载不了，先对齐名字。'
    )
  }
  return { source, key }
}

/**
 * 脚本入口统一收尾：出错打一行原因、退出码 1。
 * 用 `process.exitCode` 而不是 `process.exit()` —— 顶层 await 期间硬退会撞上 libuv 的断言
 * （Windows 上实测直接崩，退出码变成 0xC0000409），让进程自己走到结束更稳。
 */
async function runMain(main: () => void | Promise<void>): Promise<void> {
  try {
    await main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

export { findUploadTarget, parseArgs, runMain }
