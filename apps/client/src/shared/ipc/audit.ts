/**
 * 工具审计（S6）的展示层：只读、只导出。
 *
 * 为什么前端只有「取一份 JSON」而没有「查表 / 过滤 / 删除」：审计行的用途是
 * 出事之后还原时序，不需要在渲染进程里做查询面。少一个可被脚本滥用的读接口，
 * 就少一条「被拿下的渲染进程翻 agent 历史」的路。
 *
 * 取数 + 契约校验在 `@/apis/security`（schema 在 `specs/security.ts`），这里只剩文案。
 */
import type { AuditExport } from '@/shared/ipc/specs/security'

export { AuditEntrySchema, AuditExportSchema } from '@/shared/ipc/specs/security'
export type { AuditEntry, AuditExport } from '@/shared/ipc/specs/security'

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
