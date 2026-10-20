/**
 * 键盘域的领域类型。
 *
 * 两个概念必须分开看，混在一起是旧 `keycodes/` 混乱的根源：
 * - **作用域**（`ShortcutScope`）：`global` 是 OS 级热键（Tauri 插件注册，拿不到 DOM 事件），
 *   其余是窗口内 DOM 键位。决定后端、校验强度、运行时状态与冲突语义。
 * - **命令**（`Command`）：键位最终「做什么」。键位表只声明绑定，实际动作在命令里。
 *
 * 字符串 DSL 的解析/匹配/格式化见 `keyboard/binding.ts`；唯一键位表见 `keyboard/definitions.ts`。
 */

/**
 * 键位作用域。
 *
 * - `global`：系统级。经 `@tauri-apps/plugin-global-shortcut` 注册，任何应用在前台都能触发，
 *   因此**整个应用只有一份**，且只能由主窗注册。禁止 `mod`、必须显式修饰键。
 * - `app`：窗口级。该窗口内有焦点即生效（如截屏浮层的 ESC）。
 * - `view`：视图级。由 `when` 进一步限定在某个路由/工作区（如 code 窗的 Ctrl+S）。
 * - `editor`：编辑器内。仅输入区可用（tiptap / Monaco）。
 */
type ShortcutScope = 'global' | 'app' | 'view' | 'editor'

/** 键位归属窗口；`any` 表示主窗与浮层都能用 */
type ShortcutWindow = 'main' | 'overlay' | 'any'

/**
 * 全局键定义（`scope: 'global'`）。
 *
 * 刻意**没有** `window` / `when` / `allowInEditable` —— 那些是局部键才有的维度，
 * 用判别联合把它们挡在类型之外，避免出现「既是全局又是视图级」这种非法状态。
 */
type GlobalShortcutDefinition = {
  scope: 'global'
  /** 与命令 id 一致 */
  id: string
  title: string
  /** Tauri accelerator 串（显式修饰键），如 `Alt+Q`、`Control+Alt+Q` */
  defaultBinding: string
  /** 默认键被系统或其它应用占用时，依次尝试的组合 */
  fallbacks: readonly string[]
  /** 只读项不提供录制入口 */
  isConfigurable: boolean
}

/**
 * 局部键定义（`scope: 'app' | 'view' | 'editor'`）。
 *
 * 刻意**没有** `fallbacks` —— 窗口内的键被占用是可静态检测的冲突，靠作用域与优先级消解即可。
 */
type LocalShortcutDefinition = {
  scope: 'app' | 'view' | 'editor'
  id: string
  title: string
  /** 局部键可写 `mod`，可用裸键（`escape`、`space`、`s`） */
  defaultBinding: string
  /**
   * 同一条命令的次要键位，如 redo 同时挂 `mod+shift+z` 与 `mod+y`。
   * 不可单独配置（设置页只展示），但**同样参与冲突检测**。
   */
  extraBindings?: readonly string[]
  window: ShortcutWindow
  isConfigurable: boolean
  /**
   * 上下文条件：返回 false 时该键位当前不参与匹配（如「仅在某视图激活时」）。
   * 与处理器级的 `enabled` 区分：这里是「这个键位管不管用」，那里是「此刻能不能执行」。
   */
  when?: () => boolean
  /** 替代 react-hotkeys-hook 的 `enableOnContentEditable` */
  allowInEditable?: boolean
  /** 替代 react-hotkeys-hook 的 `enableOnFormTags` */
  allowInFormTags?: boolean
  /**
   * `managed`（默认）= 由统一派发器接管；`native` = 编辑器/终端内建绑定，只登记不接管
   * （用于设置页展示与冲突检测，不参与派发）。
   */
  owner?: 'managed' | 'native'
}

type ShortcutDefinition = GlobalShortcutDefinition | LocalShortcutDefinition

/** 全局键的运行时注册状态；局部键没有这个概念 */
type GlobalShortcutState =
  /** 用户想要的组合已生效 */
  | 'active'
  /** 想要的组合被占用，当前跑在 fallback 组合上（运行时生效，未写入设置） */
  | 'fallback'
  /** 注册不上：想要的、旧值、fallback 链全部失败 */
  | 'unavailable'

type GlobalShortcutRuntime = {
  state: GlobalShortcutState
  /** 用户设置（或默认）里写的组合 */
  desired: string
  /** 实际注册成功的组合；`unavailable` 时为 null */
  effective: string | null
  /** 失败原因，用于设置页提示 */
  error?: string
}

type CommandID = string

/** 命令：键位最终落到「做什么」。键位表通过 `id` 引用它 */
type Command = {
  id: CommandID
  title: string
  /** 搜索用的补充关键词（命令面板模糊匹配） */
  keywords?: string
  /** 命令面板里的分组标题 */
  group?: string
  /** 上下文条件：返回 false 时该命令不出现也不可执行 */
  when?: () => boolean
  run: () => void | Promise<void>
}

export type {
  Command,
  CommandID,
  GlobalShortcutDefinition,
  GlobalShortcutRuntime,
  GlobalShortcutState,
  LocalShortcutDefinition,
  ShortcutDefinition,
  ShortcutScope,
  ShortcutWindow
}
