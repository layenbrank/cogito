import type { ImportResult } from '@/shared/ipc/specs/sidecar'

type ImportEntry = ImportResult['entries'][number]
type ImportStatus = ImportEntry['status']

/** toast 里点名失败文件的上限，再多就折成「等 N 个」 */
const NAMED_LIMIT = 8

/**
 * 多路径导入的汇总：corex 一次调用只报一份计数，一批文件就得自己加起来。
 * 条目照接，失败文件靠它点名。
 */
function mergeImportResults(results: readonly ImportResult[]): ImportResult {
  return results.reduce(
    function (acc, result) {
      return {
        entries: acc.entries.concat(result.entries),
        created: acc.created + result.created,
        updated: acc.updated + result.updated,
        skipped: acc.skipped + result.skipped,
        failed: acc.failed + result.failed
      }
    },
    { entries: [] as ImportEntry[], created: 0, updated: 0, skipped: 0, failed: 0 }
  )
}

/**
 * 整个路径炸掉（IPC 报错、文件读不动）时补一条失败记录。
 * 不补的话这批导入就静悄悄少了一条，只剩计数对不上。
 */
function importFailure(path: string, error: unknown): ImportResult {
  const entry: ImportEntry = {
    name: basename(path),
    path,
    status: 'failed',
    error: error instanceof Error ? error.message : String(error)
  }
  return { entries: [entry], created: 0, updated: 0, skipped: 0, failed: 1 }
}

/** 某个状态下的条目名，用来在提示里点名 */
function importNames(result: ImportResult, status: ImportStatus): string[] {
  return result.entries
    .filter(function (entry) {
      return entry.status === status
    })
    .map(function (entry) {
      return entry.name
    })
}

/** 一行计数；没失败就不提失败 */
function formatImportSummary(result: ImportResult): string {
  const parts = [`新建 ${result.created}`, `更新 ${result.updated}`, `跳过 ${result.skipped}`]
  if (result.failed > 0) parts.push(`失败 ${result.failed}`)
  return parts.join('，')
}

/** 点名列表：超出上限就折成「等 N 个」 */
function joinNames(names: readonly string[]): string {
  if (names.length <= NAMED_LIMIT) return names.join('、')
  return `${names.slice(0, NAMED_LIMIT).join('、')} 等 ${names.length} 个`
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

export {
  formatImportSummary,
  importFailure,
  importNames,
  joinNames,
  mergeImportResults,
  NAMED_LIMIT
}
