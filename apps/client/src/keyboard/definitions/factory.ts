import type { LocalShortcutDefinition } from '@/keyboard/types'

/**
 * 键位构造器。
 *
 * 同一批键位的字段高度重复（作用域 / 窗口 / 是否允许输入区 / 是否可改），逐条展开会把
 * 表本身淹没在样板里 —— 所以按「作用域 + 焦点策略」这三种常见组合各给一个构造器，
 * 表里只留 id、标题、键位这三件真正会变的信息。
 *
 * 可配置性：
 * - `view` / `global` 开放给用户改（设置页里可编辑）
 * - 编辑器内与截屏浮层的键位统一**只读**：它们是肌肉记忆（⌘B / ⌘Z / Esc），
 *   让用户改错比不让改更难排查 —— 但仍参与冲突检测。
 */

/** 视图级键位：主窗 + 可配置。焦点策略各视图不同，由 `extra` 逐条指定 */
export function viewShortcut(
  id: string,
  title: string,
  defaultBinding: string,
  extra?: Partial<LocalShortcutDefinition>
): LocalShortcutDefinition {
  return {
    scope: 'view',
    id,
    title,
    defaultBinding,
    window: 'main',
    isConfigurable: true,
    ...extra
  }
}

/** 截屏浮层键位：浮层窗 + 只读 */
export function overlayShortcut(
  id: string,
  title: string,
  defaultBinding: string,
  extra?: Partial<LocalShortcutDefinition>
): LocalShortcutDefinition {
  return {
    scope: 'app',
    id,
    title,
    defaultBinding,
    window: 'overlay',
    isConfigurable: false,
    ...extra
  }
}

/** 浏览窗口键位：独立窗口 + 只读（新建/关闭标签这类是肌肉记忆，改错会与网页抢键） */
export function browserShortcut(
  id: string,
  title: string,
  defaultBinding: string,
  extra?: Partial<LocalShortcutDefinition>
): LocalShortcutDefinition {
  return {
    scope: 'app',
    id,
    title,
    defaultBinding,
    window: 'browser',
    isConfigurable: false,
    // 与浏览器一致：在输入框里也照样生效
    allowInFormTags: true,
    allowInEditable: true,
    ...extra
  }
}

/** 编辑器内键位：主窗 + 允许输入区 + 只读 */
export function editorShortcut(
  id: string,
  title: string,
  defaultBinding: string,
  extra?: Partial<LocalShortcutDefinition>
): LocalShortcutDefinition {
  return {
    scope: 'editor',
    id,
    title,
    defaultBinding,
    window: 'main',
    allowInEditable: true,
    allowInFormTags: true,
    isConfigurable: false,
    ...extra
  }
}
