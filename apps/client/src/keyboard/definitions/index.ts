/**
 * 唯一键位表（对外入口）。
 *
 * 设置页、冲突检测、派发器、Tauri 全局键注册**全部**从这一份定义出发 —— 所以不存在
 * 「文档写 ⌘B、代码听 ⌘K」这类漂移（studio 的 `WINDOW_SHORTCUTS` 就是这么做的，这里统一了 client）。
 *
 * 目录结构（一个消费者组一个文件，本文件只做汇总与查询）：
 * - `ids.ts`      命令 id（与 `keyboard/commands.ts` 注册的名字一一对应）
 * - `factory.ts`  键位构造器（折叠作用域 / 窗口 / 焦点策略这些重复字段）
 * - `global.ts`   OS 级全局键
 * - `overlay.ts` / `code.ts` / `markdown.ts` / `clipchamp.ts` / `directive.ts` / `morph.ts`
 *                 各窗口/视图的局部键
 * - `editor.ts`   编辑器内键位（我们接管的 + 扩展自己接管的）
 *
 * 约定：
 * - `id` 默认等于命令 id；命令注册表里查不到同名命令时，该键位不会被派发（`native` 的除外，它们
 *   只登记不接管）。
 * - 加键位只需在这里加一条 + 在对应视图里 `useCommands` / `useShortcut`，不必碰设置页与派发器。
 * - `isConfigurable: false` 表示只展示、不可改（Esc / 撤销 / 重做这类肌肉记忆键位，
 *   以及编辑器内键位）—— 但仍然参与冲突检测。
 */

import { bindingKeyOfText, findConflicts, findPlatform } from '@/keyboard/binding'
import type { BindingConflict, ShortcutBindingEntry } from '@/keyboard/binding'
import { CLIPCHAMP_SHORTCUTS } from '@/keyboard/definitions/clipchamp'
import { CODE_SHORTCUTS } from '@/keyboard/definitions/code'
import { AGENT_SHORTCUTS } from '@/keyboard/definitions/dock'
import { DIRECTIVE_SHORTCUTS } from '@/keyboard/definitions/directive'
import { EDITOR_SHORTCUTS, NATIVE_EDITOR_SHORTCUTS } from '@/keyboard/definitions/editor'
import { GLOBAL_SHORTCUTS } from '@/keyboard/definitions/global'
import { COMMAND } from '@/keyboard/definitions/ids'
import { KNOWLEDGE_SHORTCUTS } from '@/keyboard/definitions/knowledge'
import { MORPH_SHORTCUTS } from '@/keyboard/definitions/morph'
import { OVERLAY_SHORTCUTS } from '@/keyboard/definitions/overlay'
import { OVERVIEW_SHORTCUTS } from '@/keyboard/definitions/overview'
import type {
  GlobalShortcutDefinition,
  LocalShortcutDefinition,
  ShortcutDefinition
} from '@/keyboard/types'
import { useSettingsStore } from '@/stores/setting'

const LOCAL_SHORTCUTS: readonly LocalShortcutDefinition[] = [
  ...AGENT_SHORTCUTS,
  ...OVERVIEW_SHORTCUTS,
  ...OVERLAY_SHORTCUTS,
  ...CODE_SHORTCUTS,
  ...KNOWLEDGE_SHORTCUTS,
  ...CLIPCHAMP_SHORTCUTS,
  ...DIRECTIVE_SHORTCUTS,
  ...MORPH_SHORTCUTS
]

const SHORTCUTS: readonly ShortcutDefinition[] = [
  ...GLOBAL_SHORTCUTS,
  ...LOCAL_SHORTCUTS,
  ...EDITOR_SHORTCUTS,
  ...NATIVE_EDITOR_SHORTCUTS
]

/** 表里的默认键位（**不读用户覆盖**）：给展示层用，模块级常量可以安全调用 */
function findShortcutDefault(id: string): string {
  return findShortcut(id)?.defaultBinding ?? ''
}

function findShortcut(id: string): ShortcutDefinition | undefined {
  return SHORTCUTS.find(function (shortcut) {
    return shortcut.id === id
  })
}

