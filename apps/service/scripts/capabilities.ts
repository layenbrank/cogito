/**
 * 能力 crate 的机器可读声明：数据所有权、依赖方向、公开模块、要吸收的遗留目录。
 *
 * 这是「能力边界」的唯一事实来源，由 scripts/arch.ts 强制；README.md 负责给人读。
 * 改这里等于改架构：新增能力 = 新增一条声明 + 一个 crates/<name> 目录 + 一份 README。
 */

export type CapabilityStatus =
  /** 边界与实现都已迁入，遗留目录必须已删除 */
  | 'migrated'
  /** 边界已建立，实现正在逐块迁入 */
  | 'migrating'
  /** 仅声明边界，实现尚未开始 */
  | 'pending'

export interface Capability {
  /** crate 名，与目录名 crates/<name> 一致 */
  name: string
  /** 中文标题（用于输出） */
  title: string
  /** 拥有的数据库表；同一张表只能被一个能力声明 */
  owns: readonly string[]
  /** 允许依赖的其他能力 crate（除 entity/migration 等非能力 crate 外，其余能力依赖一律禁止） */
  dependsOn: readonly string[]
  /** 允许对外的 pub mod（能力 crate 默认只暴露 crate 根部的项） */
  publicModules: readonly string[]
  /** 迁入完成后必须消失的遗留路径（相对 apps/service） */
  absorbs: readonly string[]
  status: CapabilityStatus
}

export const CAPABILITIES: readonly Capability[] = [
  {
    name: 'identity',
    title: '身份与租户',
    owns: ['auth', 'tenant', 'tenant_member', 'sso_connection', 'console_preference'],
    dependsOn: [],
    publicModules: ['account', 'persistence', 'tenant'],
    absorbs: ['src/services/auth', 'src/services/user', 'src/services/tenant', 'src/services/sso'],
    status: 'migrating'
  },
  {
    name: 'authz',
    title: '授权决策',
    owns: [],
    dependsOn: ['identity'],
    publicModules: [],
    absorbs: [],
    status: 'migrating'
  },
  {
    name: 'billing',
    title: '订阅与计费',
    owns: ['subscription', 'payment_order', 'billing_price'],
    dependsOn: ['identity'],
    publicModules: [],
    absorbs: ['src/services/subscription', 'src/services/payment'],
    status: 'pending'
  },
  {
    name: 'gateway',
    title: '模型网关',
    owns: ['gateway_provider', 'gateway_model', 'gateway_usage', 'gateway_audit'],
    dependsOn: ['identity'],
    publicModules: [],
    absorbs: ['src/services/gateway'],
    status: 'pending'
  },
  {
    name: 'document',
    title: '文档与资产',
    owns: ['asset', 'chunk'],
    dependsOn: ['identity'],
    publicModules: [],
    absorbs: ['src/services/upload', 'src/services/markdown'],
    status: 'pending'
  },
  {
    name: 'audit',
    title: '事件与审计',
    owns: ['outbox', 'consumed_event', 'exception'],
    dependsOn: ['identity'],
    publicModules: [],
    absorbs: [],
    status: 'migrated'
  },
  {
    name: 'notify',
    title: '出站通知',
    owns: [],
    dependsOn: ['identity'],
    publicModules: [],
    absorbs: [],
    status: 'pending'
  },
  {
    name: 'durable',
    title: '可靠执行',
    // 编排历史在 provider 自带的独立 schema 里（默认 `durable`），不进 migration 世代，也不归任何租户。
    owns: [],
    dependsOn: [],
    publicModules: [],
    absorbs: [],
    status: 'migrated'
  },
  {
    name: 'aliyun',
    title: '阿里云出站',
    // 无表、无 schema：只有进程内的凭据与连接池，以及 OSS 里的对象（归调用方的存储策略）。
    owns: [],
    dependsOn: [],
    publicModules: ['mail', 'oss', 'rpc', 'sms'],
    // 从 Go 边车收敛进进程：这些路径必须消失（R6）。
    absorbs: ['sidecars/aliyun-gateway', 'docker/aliyun-gateway'],
    status: 'migrated'
  },
  {
    name: 'agent',
    title: '服务端 agent',
    owns: ['agent_task', 'agent_approval'],
    dependsOn: [],
    publicModules: ['persistence'],
    // 新增能力，没有遗留路径可吸收：HTTP 层是**新写**的，按 R6 留在 api 二进制（见 LEGACY_SERVICES）。
    absorbs: [],
    // 边界与实现都已就位：crate + services/agent + orchestrations/agent.rs + e2e（agent_scope / agent_fault_injection）。
    status: 'migrated'
  },
  {
    name: 'rag',
    title: 'RAG 索引任务',
    owns: ['rag_index_task'],
    dependsOn: [],
    publicModules: ['persistence'],
    // 台账是**新写**的（编排早已存在，但一直没有生产入口）：HTTP 层按 R6 留在 api 二进制。
    absorbs: [],
    // crate + services/rag + e2e（rag_index_scope）；编排本体在 orchestrations/rag.rs，早于本能力存在。
    status: 'migrated'
  },
  {
    name: 'chat',
    title: '会话同步',
    owns: ['chat_session', 'chat_message', 'chat_usage', 'chat_sync_batch'],
    dependsOn: [],
    publicModules: ['persistence'],
    // 新增能力，没有遗留路径可吸收：HTTP 层是**新写**的，按 R6 留在 api 二进制（见 LEGACY_SERVICES）。
    absorbs: [],
    // crate + services/chat + e2e（chat_sync_scope）：水位分配、冲突判定与增量窗口都在 crate 里。
    status: 'migrated'
  },
  {
    name: 'mcp',
    title: 'MCP 工具面',
    owns: [],
    dependsOn: [],
    publicModules: [],
    // 新增能力，没有遗留路径可吸收：HTTP 层是**新写**的，按 R6 留在 api 二进制（见 LEGACY_SERVICES）。
    absorbs: [],
    // crate（工具目录与名字映射）+ services/mcp（JSON-RPC 分发与 compute 转发）+ e2e（mcp_scope）。
    status: 'migrated'
  }
]

