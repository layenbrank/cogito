/**
 * 工具审计（S6）的前端入口：只读、只导出。
 *
 * 为什么前端只有「取一份 JSON」而没有「查表 / 过滤 / 删除」：审计行的用途是
 * 出事之后还原时序，不需要在渲染进程里做查询面。少一个可被脚本滥用的读接口，
 * 就少一条「被拿下的渲染进程翻 agent 历史」的路。
 *
 * 用 zod 校验 Rust 侧的回包：字段名（camelCase）、`effect` / `risk` 的取值都
 * 是契约，Rust 侧改坏了要在这里当场炸，而不是在页面上显示 `undefined`。
 */
import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'

import { CHANNELS } from './channels'

/** 单条审计：`argsDigest` 是摘要（`fnv1a64:<hex>`），没有参数原文 */
const AuditEntrySchema = z.object({
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

const AuditExportSchema = z.object({
  exportedAt: z.number().int().nonnegative(),
  retentionMs: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  entries: z.array(AuditEntrySchema)
})

export type AuditEntry = z.infer<typeof AuditEntrySchema>
export type AuditExport = z.infer<typeof AuditExportSchema>
export { AuditEntrySchema, AuditExportSchema }

/**
 * 导出最近 N 条工具审计（Rust 侧默认 2000 条上限，并先按 7 天保留裁剪）。
 *
 * @param limit 需要更短的清单时传；会被 Rust 侧夹到上限
 */
export async function exportAgentAudit(limit?: number): Promise<AuditExport> {
  const raw = await invoke<unknown>(CHANNELS.SECURITY.AUDIT_EXPORT, { limit })
  return AuditExportSchema.parse(raw)
}

/** 一句话摘要：`12 条 · 3 条失败 · 保留 7 天` */
export function describeAudit(result: AuditExport): string {
  const failed = result.entries.filter(function (entry) {
    return !entry.ok
  }).length
  const days = Math.round(result.retentionMs / 86_400_000)
  const scope = result.entries.length === result.total
    ? `${result.total} 条`
    : `${result.entries.length} / ${result.total} 条`
  return `${scope} · 其中失败 ${failed} 条 · 保留 ${days} 天`
}
