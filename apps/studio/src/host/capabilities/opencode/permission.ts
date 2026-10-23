import {
  AGENT_ACTIONS_BY_NATURE,
  toAgentActionLabel,
  type AgentApprovalMode,
  type AgentToolNature
} from '@/shared/agent-tools'

/**
 * studio 的三档审批策略 → opencode v2 的 permission 规则集（`PermissionRule[]`）。
 *
 * studio 只让用户选「询问审批 / 自动审批 / 只读」，所以这里按**操作类别**整体映射，
 * 不复刻 opencode 的 pattern 级匹配语义（那会让两端的规则各自演化然后漂移）。
 *
 * 语义对齐（见 docs/apps/studio/online-models.md）：
 * - `auto`     —— 需要拍板的动作直接放行；
 * - `ask`      —— 只读放行，有副作用的操作逐次确认；
 * - `readonly` —— 有副作用的动作落 `deny`，模型**看不到**这些工具。
 *
 * 为什么规则随进程配置下发、而不是运行中拍板：v2 的工具可见性**只由 permission 决定**
 * （v1 的 `tools: { name: false }` 请求体开关已经不存在）。规则改一次要重启 server，
 * 所以 studio 把它编译成**四个自定义 primary agent**（`studio-auto` / `studio-ask` /
 * `studio-readonly` / `studio-chat`），每次运行切 agent 即可，server 不必重启。
 */

/** 规则效果：`deny` 让该动作的工具不进模型工具列表（实测：只剩未被 deny 的动作） */
export type PermissionEffect = 'allow' | 'ask' | 'deny'

export interface PermissionRule {
  action: string
  resource: string
  effect: PermissionEffect
}

/**
 * 档位 → 各性质动作的 effect（表驱动，与 shared/agent-tools.ts 的工具表对应）。
 *
 * `unavailable`（`question`）三档都 deny：studio 没有「回答反问」的交互面，
 * serve 模式下弹出来没人能回答，模型会一直等在那里。
 */
const NATURE_EFFECTS: Readonly<Record<AgentApprovalMode, Readonly<Record<AgentToolNature, PermissionEffect>>>> =
  {
    auto: { readonly: 'allow', mutating: 'allow', unavailable: 'deny' },
    ask: { readonly: 'allow', mutating: 'ask', unavailable: 'deny' },
    readonly: { readonly: 'allow', mutating: 'deny', unavailable: 'deny' }
  }

/**
 * 越界守卫：`external_directory` 不是工具，而是 opencode 对「工作区外的目录」这一层的守卫。
 * 自动/询问档都先问一句 —— 工作区外的读写不是「本次任务」的默认范围，只读档直接拒绝。
 * 工作区自己的其它根随后被显式授权（见 `toExternalDirectoryRules`），所以这里问的
 * 只剩**真正的工作区外**。
 */
const GUARD_EFFECTS: Readonly<Record<AgentApprovalMode, PermissionEffect>> = {
  auto: 'ask',
  ask: 'ask',
  readonly: 'deny'
}

/**
 * `.env` 加固：opencode 的 base 策略里 `read *.env` 是 **ask**，auto 档会被直接放行。
 * 三个档位一律 deny（不是 ask）：密钥不该为了「读个配置」被送进模型上下文，
 * 显式 deny 之后 `read .env` 连审批都不会弹（实测）。规则后者胜，所以必须排在 `read *` 之后。
 */
const ENV_RULES: readonly PermissionRule[] = [
  { action: 'read', resource: '*.env', effect: 'deny' },
  { action: 'read', resource: '*.env.*', effect: 'deny' },
  { action: 'read', resource: '*.env.example', effect: 'allow' }
]

/**
 * 工作区里除当前工作目录之外的根。
 *
 * 一个 opencode 会话只有一个工作目录，用户登记的其它根在它眼里就是「工作区外」，
 * 每次读写都先过 `external_directory` 守卫 —— auto 档也会因此弹审批。这些目录是用户
 * 自己加进工作区的，把边界显式授权回去，守卫从此只对**真正的工作区外**生效。
 *
 * 必须排在 `external_directory * <guard>` 之后（v2 是 last match wins）；它只解除这道越界
 * 守卫，能不能写仍由 `edit` / `write` 的动作规则说了算，所以只读档不会因此拿到写权限。
 * 资源值是规范化后的目录边界（反斜杠转正斜杠），opencode 侧也是这么规范化的。
 */