/**
 * R10：被「封禁」的依赖——只允许出现在指定的一个 crate 里。
 *
 * 可靠执行（duroxide / duroxide-pg）是 0.1.x preview，且它的编排/活动语义会渗透到
 * 每一个调用点。所以把它压在 `crates/durable` 后面：上层只用 `durable` 的端口，
 * 将来换实现或升级时改动面就是这一个 crate。任何其它 crate（含 api 二进制自己的
 * Cargo.toml）出现这些依赖都算违规。
 */
export const CONFINED_CRATE_DEPS: Record<string, string> = {
  duroxide: 'crates/durable',
  'duroxide-pg': 'crates/durable'
}

/**
 * R11：内部调用契约（cogito ↔ compute）。
 *
 * 跨语言边界最容易烂的地方是「路由在代码里长出来、契约文件跟不上」。所以反过来管：
 * `/internal/**` 的路径只允许出现在 `clientDir` 下的出站客户端里，且必须是
 * `spec/internal.yaml` 里声明过的路径，一字不差（占位符用 `{assetID}` 这种具名形式，
 * 不做归一化，避免「看起来对」的路径混过去）。
 */
export const INTERNAL_CONTRACT = {
  /** 契约文件（相对 apps/service），唯一声明源 */
  spec: 'spec/internal.yaml',
  /** 出站客户端目录：只有这里允许出现 /internal 路径字面量 */
  clientDir: 'src/clients',
  /** 契约里 paths 段的缩进（顶格 `paths:` 之下的 2 空格子键） */
  pathsKey: 'paths:'
} as const

/**
 * 遗留 src/services 模块的冻结集合：只减不增。
 *
 * 新能力一律建 crate（见 CAPABILITIES），不允许再往 src/services 里加模块。
 * `cogito` 标记的模块是应用层编排（对话/引擎/应用），归属 api 二进制，不会被能力 crate 吸收。
 */
