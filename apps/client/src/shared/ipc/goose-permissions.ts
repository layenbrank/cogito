/**
 * goose 审批偏好（`permission.yaml`）的前端入口：读快照 + 重置。
 *
 * 为什么需要这一层：goose 的 `PermissionInspector` 在 `smart_approve` 档下**先查
 * `user` 段**，命中就按它 Allow / Deny，根本不再发 `session/request_permission`。
 * 也就是说用户以前点过的「总是允许」会永久压住审批，而设置页只能列**当前会话挂载
 * 的工具** —— 已改名或已卸掉的条目（`cogito__app_*` 这类）既看不见也改不掉，
 * 表现为「工具不弹审批 / 直接被拒」却查不出原因。
 *
 * 两条约束写在 Rust 侧（`utils/goose_permissions.rs`）：重置 = 备份后删文件而不是
 * 逐条改写（写坏格式会让 goose 启动 panic）；删完必须重启内层 goose 才生效
 * （`PermissionManager` 在进程内缓存整表），所以重置命令自己带了重启。
 */
import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'

import { CHANNELS } from './channels'

const PermissionBucketsSchema = z.object({
  alwaysAllow: z.array(z.string()),
  askBefore: z.array(z.string()),
  neverAllow: z.array(z.string())
})

const GoosePermissionsSchema = z.object({
  path: z.string(),
  exists: z.boolean(),
  /** 解析失败：应提示「建议重置」而不是「没有偏好」 */
  unreadable: z.boolean(),
  /** 用户手动记下的（「总是允许 / 从不允许」点出来的），优先级最高 */
  user: PermissionBucketsSchema,
  /** goose 的 LLM 判定缓存，不是用户偏好 */
  smartApprove: PermissionBucketsSchema
})

type PermissionBuckets = z.infer<typeof PermissionBucketsSchema>
type GoosePermissions = z.infer<typeof GoosePermissionsSchema>

/** 权限桶的三种取值 + 展示文案（顺序即 UI 顺序：宽 → 严）。 */
const PERMISSION_BUCKETS = [
  { key: 'alwaysAllow', label: '总是允许', hint: '命中后完全不弹审批，也不会被 cogito 拦下' },
  { key: 'askBefore', label: '每次询问', hint: '命中后必定弹审批' },
  { key: 'neverAllow', label: '从不允许', hint: '命中后 goose 静默拒绝，界面上只会看到工具失败' }
] as const

/**
 * 读 `user` 段里的全部条目并标明桶位。
 *
 * `smart_approve` 不参与：那是 goose 自己的 LLM 判定缓存，用户改它没有意义。
 */
function listUserEntries(
  permissions: GoosePermissions
): Array<{ name: string; bucket: (typeof PERMISSION_BUCKETS)[number]; level: string }> {
  return PERMISSION_BUCKETS.flatMap(function (bucket) {
    return permissions.user[bucket.key].map(function (name) {
      return { name, bucket, level: bucket.key }
    })
  })
}

/**
 * 条目在当前工具面里是否还存在。
 *
 * goose 的匹配是**精确字符串**（`Vec::contains`），不支持通配符 —— 所以带 `*` 的
 * 条目永远不会命中任何工具，是纯粹的噪音，要单独标出来。
 */
function classifyEntry(name: string, toolNames: ReadonlySet<string>): 'live' | 'stale' | 'glob' {
  if (name.includes('*')) return 'glob'
  return toolNames.has(name) ? 'live' : 'stale'
}

async function readGoosePermissions(): Promise<GoosePermissions> {
  const raw = await invoke(CHANNELS.GOOSE.PERMISSIONS_READ)
  return GoosePermissionsSchema.parse(raw)
}

/** 重置：备份后删掉 `permission.yaml` 并重启内层 goose。返回备份路径（本来没有文件时为 null）。 */
async function resetGoosePermissions(): Promise<string | null> {
  const raw = await invoke(CHANNELS.GOOSE.PERMISSIONS_RESET)
  // Rust 侧是 `Option<String>`：没有文件时 IPC 给的是 `null`
  return typeof raw === 'string' && raw.length > 0 ? raw : null
}

export {
  classifyEntry,
  GoosePermissionsSchema,
  listUserEntries,
  PERMISSION_BUCKETS,
  readGoosePermissions,
  resetGoosePermissions
}
export type { GoosePermissions, PermissionBuckets }