function toExternalDirectoryRules(folders: readonly string[]): PermissionRule[] {
  const rules: PermissionRule[] = []
  for (const folder of folders) {
    const boundary = folder.replace(/\\/g, '/').replace(/\/+$/, '')
    if (!boundary) continue
    rules.push({ action: 'external_directory', resource: boundary, effect: 'allow' })
    rules.push({ action: 'external_directory', resource: `${boundary}/*`, effect: 'allow' })
  }
  return rules
}

function buildProfileRules(
  mode: AgentApprovalMode,
  folders: readonly string[] = []
): PermissionRule[] {
  const effects = NATURE_EFFECTS[mode]
  // 兜底规则排在最前，让同名 action 的具体规则在后面覆盖它（v2 是 last match wins）。
  // 兜底取 `mutating` 的效果：auto 放行、ask 逐次确认、readonly 拒绝 —— 没点名的东西
  // （MCP 工具是 `<server>_<tool>`、opencode 升级新增的动作）因此不会在 ask 档下被静默放行，
  // 也没法在 readonly 档下被执行。要暴露某个动作，在工具表里加一行。
  const rules: PermissionRule[] = [{ action: '*', resource: '*', effect: effects.mutating }]
  const natures: readonly AgentToolNature[] = ['readonly', 'mutating', 'unavailable']

  for (const nature of natures) {
    for (const action of AGENT_ACTIONS_BY_NATURE[nature]) {
      rules.push({ action, resource: '*', effect: effects[nature] })
    }
  }

  rules.push({ action: 'external_directory', resource: '*', effect: GUARD_EFFECTS[mode] })
  rules.push(...toExternalDirectoryRules(folders))
  rules.push(...ENV_RULES)
  return rules
}

/**
 * 档位之外还有「当前模型压根不支持工具」这一种：一个动作都不给（`*: deny` 之后实测工具列表为空），
 * 模型只能纯文本回答。
 */
const CHAT_RULES: readonly PermissionRule[] = [{ action: '*', resource: '*', effect: 'deny' }]

/** agent 档位：三档审批 + 不支持工具的模型的纯聊天档 */
export const AGENT_PERMISSION_PROFILES = ['auto', 'ask', 'readonly', 'chat'] as const

export type AgentPermissionProfile = (typeof AGENT_PERMISSION_PROFILES)[number]

/** 档位 → 自定义 agent 的说明（渲染进程不做展示，供 opencode 侧 agent 列表与排障用） */
const PROFILE_DESCRIPTIONS: Readonly<Record<AgentPermissionProfile, string>> = {
  auto: 'cogito Studio 自动档：工作区内改动直接执行',
  ask: 'cogito Studio 询问档：改动前逐条征得同意',
  readonly: 'cogito Studio 只读档：不修改任何文件',
  chat: 'cogito Studio 纯聊天：当前模型不支持工具'
}

/** 自定义 agent 的 id：config 生成与 engine 切换共用同一份命名，避免两处字符串漂移 */
export function toStudioAgentId(profile: AgentPermissionProfile): string {
  return `studio-${profile}`
}

export function findProfileDescription(profile: AgentPermissionProfile): string {
  return PROFILE_DESCRIPTIONS[profile]
}

/** 档位 → 规则集。每次调用都返回新数组，调用方可以自由持有 */
export function findPermissionRules(
  profile: AgentPermissionProfile,
  folders: readonly string[] = []
): PermissionRule[] {
  return profile === 'chat' ? [...CHAT_RULES] : buildProfileRules(profile, folders)
}

/**
 * 审批回执：`always` 会在项目里持久化一条 allow，studio 没有「记住范围」的 UI，
 * 且它写下的规则**永远不会**覆盖配置里的 deny（用起来像「有时候有效」），所以只下发一次性的两种。
 */
export function toPermissionDecision(approved: boolean): 'once' | 'reject' {
  return approved ? 'once' : 'reject'
}

/** 审批弹窗的一句话说明：opencode 只给「动作 + 目标」，标题由 studio 拼 */
export function describePermission(action: string, resources: readonly string[]): string {
  const target = resources.length > 0 ? resources.join('、') : '（未指定目标）'
  return `${toAgentActionLabel(action)}：${target}`
}

export { ENV_RULES, GUARD_EFFECTS, NATURE_EFFECTS }
