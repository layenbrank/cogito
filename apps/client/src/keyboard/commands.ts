/**
 * 命令注册表：键位最终落到「做什么」。
 *
 * 这里**只有一份注册表**，内部分两张表：
 * - `metadata`：命令的元信息（标题、关键词、分组、`when`），供命令面板与设置页枚举；
 * - `handlers`：可被组件接管的处理器链（旧 `keycodes/dispatcher.ts` 的「谁先返回 true 谁接管」
 *   语义被保留，而不是另起一套）。
 *
 * `registerCommands` 同时写两边 —— 元数据 + 把 `run` 作为**兜底处理器**压到链尾；
 * 组件想「我在场就我处理」时用 `registerHandler` 把自己叠在链前。于是截屏键这类场景天然成立：
 * 磁贴在场就磁贴接管，否则命令自己的 `run` 兜底打开截屏浮层。
 *
 * 因此 `runCommand` 的返回值是「是否有人接管」，与旧 `dispatchKeyCode` 一致。
 */

import type { Command, CommandID } from '@/keyboard/types'
import { reportCaught } from '@/utils/exception-report'

type CommandHandler = () => boolean | void | Promise<boolean | void>

type HandlerEntry = {
  token: symbol
  /** 越高越先被调用 */
  priority: number
  /** 返回 false 时不参与本次派发 */
  enabled?: () => boolean
  handler: CommandHandler
  insertedAt: number
}

type MetadataEntry = {
  meta: Command
  /** 注销时校验，避免误删后注册的同名命令 */
  token: symbol
}

const metadata = new Map<CommandID, MetadataEntry>()
const handlers = new Map<CommandID, HandlerEntry[]>()
const listeners = new Set<() => void>()
let counter = 0
/** `useSyncExternalStore` 要求快照引用稳定，只在注册表真的变了时才换新数组 */
let snapshot: readonly Command[] = []

/** 组件接管的默认优先级；命令自身的 `run` 比它低，所以「接管」总是优先于「兜底」 */
const COMMAND_PRIORITY = 0
const FALLBACK_PRIORITY = -1

function readAllCommands(): readonly Command[] {
  return snapshot
}

function rebuildSnapshot(): void {
  const next = [...metadata.values()].map(function (entry) {
    return entry.meta
  })
  next.sort(function (left, right) {
    return left.id.localeCompare(right.id)
  })
  snapshot = next
  for (const listener of listeners) listener()
}

/**
 * 注册处理器：让组件接管某个命令。返回注销函数。
 *
 * `handler` 返回 `true` 表示「这一键我接管了」，派发就此停止；
 * 返回 `false`/`undefined` 表示「我不处理，交给下一位」。
 */
function registerHandler(
  id: CommandID,
  handler: CommandHandler,
  options?: { priority?: number; enabled?: () => boolean }
): () => void {
  const item: HandlerEntry = {
    token: Symbol('keyboard-handler'),
    priority: options?.priority ?? COMMAND_PRIORITY,
    enabled: options?.enabled,
    handler,
    insertedAt: counter++
  }
  const list = handlers.get(id) ?? []
  list.push(item)
  handlers.set(id, list)

  return function () {
    const current = handlers.get(id)
    if (!current) return
    const next = current.filter(function (candidate) {
      return candidate.token !== item.token
    })
    if (next.length === 0) handlers.delete(id)
    else handlers.set(id, next)
  }
}

/** 定义命令（纯类型辅助，让字面量拿到 `Command` 的上下文推断） */
function defineCommand(command: Command): Command {
  return command
}

/**
 * 注册一批命令：写入元数据 + 把 `run` 作为兜底处理器。
 * 视图挂载时调用、卸载时执行返回的注销函数 —— 未挂载的视图，其命令不会出现在命令面板里。
 */
function registerCommands(commands: readonly Command[]): () => void {
  const disposers = commands.map(function (command) {
    const token = Symbol('keyboard-command')
    metadata.set(command.id, { meta: command, token })

    // 兜底处理器不闭包捕获 command，而是每次现取 —— 同名命令被重新注册后仍跑最新实现
    const disposeHandler = registerHandler(
      command.id,
      async function () {
        const current = metadata.get(command.id)
        if (!current || current.token !== token) return false
        if (current.meta.when && !current.meta.when()) return false
        await current.meta.run()
        // 命令被显式调用就算「做了事」，不让它退回链上继续跑
        return true
      },
      { priority: FALLBACK_PRIORITY }
    )

    return function () {
      const current = metadata.get(command.id)
      if (current?.token === token) metadata.delete(command.id)
      disposeHandler()
    }
  })

  rebuildSnapshot()

  return function () {
    for (const dispose of disposers) dispose()
    rebuildSnapshot()
  }
}

/** 当前登记的处理器数量大于 0？（同步；派发器据此决定要不要 preventDefault） */
function hasCommand(id: CommandID): boolean {
  const list = handlers.get(id)
  return Boolean(list && list.length > 0)
}

/** 当前登记的命令（命令面板用） */
function findCommand(id: CommandID): Command | undefined {
  return metadata.get(id)?.meta
}

/** 模糊匹配：标题 + 关键词 + id */
function findCommands(query: string): Command[] {
  const available = snapshot.filter(function (command) {
    return command.when ? command.when() : true
  })
  const normalized = query.trim().toLowerCase()
  if (!normalized) return available
  return available.filter(function (command) {
    const haystack = `${command.title} ${command.keywords ?? ''} ${command.id}`.toLowerCase()
    return haystack.includes(normalized)
  })
}

/**
 * 执行命令：按优先级降序、同优先级后注册者优先，逐个调用处理器。
 *
 * 返回是否有人接管 —— 全局键的调用方据此决定要不要走兜底（旧行为保留）。
 */
async function runCommand(id: CommandID): Promise<boolean> {
  const list = handlers.get(id)
  if (!list || list.length === 0) return false

  const sorted = [...list].sort(function (left, right) {
    if (right.priority !== left.priority) return right.priority - left.priority
    return right.insertedAt - left.insertedAt
  })

  for (const item of sorted) {
    if (item.enabled && !item.enabled()) continue
    try {
      if ((await item.handler()) === true) return true
    } catch (error) {
      reportCaught('keyboard.commandHandler', error, 'error', { id })
    }
  }

  return false
}

/** 元数据变化订阅（`useSyncExternalStore` 用） */
function subscribeCommands(listener: () => void): () => void {
  listeners.add(listener)
  return function () {
    listeners.delete(listener)
  }
}

export type { CommandHandler }
export {
  COMMAND_PRIORITY,
  FALLBACK_PRIORITY,
  defineCommand,
  findCommand,
  findCommands,
  hasCommand,
  readAllCommands,
  registerCommands,
  registerHandler,
  runCommand,
  subscribeCommands
}