/** 用户覆盖值（没改过则为 undefined） */
function readOverride(id: string): string | undefined {
  return useSettingsStore.getState().settings.shortcuts.bindings[id]
}

/** 生效值：优先覆盖值，其次表里的默认值。`overrides` 传了就完全以它为准（纯函数路径） */
function resolveBindingWith(id: string, overrides?: Record<string, string>): string {
  const override = overrides ? overrides[id] : readOverride(id)
  if (override) return override
  return findShortcut(id)?.defaultBinding ?? ''
}

/** 生效的键位 = 用户覆盖 ?? 表里的默认值 */
function resolveBinding(id: string): string {
  return resolveBindingWith(id)
}

/** 该键位当前生效的全部组合（含次要键位），用于冲突检测 */
function findBindingTexts(
  definition: ShortcutDefinition,
  overrides?: Record<string, string>
): string[] {
  if (definition.scope === 'global') return [resolveBindingWith(definition.id, overrides)]
  const primary = resolveBindingWith(definition.id, overrides)
  const extras = definition.extraBindings ?? []
  return [primary, ...extras]
}

function findShortcutEntries(overrides?: Record<string, string>): ShortcutBindingEntry[] {
  const entries: ShortcutBindingEntry[] = []
  for (const definition of SHORTCUTS) {
    const texts = findBindingTexts(definition, overrides)
    texts.forEach(function (binding, index) {
      if (!binding) return
      entries.push({
        // 次要键位给个可区分的 id，冲突提示里能指出是哪一个
        id: index === 0 ? definition.id : `${definition.id}#${binding}`,
        title: definition.title,
        scope: definition.scope,
        window: definition.scope === 'global' ? undefined : definition.window,
        binding
      })
    })
  }
  return entries
}

/** 用户是否改过这个键位 */
function isCustomized(id: string): boolean {
  const override = readOverride(id)
  if (!override) return false
  const definition = findShortcut(id)
  return !definition || bindingKeyOfText(override) !== bindingKeyOfText(definition.defaultBinding)
}

/** 表内冲突：默认值与用户覆盖合起来算，`block` 会被设置页拦住 */
function findShortcutConflicts(overrides?: Record<string, string>): BindingConflict[] {
  return findConflicts(findShortcutEntries(overrides), findPlatform())
}

/**
 * 预检：把某条键位改成 `binding` 后，会不会产生**阻断级**冲突。
 *
 * 复用 `findConflicts` 的完整规则（全局×全局、全局×窗口内、同窗口同作用域），
 * 不在设置页另写一套。`binding: null` 表示改成「未设置」—— 只会减少冲突，直接通过。
 */
function findConflictsForChange(id: string, binding: string | null): BindingConflict[] {
  const definition = findShortcut(id)
  if (!definition || !binding) return []

  const entries = findShortcutEntries().filter(function (entry) {
    return entry.id !== id && !entry.id.startsWith(`${id}#`)
  })

  entries.push({
    id,
    title: definition.title,
    scope: definition.scope,
    window: definition.scope === 'global' ? undefined : definition.window,
    binding
  })

  // 次要键位仍然生效，要一起算
  if (definition.scope !== 'global') {
    for (const extra of definition.extraBindings ?? []) {
      entries.push({
        id: `${id}#${extra}`,
        title: definition.title,
        scope: definition.scope,
        window: definition.window,
        binding: extra
      })
    }
  }

  return findConflicts(entries, findPlatform()).filter(function (conflict) {
    return (
      conflict.severity === 'block' &&
      conflict.ids.some(function (candidate) {
        return candidate === id || candidate.startsWith(`${id}#`)
      })
    )
  })
}

export type { GlobalShortcutDefinition, LocalShortcutDefinition, ShortcutDefinition }
export {
  COMMAND as SHORTCUT_COMMAND,
  GLOBAL_SHORTCUTS,
  LOCAL_SHORTCUTS,
  SHORTCUTS,
  findBindingTexts,
  findShortcut,
  findShortcutConflicts,
  findShortcutDefault,
  findShortcutEntries,
  findConflictsForChange,
  isCustomized,
  readOverride,
  resolveBinding
}
