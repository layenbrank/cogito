/**
 * 安全相关回包契约（审计 / 成本账 / goose 权限）。
 *
 * 都用 zod 校验：字段名（camelCase）与枚举取值是 Rust 侧契约，改坏了要在这里当场炸，
 * 而不是在页面上显示 `undefined`。schema 放在 specs 里，`apis/security.ts` 负责取数 + 解析，
 * 各页面只拿解析后的类型。
 */
import { z } from 'zod'

// ------------------------------------------------------------ 工具审计（S6）

/** 单条审计：`argsDigest` 是摘要（`fnv1a64:<hex>`），没有参数原文 */
export const AuditEntrySchema = z.object({
  id: z.string(),
  toolName: z.string(),
  effect: z.enum(['read', 'write', 'unknown']),
  risk: z.enum(['read', 'write', 'guarded', 'unknown']),
  ok: z.boolean(),
  error: z.string().nullish(),
  argsDigest: z.string(),
  durationMs: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative()
})

export const AuditExportSchema = z.object({
  exportedAt: z.number().int().nonnegative(),
  retentionMs: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  entries: z.array(AuditEntrySchema)
})

export type AuditEntry = z.infer<typeof AuditEntrySchema>
export type AuditExport = z.infer<typeof AuditExportSchema>

// ------------------------------------------------------------ 成本账（S8）

export const CostEntrySchema = z.object({
  id: z.string(),
  usageId: z.string(),
  runId: z.string().nullish(),
  sessionId: z.string().nullish(),
  model: z.string(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  /** 微元（1 元 = 1_000_000）；null = 未计价 */
  priceMicros: z.number().int().nullish(),
  currency: z.string().nullish(),
  /** `YYYY-MM-DD`（UTC） */
  dayKey: z.string(),
  createdAt: z.number().int().nonnegative()
})

export const CostTotalsSchema = z.object({
  runs: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  priceMicros: z.number().int().nonnegative(),
  pricedRuns: z.number().int().nonnegative(),
  unpricedRuns: z.number().int().nonnegative()
})

export const CostExportSchema = z.object({
  exportedAt: z.number().int().nonnegative(),
  retentionMs: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  currency: z.string(),
  totals: CostTotalsSchema,
  entries: z.array(CostEntrySchema)
})

export type CostEntry = z.infer<typeof CostEntrySchema>
export type CostExport = z.infer<typeof CostExportSchema>

// ------------------------------------------------------------ goose 权限

export const PermissionBucketsSchema = z.object({
  alwaysAllow: z.array(z.string()),
  askBefore: z.array(z.string()),
  neverAllow: z.array(z.string())
})

export const GoosePermissionsSchema = z.object({
  path: z.string(),
  exists: z.boolean(),
  /** 解析失败：应提示「建议重置」而不是「没有偏好」 */
  unreadable: z.boolean(),
  /** 用户手动记下的（「总是允许 / 从不允许」点出来的），优先级最高 */
  user: PermissionBucketsSchema,
  /** goose 的 LLM 判定缓存，不是用户偏好 */
  smartApprove: PermissionBucketsSchema
})

export type PermissionBuckets = z.infer<typeof PermissionBucketsSchema>
export type GoosePermissions = z.infer<typeof GoosePermissionsSchema>
