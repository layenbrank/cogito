/**
 * `/goose/invoke` 的白名单：前端**只能**通过这些 ACP 方法。
 *
 * ## 为什么是一个白名单而不是一堆端点
 *
 * 前端要用 19 个 `_goose/unstable/*` 方法（配置读写、扩展开关、工具权限、模型清单…），
 * 每个都开一条路由会让协议层膨胀成一堆几乎没有逻辑的转发函数。这里只留一道闸：
 * 方法名必须在表里，params 原样透传。
 *
 * ## 为什么「不在表里」比「在表里」更重要
 *
 * 两个方法**刻意排除**：
 * - `session/prompt` —— 必须走 `/threads/:id/runs`，否则绕过同线程单飞与事件流，
 *   两轮交错写同一个 checkpoint；
 * - `session/new` —— 有具名端点 `/goose/sessions`，session 的登记要跟 thread 绑定。
 *
 * 其余未列出的方法一律拒绝（fail-closed）：透传端点最怕变成万能代理。
 */

/** 允许透传的 ACP 方法（精确匹配）。 */
const ALLOWED_GOOSE_METHODS: readonly string[] = [
  // 会话配置（温度 / 思考档 / provider / model 都在这条通道上）
  'session/set_config_option',
  'session/set_mode',
  'session/load',
  'session/close',
  'session/list',
  // goose 的不稳定命名空间：读配置与写配置
  '_goose/unstable/config/read',
  '_goose/unstable/config/upsert',
  '_goose/unstable/defaults/read',
  '_goose/unstable/defaults/save',
  // provider 目录与就绪检查
  '_goose/unstable/providers/list',
  '_goose/unstable/providers/config/read',
  '_goose/unstable/providers/config/save',
  '_goose/unstable/providers/inventory/refresh',
  '_goose/unstable/providers/readiness/check',
  // 扩展管理
  '_goose/unstable/config/extensions/list',
  '_goose/unstable/config/extensions/add',
  '_goose/unstable/config/extensions/remove',
  '_goose/unstable/config/extensions/set-enabled',
  '_goose/unstable/session/extensions/list',
  '_goose/unstable/session/extensions/add',
  '_goose/unstable/session/extensions/remove',
  // 系统提示与工具面
  '_goose/unstable/session/system-prompt/set',
  '_goose/unstable/tools/list',
  '_goose/unstable/tools/permissions/set',
  // 诊断
  '_goose/unstable/diagnostics/get'
]

function isAllowedGooseMethod(method: string): boolean {
  return ALLOWED_GOOSE_METHODS.includes(method)
}

export { ALLOWED_GOOSE_METHODS, isAllowedGooseMethod }
