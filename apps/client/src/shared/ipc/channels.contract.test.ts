import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { CHANNELS } from '@/shared/ipc/channels'

/**
 * 契约测试：`CHANNELS` 里每个 invoke 频道都必须真在 Rust 里注册过。
 *
 * 为什么需要它：`#[tauri::command]` 的函数名就是频道名，只有显式
 * `#[tauri::command(rename = "media:pick")]` 才叫 `media:pick`。少写一个 rename 不会编译报错，
 * 只会在运行期变成 `Command media:pick not found` —— 图库导入就是这么整条链路哑掉的。
 */

/** CHANNELS 里混着少数「事件」频道（走 listen，不是 invoke）；有新增就在这里登记原因 */
const EVENT_ONLY = new Set<string>([
  // 工作区文件变化通知：由 watcher 主动 emit
  'workspaceFiles:changed',
  // 图库导入进度：`gallery:import` 循环里逐条 emit，不是 invoke
  'gallery://import-progress',
  // 去重进度：同上
  'gallery://dedupe-progress',
  // 在线工具下载进度：Rust 安装器逐块 emit，不是 invoke
  'tools://install-progress'
])

/**
 * 已声明、但 Rust 还没实现的 invoke 频道：只允许「明确在做」的临时候选。
 * 落地后必须从这张表删掉 —— 下面的「登记不会过期」用例会强制提醒。
 */
const PENDING_COMMANDS = new Map<string, string>([
  ['tools:install', '设置 → 诊断 的按需下载：Rust 安装器未实现'],
  ['tools:remove', '同上：卸载未实现']
])

function collectRustFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) collectRustFiles(path, out)
    else if (entry.name.endsWith('.rs')) out.push(path)
  }
  return out
}

/** 从 Rust 源码里抓出所有已注册命令名：优先 `rename = "..."`，否则用函数名 */
function registeredCommands(files: string[]): Set<string> {
  const names = new Set<string>()
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    const attribute = /#\[tauri::command(?:\(([^)]*)\))?\]/g
    let match: RegExpExecArray | null = attribute.exec(source)
    while (match !== null) {
      const rename = /rename\s*=\s*"([^"]+)"/.exec(match[1] ?? '')
      if (rename) {
        names.add(rename[1])
      } else {
        const after = source.slice(match.index + match[0].length)
        const fn = /fn\s+([A-Za-z0-9_]+)\s*[(<]/.exec(after)
        if (fn) names.add(fn[1])
      }
      match = attribute.exec(source)
    }
  }
  return names
}

function flattenChannelValues(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value)
    return out
  }
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value)) flattenChannelValues(nested, out)
  }
  return out
}

// vitest 的 cwd 是 apps/client（pnpm --filter 也会 set cwd），Rust 源码就在旁边
const rustRoot = join(process.cwd(), 'src-tauri')
const registered = registeredCommands([
  ...collectRustFiles(join(rustRoot, 'src')),
  ...collectRustFiles(join(rustRoot, 'crates'))
])
const channels = Array.from(new Set(flattenChannelValues(CHANNELS)))

function findMissing(names: string[], known: Set<string>): string[] {
  return names.filter(function (name) {
    return !known.has(name) && !EVENT_ONLY.has(name) && !PENDING_COMMANDS.has(name)
  })
}

describe('IPC 频道契约', function () {
  it('每个 invoke 频道都能在 Rust 里找到同名命令', function () {
    expect(findMissing(channels, registered)).toEqual([])
  })

  it('能抓出没注册的频道（防止规则退化后假通过）', function () {
    // media:pick 曾因缺 rename 而只在运行期报 Command not found
    expect(findMissing(['media:pick', 'media:not-registered'], registered)).toEqual([
      'media:not-registered'
    ])
  })

  it('待实现频道的登记不会过期', function () {
    // Rust 命令落地后就该把这行登记删掉，否则会被这个用例拉红
    const landed = Array.from(PENDING_COMMANDS.keys()).filter(function (name) {
      return registered.has(name)
    })
    expect(landed).toEqual([])
  })

  it('抓到的命令数量足够多（防止正则失效导致空集合误判通过）', function () {
    expect(registered.size).toBeGreaterThan(200)
  })
})