export const LEGACY_SERVICES: Record<string, { owner: string; note: string }> = {
  agent: {
    owner: 'agent',
    note: '服务端 agent 的 HTTP 层（新写，非遗留）：领域数据与状态词汇在 crates/agent'
  },
  application: { owner: 'cogito', note: '应用层编排，留在 api 二进制' },
  auth: { owner: 'identity', note: '账号与认证' },
  chat: {
    owner: 'chat',
    note: '会话同步的 HTTP 层（新写，非遗留）：水位分配与冲突判定在 crates/chat'
  },
  engine: { owner: 'cogito', note: '对话/智能体编排，留在 api 二进制' },
  gateway: { owner: 'gateway', note: '模型网关' },
  markdown: { owner: 'document', note: '文档解析' },
  mcp: {
    owner: 'mcp',
    note: 'MCP 的 HTTP 层（新写，非遗留）：工具目录与名字映射在 crates/mcp'
  },
  payment: { owner: 'billing', note: '支付渠道' },
  rag: {
    owner: 'rag',
    note: 'RAG 索引任务的 HTTP 层（新写，非遗留）：台账与状态词汇在 crates/rag'
  },
  sso: { owner: 'identity', note: 'SSO 连接' },
  subscription: { owner: 'billing', note: '订阅与配额' },
  tenant: { owner: 'identity', note: '租户与成员' },
  upload: { owner: 'document', note: '资产上传' },
  user: { owner: 'identity', note: '账号资料' },
  console: {
    owner: 'identity',
    note: 'Backend Console 偏好（新写）：表 console_preference，HTTP 层留在 api 二进制'
  },
  exception: {
    owner: 'audit',
    note: '客户端异常上报（新写）：表 exception，HTTP 层留在 api 二进制；管理面走 PlatformScope'
  }
}

/** 能力 crate 不得依赖的 crate：api 二进制本身与 Web 框架 */
export const FORBIDDEN_CRATE_DEPS = [
  'service',
  'actix-web',
  'actix-cors',
  'actix-files',
  'actix-multipart',
  'axum',
  'rocket',
  'utoipa-swagger-ui'
] as const

/**
 * R3：角色词汇的出现模式。
 *
 * 目标状态下 `src/` 与能力 crate 里不再出现重复的角色词汇或散写的权限判断：遗留的
 * `Role::` / `Status::`（identity 的领域类型一律带命名空间前缀）、`.is_admin()` 谓词、
 * 与角色字面量的比较。引用 identity 的领域类型（如 `PlatformRole::User`）是允许的——
 * 词汇只定义在 `crates/identity`，判定只写在 `crates/authz`。
 */
