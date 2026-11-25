/**
 * 安全接口：授权集、工具审计导出、成本账导出、goose 权限快照与重置。
 *
 * 全部是「Rust 算好、前端只读」的形态：这里只做取数 + 契约校验（zod），不做查询面 ——
 * 少一个能被渲染进程滥用的读接口，就少一条「被拿下的窗口翻 agent 历史」的路。
 */
import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'
import {
  AuditExportSchema,
  CostExportSchema,
  GoosePermissionsSchema,
  type AuditExport,
  type CostExport,
  type GoosePermissions
} from '@/shared/ipc/specs/security'

function asError(error: unknown, label: string): Error {
  if (error instanceof Error) return error
  if (typeof error === 'string' && error.trim()) return new Error(error)
  return new Error(`${label}: ${String(error)}`)
}

// ------------------------------------------------------------ 授权集

/** 放行一组路径（用户在选择器里确认过的）；返回真正落库的条数 */
function POST_SECURITY_GRANTS(paths: string[], recursive: boolean): Promise<number> {
  return invoke<number>(CHANNELS.SECURITY.GRANT_PATHS, { paths, recursive })
}

/** 按已落盘的授权集重建 capability 放行表（`GrantReport`） */
interface GrantReport {
  staticRoots: string[]
  workspaceRoots: string[]
  assetFiles: number
  /** 实际被 scope 接受的目录数（含去重后的并集） */
  grantedDirs: number
  grantedFiles: number
  /** 上一次会话落盘、这次重建时重新放行的路径数 */
  grantedPersisted: number
  /** 路径不存在 / scope 拒绝等；不中断整轮重建 */
  errors: string[]
}

function POST_SECURITY_REBUILD(): Promise<GrantReport> {
  return invoke<GrantReport>(CHANNELS.SECURITY.REBUILD)
}

// ------------------------------------------------------------ 审计 / 成本

/** 导出最近 N 条工具审计（Rust 侧默认 2000 条上限，并先按保留期裁剪） */
async function GET_SECURITY_AUDIT(limit?: number): Promise<AuditExport> {
  try {
    return AuditExportSchema.parse(await invoke(CHANNELS.SECURITY.AUDIT_EXPORT, { limit }))
  } catch (error) {
    throw asError(error, '读取工具审计失败')
  }
}

/** 取一份成本账快照（最近 N 条 + 汇总） */
async function GET_SECURITY_COST(limit?: number): Promise<CostExport> {
  try {
    return CostExportSchema.parse(await invoke(CHANNELS.SECURITY.COST_EXPORT, { limit }))
  } catch (error) {
    throw asError(error, '读取成本账失败')
  }
}

// ------------------------------------------------------------ goose 权限

async function GET_GOOSE_PERMISSIONS(): Promise<GoosePermissions> {
  try {
    return GoosePermissionsSchema.parse(await invoke(CHANNELS.GOOSE.PERMISSIONS_READ))
  } catch (error) {
    throw asError(error, '读取 goose 审批偏好失败')
  }
}

/** 重置：备份后删掉 `permission.yaml` 并重启内层 goose。返回备份路径（本来没有文件时为 null） */
async function DELETE_GOOSE_PERMISSIONS(): Promise<string | null> {
  const backup = await invoke<string | null>(CHANNELS.GOOSE.PERMISSIONS_RESET)
  // Rust 侧是 `Option<String>`：没有文件时 IPC 给的是 `null`
  return typeof backup === 'string' && backup.length > 0 ? backup : null
}

export {
  DELETE_GOOSE_PERMISSIONS,
  GET_GOOSE_PERMISSIONS,
  GET_SECURITY_AUDIT,
  GET_SECURITY_COST,
  POST_SECURITY_GRANTS,
  POST_SECURITY_REBUILD
}
export type { GrantReport }