export const ROLE_VOCAB_PATTERN =
  /\b(?:Role|Status)\s*::|\.is_admin\s*\(|(?:==|!=)\s*"(?:OWNER|ADMIN|MEMBER|USER)"/g

/**
 * R7 豁免名单：`src/guards/` 与 `src/databases/scope.rs` 之外的作用域入口，数量只能减少。
 *
 * 目标状态下进入作用域只有两条路：请求侧由守卫按请求上下文开（`TenantCtx::enter/open_new`、
 * `AccountScope::enter`、`AssetReader::enter`），机器侧是显式能力键引导且调用点登记在这里。
 * 任何新增作用域入口都必须先想清楚归属，而不是就地打开事务。
 *
 * 名单名保留（历史原因），实际涵盖租户 / 账号 / 支付 / 资产四类作用域入口。
 */
export const TENANT_SCOPE_LEGACY: Record<string, { max: number; reason: string }> = {
  'src/services/subscription/service.rs': {
    max: 2,
    reason:
      '只读包装器（active_plan、active_subscription），待调用方携带作用域后移除；配额判定已在调用方作用域内完成'
  },
  'src/services/payment/service.rs': {
    max: 1,
    reason:
      '支付回调的引导调用点（PaymentNotifyScope::open 把订单号换成租户作用域）；守卫本身在 src/guards/payment.rs，这里只是调用'
  },
  'src/services/gateway/service.rs': {
    max: 2,
    reason:
      '用量/审计落库的机器路径：上游调用结束后按身份重开一段短作用域（租户面 TenantScope::open、账号面 AccountScope::open）'
  },
  'src/services/gateway/controller.rs': {
    max: 2,
    reason:
      '服务身份端点的机器路径：签发令牌与准备出站各开一段短作用域（只做租户存在性/模型与配额解析），事务在出站前结束'
  },
  'src/services/upload/service.rs': {
    max: 5,
    reason:
      '资产面请求路径：一次请求内分段开短作用域（秒传引导 AssetContentScope::open、账号 AccountScope::open、读资产 AssetReader::enter、服务身份按租户读内容 TenantScope::open），长 CAS I/O 在事务外，不跨网络持有作用域'
  },
  'src/services/auth/service.rs': {
    max: 2,
    reason:
      '头像是档案数据：以头像所属账号的账号作用域读（load_avatar_of），绑定头像时在同一作用域内校验并提升为 PUBLIC（check_avatar）'
  },
  'src/services/user/service.rs': {
    max: 1,
    reason:
      '管理面用户列表：一批账号的头像共用一个匿名读事务（只读 PUBLIC 头像），不给每个账号单开作用域'
  },
  'src/services/sso/service.rs': {
    max: 2,
    reason:
      'OIDC 匿名流程的引导调用点（连接 id 读回连接行、再按该租户开写事务）；守卫本身在 src/guards/sso.rs，这里只是调用'
  },
  'src/services/agent/dispatch.rs': {
    max: 1,
    reason:
      'agent 台账收尾的机器路径：等待者与读路径都在请求事务之外跑，收尾时按已记死的租户重开一段短作用域（只写 status/steps/result 那一行）'
  },
  'src/services/rag/dispatch.rs': {
    max: 1,
    reason:
      'rag 台账收尾的机器路径：等待者与读路径都在请求事务之外跑，收尾时按已记死的租户重开一段短作用域（只写 status/result/error 那一行）'
  }
}

/**
 * 作用域入口模式：直接开事务、自行设置会话变量，或接续已写好作用域的事务。
 *
 * `order_tx` / `apply_order_capability` / `TenantScope::adopt` / `PaymentNotifyScope::open`
 * 是**能力键引导**（支付回调：订单号 → 租户）用到的入口，只允许出现在 `src/guards/`。
 * `AssetReader::enter` / `AssetContentScope::open` / `asset_hash_tx` / `apply_asset_capability`
 * 是资产面的三条通道（账号 / 匿名 / 内容寻址能力键），同样只允许出现在 `src/guards/`；
 * `SsoConnectionScope::open` / `sso_connection_tx` / `apply_sso_capability` 是 SSO 匿名流程的
 * 连接 id 能力键通道，`SsoLoginScope::open` 是它引导出来的租户作用域，同样只允许出现在
 * `src/guards/`；`anon_tx`（无作用域）另受 R9 约束。
 */
export const TENANT_SCOPE_PATTERN =
  /\b(?:tenant_tx|user_tx|order_tx|asset_hash_tx|sso_connection_tx|anon_tx|apply_tenant_scope|apply_user_scope|apply_order_capability|apply_asset_capability|apply_sso_capability|TenantScope::open|TenantScope::adopt|AccountScope::open|PaymentNotifyScope::open|AssetReader::enter|AssetContentScope::open|SsoConnectionScope::open|SsoLoginScope::open)\b/g

/** R7 允许的作用域入口归属路径（定义与唯一入口） */
export const TENANT_SCOPE_OWNER_PATHS = ['src/guards/', 'src/databases/scope.rs'] as const

/**
 * 平台特权入口模式：直接开特权事务，或走守卫的唯一入口。
 *
 * 提权（`SET LOCAL ROLE cogito_platform`）绕过行级隔离，因此**只有**平台目录的全局行
 * （`"tenantID" IS NULL`）与跨租户运维汇总需要它；租户面与账号面一律走作用域。
 */
export const PLATFORM_ENTRY_PATTERN = /\b(?:platform_tx|PlatformScope::open)\b/g

/**
 * R8 名单：`src/guards/` 之外允许出现的平台特权入口，**正向登记**（不在名单内即违规）。
 *
 * 与 R7 的「只减不增豁免」不同：这里每多一个调用点都是一次显式决策，必须写明用途。
 */
export const PLATFORM_ENTRY_ALLOWED: Record<string, { max: number; reason: string }> = {
  'src/services/gateway/controller.rs': {
    max: 11,
    reason:
      '平台目录运维面（供应商/模型全局行、跨租户用量与审计汇总、审计导出）：11 个 handler 各开一段特权作用域，业务逻辑在 service.rs 内按 scope.tx() 收口'
  },
  'src/services/payment/billing_controller.rs': {
    max: 6,
    reason:
      '计费运维面（价目管理与计量对账、对账导出）：6 个 handler 各开一段平台特权作用域，业务逻辑在 billing_price.rs / reconcile.rs 内按 scope.tx() 收口'
  },
  'src/services/sso/controller.rs': {
    max: 4,
    reason:
      'SSO 连接管理面（平台运维按平台管理员指定的租户建连接、跨租户列连接）：4 个 handler 各开一段特权作用域，业务逻辑在 service.rs 内按 scope.tx() 收口'
  },
  'src/services/console/controller.rs': {
    max: 2,
    reason:
      'Backend Console 偏好（平台 ADMIN 个人布局）：2 个 handler 各开一段特权作用域；表 RLS 恒假，业务按 actor 过滤本人行'
  },
  'src/services/tenant/admin_controller.rs': {
    max: 1,
    reason:
      '平台运维面（/admin/tenants 整体挂 Auth::admin）：全平台租户分页列表要跨租户读全局行，1 个 handler 开 PlatformScope，业务在 TenantService::admin_list 内收口'
  },
  'src/services/user/controller.rs': {
    max: 1,
    reason:
      '平台运维面（/users 整体挂 Auth::admin）：用户所属租户联查要跨租户汇总成员关系，1 个 handler 开 PlatformScope，业务在 TenantService::admin_tenants_of_user 内收口'
  },
  'src/services/exception/controller.rs': {
    max: 7,
    reason:
      '异常上报与运维查询：表 exception RLS 恒假；7 个 handler（上报/列表/详情/删除/groups/sources/summary）各开一段 PlatformScope'
  },
  'src/worker/runner.rs': {
    max: 1,
    reason:
      '事件发布 worker：outbox 强制行级安全，而发布者要跨租户读全部待发布事件，只属于平台级消费者——这是请求路径之外唯一的提权点，作用域是「读一批 outbox + 回写置位」'
  }
}

/** R8 允许的定义与唯一入口归属路径 */
export const PLATFORM_ENTRY_OWNER_PATHS = ['src/guards/', 'src/databases/scope.rs'] as const

/**
 * R9：无作用域数据库访问模式。
 *
 * 两条通道是「什么身份都不带」的：`Storage::anon_tx` 只放行策略里对匿名开放的行
 * （目前只有 `PUBLIC` 资产），`Storage::raw()` 干脆绕过行级策略（`auth` 这类没有
 * 行级安全的全局表、健康检查的 `ping`）。两者都只允许出现在 `src/guards/` 与
 * `src/databases/` 里，且每个出现都必须在这里登记用途——「读不到」应当是设计出来的，
 * 而不是忘了设作用域。
 */
export const UNSCOPED_DB_PATTERN = /\b(?:anon_tx|raw\(\))/g

/** R9 允许的定义与唯一入口归属路径 */
export const UNSCOPED_DB_OWNER_PATHS = ['src/guards/', 'src/databases/'] as const

/** R9 名单：`src/guards/` 之外允许出现的无作用域访问，**正向登记**（不在名单内即违规） */
export const UNSCOPED_DB_ALLOWED: Record<string, { max: number; reason: string }> = {
  'src/bootstrap/system.rs': {
    max: 1,
    reason: '健康检查：只对连接做 ping，不读任何业务表'
  },
  'src/bootstrap/admin.rs': {
    max: 3,
    reason:
      '启动种子：按 auth.bootstrap_admin 幂等创建/提升平台 ADMIN。auth 是全局身份表，无行级安全；种子发生在请求管道之前，只能走未作用域连接'
  },
  'src/services/auth/service.rs': {
    max: 11,
    reason:
      '账号与认证：按用户名/手机号/邮箱跨租户查账号、建号、改密、改角色。auth 是全局身份表——没有行级安全、也不属于任何租户，登录时先查到账号才知道进哪个作用域，所以这些读写只能走未作用域连接'
  },
  'src/services/user/service.rs': {
    max: 6,
    reason: '平台管理面的账号增删改查（列表/建号/改资料/删号），同上：只碰 auth 这张全局身份表'
  }
}
